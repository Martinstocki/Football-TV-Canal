#!/usr/bin/env node
/**
 * Postet das heutige Fussballprogramm als Discord-Nachricht.
 *
 * Gedacht fuer GitHub Actions: laeuft OHNE Datenbank und ohne Server, holt
 * sich bei jedem Lauf alles frisch und verschickt genau eine Nachricht.
 *
 *   football-data.org  ->  Spielplan CL, BL1, PL, PD, SA, FL1
 *   FotMob TV-Guide AT ->  exakte Sender  +  die drei Wettbewerbe, die
 *                          football-data im Gratis-Tarif NICHT liefert
 *                          (AT1, EL, UECL - siehe config/competitions.js)
 *
 * Die Sender-Auswahl kommt aus denselben Modulen wie die Web-App
 * (channelSelection.js + channelRules.js). Es gibt also keine zweite Kopie
 * der Regeln, die auseinanderlaufen koennte: aendert sich die Blockliste,
 * aendert sich Discord mit.
 *
 * Aufruf:
 *   npm run discord:dry            Trockenlauf, zeigt die Nachricht nur an
 *   npm run discord                echt verschicken
 *   node scripts/post-discord.js --date 2026-09-20
 *   node scripts/post-discord.js --quiet-when-empty
 *
 * Umgebungsvariablen:
 *   FOOTBALL_DATA_API_KEY   Pflicht
 *   DISCORD_WEBHOOK_URL     Pflicht (ausser bei --dry-run)
 *   POST_WHEN_EMPTY         "false" = an spielfreien Tagen gar nichts posten
 *
 * Geheimnisse werden NIE ausgegeben - die Protokolle eines oeffentlichen
 * Repositories kann jeder lesen.
 */

// dotenv nur, wenn vorhanden. So laeuft das Skript auch ohne "npm install".
try {
  await import('dotenv/config');
} catch {
  /* in GitHub Actions kommen die Werte aus den Secrets */
}

import { loadGuide } from '../backend/services/fotmobGuide.js';
import { findBestMatch } from '../backend/services/teamMatching.js';
import {
  buildParallelIndex,
  selectChannels,
  selectedOnly,
} from '../backend/services/channelSelection.js';
import {
  COMPETITIONS,
  getCompetition,
  competitionFromFotmob,
  FOTMOB_ONLY_COMPETITIONS,
} from '../backend/config/competitions.js';
import * as footballData from '../backend/services/providers/footballData.js';

// --- Argumente -------------------------------------------------------------

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const ZEITZONE = process.env.TZ || 'Europe/Vienna';
const LAND = String(arg('country', process.env.DEFAULT_COUNTRY || 'AT')).toUpperCase();
const dryRun = flag('dry-run');

/**
 * An spielfreien Tagen posten oder schweigen?
 *   true  (Standard) -> kurze "Heute keine Spiele"-Nachricht
 *   false            -> gar nichts, der Kanal bleibt still
 * Umschalten per --quiet-when-empty oder POST_WHEN_EMPTY=false.
 */
const postWhenEmpty = flag('quiet-when-empty')
  ? false
  : process.env.POST_WHEN_EMPTY !== 'false';

// Zuordnungsfenster wie in fetch-tv-guide.js: Anstosszeiten weichen zwischen
// den Quellen um bis zu zwei Stunden ab (Sommerzeit, Verlegungen).
const TOLERANZ_MINUTEN = 120;
const SCHWELLE = Number(arg('threshold', 0.7));

// --- Datum in Wiener Zeit --------------------------------------------------

/** Date -> "YYYY-MM-DD" in der gewuenschten Zeitzone. */
function datumIn(zone, date = new Date()) {
  // "sv-SE" liefert genau das ISO-Format, ohne Bastelei mit Offsets.
  return new Intl.DateTimeFormat('sv-SE', { timeZone: zone }).format(date);
}

const HEUTE = arg('date', datumIn(ZEITZONE));

function tageVersetzt(iso, tage) {
  const d = new Date(`${iso}T12:00:00Z`); // Mittag: nie ein Zeitzonen-Ueberlauf
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

const uhrzeit = (utc) =>
  new Intl.DateTimeFormat('de-AT', {
    timeZone: ZEITZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(utc));

const langesDatum = (iso) =>
  new Intl.DateTimeFormat('de-AT', {
    timeZone: ZEITZONE,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${iso}T12:00:00Z`));

// --- 1. Spielplan von football-data.org ------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Holt die heutigen Spiele aller Wettbewerbe, die football-data.org im
 * Gratis-Tarif kennt.
 *
 * Es wird bewusst von gestern bis morgen abgefragt und danach selbst auf
 * "heute in Wien" gefiltert: football-data rechnet in UTC, ein Anstoss um
 * 23:00 UTC gehoert in Wien schon zum naechsten Tag.
 */
/**
 * Ein Wettbewerb, mit einem zweiten Anlauf beim Rate-Limit.
 *
 * Das Limit ist ein gleitendes Fenster ueber eine Minute. Laeuft das Skript
 * zweimal kurz hintereinander - beim Testen von Hand etwa - reicht der
 * normale Abstand zwischen den Abfragen nicht. Ohne diesen zweiten Anlauf
 * fehlt in der Discord-Nachricht dann stillschweigend eine ganze Liga.
 */
async function holeWettbewerb(code, von, bis) {
  try {
    return await footballData.fetchMatches(code, von, bis);
  } catch (err) {
    if (err.code !== 'RATE_LIMIT') throw err;

    // Volle 60 s: das Limit ist ein gleitendes Fenster ueber eine Minute,
    // eine kuerzere Pause laeuft nur in dasselbe Limit hinein.
    console.log(`  ${code}: Rate-Limit erreicht, warte 60 s und versuche es noch einmal.`);
    await sleep(60000);
    return footballData.fetchMatches(code, von, bis);
  }
}

async function holeSpielplan() {
  const codes = COMPETITIONS.filter((c) => footballData.isSupported(c.code)).map((c) => c.code);

  const von = tageVersetzt(HEUTE, -1);
  const bis = tageVersetzt(HEUTE, 1);

  const spiele = [];
  const fehler = [];

  for (const [i, code] of codes.entries()) {
    // Gratis-Tarif: 10 Anfragen pro Minute. Sechs Abfragen mit Pause dazwischen
    // bleiben klar darunter.
    if (i > 0) await sleep(1500);

    try {
      const treffer = await holeWettbewerb(code, von, bis);

      for (const m of treffer) {
        if (m.status === 'CANCELLED') continue;
        if (datumIn(ZEITZONE, new Date(m.utcDate)) !== HEUTE) continue;

        spiele.push({
          competition: code,
          home: m.homeTeam,
          away: m.awayTeam,
          kickoffUtc: m.utcDate,
          status: m.status,
          channels: [],
        });
      }
    } catch (err) {
      // Ein Wettbewerb, der klemmt, darf nicht die ganze Nachricht verhindern.
      fehler.push(`${code}: ${err.message}`);
    }
  }

  return { spiele, fehler };
}

// --- 2. TV-Programm von FotMob ---------------------------------------------

async function holeTvProgramm() {
  try {
    const guide = await loadGuide(LAND, {
      minIntervalSec: Number(process.env.SCRAPER_MIN_INTERVAL_SEC ?? 6 * 3600),
    });
    return { matches: guide.matches, fehler: null, stale: Boolean(guide.stale) };
  } catch (err) {
    // Ohne FotMob fehlen die Sender und die drei Wettbewerbe AT1/EL/UECL.
    // Die Nachricht geht trotzdem raus - mit ehrlichem Hinweis.
    return { matches: [], fehler: err.message, stale: false };
  }
}

// --- 3. Zusammenfuehren ----------------------------------------------------

/**
 * Ordnet jedem Spiel seine Sender zu und ergaenzt die Wettbewerbe, die nur
 * FotMob kennt.
 *
 * @returns {Array<{competition, home, away, kickoffUtc, status, channels}>}
 */
function zusammenfuehren(spielplan, tvSpiele) {
  // Der Index braucht ALLE Spiele der Seite, nicht nur die von heute: ob
  // "Sky Sport Austria 1" die Konferenz ist, zeigt sich erst im Vergleich
  // mit den zeitgleichen Partien.
  const parallelIndex = buildParallelIndex(tvSpiele);

  const senderVon = (spiel) => selectedOnly(selectChannels(spiel, parallelIndex));
  const verbraucht = new Set();

  for (const spiel of spielplan) {
    const kickoff = new Date(spiel.kickoffUtc);

    const kandidaten = tvSpiele
      .map((m, index) => ({ ...m, index }))
      .filter(
        (m) =>
          !verbraucht.has(m.index) &&
          Math.abs(new Date(m.kickoffUtc) - kickoff) / 60000 <= TOLERANZ_MINUTEN
      );

    const treffer = findBestMatch({ home: spiel.home, away: spiel.away }, kandidaten, SCHWELLE);
    if (!treffer) continue;

    verbraucht.add(treffer.kandidat.index);
    spiel.channels = senderVon(treffer.kandidat);
  }

  // Wettbewerbe, die football-data im Gratis-Tarif nicht hat. Sie stehen
  // ausschliesslich im TV-Programm - und dort nur, wenn sie in Oesterreich
  // uebertragen werden.
  const ergaenzt = [];

  for (const [index, m] of tvSpiele.entries()) {
    if (verbraucht.has(index)) continue;
    if (datumIn(ZEITZONE, new Date(m.kickoffUtc)) !== HEUTE) continue;

    const competition = competitionFromFotmob(m.leagueId, m.leagueName);
    if (!competition || !FOTMOB_ONLY_COMPETITIONS.includes(competition)) continue;

    ergaenzt.push({
      competition,
      home: m.home,
      away: m.away,
      kickoffUtc: m.kickoffUtc,
      status: 'SCHEDULED',
      channels: senderVon(m),
    });
  }

  return [...spielplan, ...ergaenzt].sort(
    (a, b) => new Date(a.kickoffUtc) - new Date(b.kickoffUtc)
  );
}

// --- 4. Nachricht bauen ----------------------------------------------------

/** Zeichen, die Discord als Formatierung liest, unschaedlich machen. */
const escape = (s) => String(s).replace(/([*_~`|\\>])/g, '\\$1');

const PLATZHALTER = 'Sender noch offen';

function zeileFuer(spiel) {
  const comp = getCompetition(spiel.competition);
  const kuerzel = comp?.abbr ?? spiel.competition;

  const sender = spiel.channels.length
    ? spiel.channels.map((c) => escape(c.name)).join(', ')
    : `_${PLATZHALTER}_`;

  const verlegt = spiel.status === 'POSTPONED' ? ' ⚠️ verlegt' : '';

  return (
    `\`${uhrzeit(spiel.kickoffUtc)}\` \`${kuerzel}\` ` +
    `**${escape(spiel.home)} – ${escape(spiel.away)}**${verlegt}\n` +
    `⠀⠀⠀⠀⠀📺 ${sender}`
  );
}

const EMBED_LIMIT = 3800; // Discord erlaubt 4096 je Beschreibung
const FARBE = 0x3b6bd6;

function baueEmbeds(spiele, hinweise) {
  const kopf = `⚽ Fußball heute – ${langesDatum(HEUTE)}`;

  if (spiele.length === 0) {
    return [
      {
        title: kopf,
        description: 'Heute kein Spiel in den beobachteten Wettbewerben. ⚽💤',
        color: FARBE,
        footer: { text: hinweise.join(' · ') || 'football-data.org + FotMob' },
      },
    ];
  }

  // In Bloecke schneiden, falls ein Spieltag laenger wird als ein Embed darf.
  const bloecke = [];
  let aktuell = [];
  let laenge = 0;

  for (const spiel of spiele) {
    const zeile = zeileFuer(spiel);

    if (laenge + zeile.length + 1 > EMBED_LIMIT && aktuell.length > 0) {
      bloecke.push(aktuell);
      aktuell = [];
      laenge = 0;
    }

    aktuell.push(zeile);
    laenge += zeile.length + 1;
  }
  if (aktuell.length > 0) bloecke.push(aktuell);

  const anzahl = spiele.length;

  return bloecke.map((zeilen, i) => ({
    title: i === 0 ? `${kopf} (${anzahl} ${anzahl === 1 ? 'Spiel' : 'Spiele'})` : `${kopf} (Fortsetzung)`,
    description: zeilen.join('\n'),
    color: FARBE,
    ...(i === bloecke.length - 1
      ? { footer: { text: hinweise.join(' · ') || 'Quellen: football-data.org + FotMob' } }
      : {}),
  }));
}

// --- 5. Verschicken --------------------------------------------------------

async function sendeAnDiscord(webhook, embeds) {
  const payload = {
    username: 'Fußball-TV',
    // Verhindert, dass ein Vereinsname mit "@everyone" den Kanal anpingt.
    allowed_mentions: { parse: [] },
    embeds,
  };

  for (const versuch of [0, 1]) {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });

    if (res.ok) return;

    if (res.status === 429 && versuch === 0) {
      const daten = await res.json().catch(() => ({}));
      const wartenMs = Math.min(Number(daten.retry_after ?? 2) * 1000, 15000);
      console.log(`Discord drosselt, warte ${Math.round(wartenMs / 1000)} s und versuche es erneut.`);
      await sleep(wartenMs);
      continue;
    }

    // Der Text kann die Webhook-URL nicht enthalten, aber zur Sicherheit
    // wird nur der Statuscode und die Antwort ohne URL ausgegeben.
    const text = await res.text().catch(() => '');
    throw new Error(`Discord antwortete mit HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
}

// --- Ablauf ----------------------------------------------------------------

const webhook = process.env.DISCORD_WEBHOOK_URL;

if (!webhook && !dryRun) {
  console.error('DISCORD_WEBHOOK_URL fehlt. Mit --dry-run laesst sich das Skript ohne testen.');
  process.exit(1);
}
if (!process.env.FOOTBALL_DATA_API_KEY) {
  console.error('FOOTBALL_DATA_API_KEY fehlt.');
  process.exit(1);
}

console.log(`Tag: ${HEUTE} (${ZEITZONE})${dryRun ? '   [Trockenlauf]' : ''}`);

const [plan, tv] = await Promise.all([holeSpielplan(), holeTvProgramm()]);

const hinweise = [];

if (tv.fehler) {
  console.log(`  ⚠ FotMob nicht erreichbar: ${tv.fehler}`);
  console.log('  ⚠ Nachricht geht ohne Sender und ohne ÖBL/EL/ECL raus.');
  hinweise.push('Sender gerade nicht abrufbar');
} else {
  console.log(`  TV-Programm: ${tv.matches.length} Spiele${tv.stale ? ' (aus dem Zwischenspeicher)' : ''}`);
}

for (const f of plan.fehler) {
  console.log(`  ⚠ Spielplan unvollstaendig – ${f}`);
  hinweise.push('Spielplan unvollständig');
}

const spiele = zusammenfuehren(plan.spiele, tv.matches);

console.log(`  ${spiele.length} Spiele heute, davon ${spiele.filter((s) => s.channels.length).length} mit Sender`);

if (spiele.length === 0 && !postWhenEmpty) {
  console.log('Keine Spiele und POST_WHEN_EMPTY=false – es wird nichts gepostet.');
  process.exit(0);
}

const embeds = baueEmbeds(spiele, [...new Set(hinweise)]);

if (dryRun) {
  console.log('\n--- Vorschau ------------------------------------------------');
  for (const e of embeds) {
    console.log(`\n${e.title}\n`);
    console.log(e.description);
    if (e.footer) console.log(`\n[${e.footer.text}]`);
  }
  console.log('\n-------------------------------------------------------------');
  console.log('Trockenlauf – nichts verschickt.');
  process.exit(0);
}

await sendeAnDiscord(webhook, embeds);
console.log('Nachricht an Discord verschickt.');
process.exit(0);
