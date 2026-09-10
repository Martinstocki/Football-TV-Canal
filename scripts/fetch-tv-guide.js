#!/usr/bin/env node
/**
 * Liest das oesterreichische TV-Programm von FotMob und schreibt:
 *
 *   1. tv_channels          Rohergebnis - eine Zeile je Spiel und Sender
 *   2. fixtures             Spiele der oesterreichischen Bundesliga (AT1),
 *                           die football-data.org im Free-Tier nicht liefert
 *   3. broadcast_overrides  exakte Sender fuer die Web-App (source='fotmob')
 *   4. fixtures.channels    dieselben Sender als JSON an der Zeile
 *
 * Aufruf:
 *   npm run tv                          normaler Lauf
 *   node scripts/fetch-tv-guide.js --dry-run --verbose
 *   node scripts/fetch-tv-guide.js --force        Zwischenspeicher ignorieren
 *   node scripts/fetch-tv-guide.js --country DE
 *   node scripts/fetch-tv-guide.js --no-fixtures  keine AT1-Spiele anlegen
 *
 * Ruecksicht auf die Quelle: eine Anfrage pro Lauf, danach mindestens sechs
 * Stunden Pause (--min-interval in Sekunden), dazwischen aus dem
 * Zwischenspeicher unter data/cache/. Siehe backend/services/fotmobGuide.js.
 */
import 'dotenv/config';
import { db, initSchema } from '../backend/db/index.js';
import { loadGuide } from '../backend/services/fotmobGuide.js';
import { findBestMatch, canonical } from '../backend/services/teamMatching.js';
import {
  buildParallelIndex,
  selectChannels,
  selectedOnly,
} from '../backend/services/channelSelection.js';
import {
  competitionFromFotmob,
  FOTMOB_ONLY_COMPETITIONS,
} from '../backend/config/competitions.js';

// --- Argumente -------------------------------------------------------------

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const country = String(arg('country', process.env.DEFAULT_COUNTRY || 'AT')).toUpperCase();
const threshold = Number(arg('threshold', 0.7));
const minIntervalSec = Number(arg('min-interval', process.env.SCRAPER_MIN_INTERVAL_SEC ?? 6 * 3600));
const dryRun = flag('dry-run');
const verbose = flag('verbose');
const force = flag('force');
const importFixtures = !flag('no-fixtures');

const TOLERANZ_MINUTEN = 120;

// FotMob-Spiel-IDs sind sechs- bis siebenstellig, football-data-IDs ebenso.
// Damit sich beide in fixtures.id nicht ins Gehege kommen, bekommen
// FotMob-Zeilen einen festen Versatz.
const FOTMOB_ID_OFFSET = 900_000_000;

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const zeit = (utc) =>
  new Date(utc).toLocaleString('de-AT', {
    weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: process.env.TZ || 'Europe/Vienna',
  });

initSchema();

// --- 1. Seite holen --------------------------------------------------------

console.log(`Land: ${country}${dryRun ? '   (Trockenlauf)' : ''}`);

const guide = await loadGuide(country, { minIntervalSec, force });

if (guide.stale) {
  console.log(`  ⚠ Abruf fehlgeschlagen (${guide.error})`);
  console.log(`  ⚠ Verwende Zwischenspeicher, ${Math.round(guide.ageSec / 60)} Minuten alt.`);
} else if (guide.fromCache) {
  const min = Math.round(guide.ageSec / 60);
  console.log(`  Aus dem Zwischenspeicher (${min} min alt, Mindestabstand ${minIntervalSec / 3600} h).`);
  console.log(`  Mit --force einen frischen Abruf erzwingen.`);
} else {
  console.log(`  Frisch abgerufen: ${guide.url}`);
}

const gefunden = guide.matches;
console.log(`  ${gefunden.length} Spiele, ${gefunden.reduce((s, m) => s + m.channels.length, 0)} Sendereintraege\n`);

// --- 2. Unsere Spiele laden ------------------------------------------------

const unsereFixtures = db
  .prepare(
    `SELECT id, competition, home_team AS home, away_team AS away, kickoff_utc AS kickoff
       FROM fixtures WHERE kickoff_utc >= datetime('now', '-1 day')`
  )
  .all();

const unsereMatches = db
  .prepare(
    `SELECT id, competition_code AS competition, home_team AS home, away_team AS away,
            utc_date AS kickoff
       FROM matches WHERE utc_date >= datetime('now', '-1 day')`
  )
  .all();

// --- 3. Vorbereitete Anweisungen -------------------------------------------

const stmt = {
  tvClear: db.prepare(`DELETE FROM tv_channels WHERE source = 'fotmob' AND country = ?`),

  tvInsert: db.prepare(`
    INSERT INTO tv_channels (
      fixture_id, match_id, source, source_match_id, country,
      league_id, league_name, league_ccode, competition,
      home_team, away_team, home_team_id, away_team_id, kickoff_utc,
      sender_name, sender_type, position,
      is_selected, drop_reason, parallel_count
    ) VALUES (
      @fixtureId, @matchId, 'fotmob', @sourceMatchId, @country,
      @leagueId, @leagueName, @leagueCcode, @competition,
      @home, @away, @homeId, @awayId, @kickoffUtc,
      @senderName, @senderType, @position,
      @isSelected, @dropReason, @parallelCount
    )
    ON CONFLICT (source, source_match_id, country, sender_name) DO UPDATE SET
      fixture_id  = excluded.fixture_id,
      match_id    = excluded.match_id,
      sender_type = excluded.sender_type,
      position    = excluded.position,
      is_selected = excluded.is_selected,
      drop_reason = excluded.drop_reason,
      parallel_count = excluded.parallel_count,
      scraped_at  = datetime('now')
  `),

  fixtureUpsert: db.prepare(`
    INSERT INTO fixtures (
      id, competition, home_team, away_team, kickoff_utc, status,
      source, source_match_id
    ) VALUES (
      @id, @competition, @home, @away, @kickoffUtc, 'SCHEDULED',
      'fotmob', @sourceMatchId
    )
    ON CONFLICT (id) DO UPDATE SET
      home_team   = excluded.home_team,
      away_team   = excluded.away_team,
      kickoff_utc = excluded.kickoff_utc,
      fetched_at  = datetime('now')
  `),

  matchUpsert: db.prepare(`
    INSERT INTO matches (
      provider, provider_match_id, competition_code, utc_date, status,
      home_team, away_team
    ) VALUES (
      'fotmob', @sourceMatchId, @competition, @kickoffUtc, 'SCHEDULED', @home, @away
    )
    ON CONFLICT (provider, provider_match_id) DO UPDATE SET
      utc_date   = excluded.utc_date,
      home_team  = excluded.home_team,
      away_team  = excluded.away_team,
      updated_at = datetime('now')
  `),

  matchId: db.prepare(
    `SELECT id FROM matches WHERE provider = 'fotmob' AND provider_match_id = ?`
  ),

  fixtureChannels: db.prepare(`
    UPDATE fixtures
       SET channels = ?, channels_source = 'fotmob', channels_updated_at = datetime('now')
     WHERE id = ?
  `),

  ovClear: db.prepare(
    `DELETE FROM broadcast_overrides WHERE match_id = ? AND country = ? AND source = 'fotmob'`
  ),
  ovHasManual: db.prepare(
    `SELECT 1 FROM broadcast_overrides WHERE match_id = ? AND country = ? AND source = 'manual'`
  ),
  ovInsert: db.prepare(`
    INSERT INTO broadcast_overrides (match_id, country, channel, type, note, source)
    VALUES (?, ?, ?, ?, NULL, 'fotmob')
    ON CONFLICT (match_id, country, channel)
    DO UPDATE SET type = excluded.type, source = 'fotmob'
  `),

  logInsert: db.prepare(`
    INSERT INTO scrape_log (source, country, from_cache, matches, channels, status, message)
    VALUES ('fotmob', ?, ?, ?, ?, ?, ?)
  `),
};

// --- 4. Zuordnen -----------------------------------------------------------

/** Kandidaten nach Anstosszeit vorfiltern, dann ueber Teamnamen zuordnen. */
function zuordnen(kandidaten, spiel) {
  const kickoff = new Date(spiel.kickoffUtc);
  const passend = kandidaten.filter(
    (k) => Math.abs(new Date(k.kickoff) - kickoff) / 60000 <= TOLERANZ_MINUTEN
  );
  return findBestMatch({ home: spiel.home, away: spiel.away }, passend, threshold);
}

const zeilen = [];
const neueFixtures = [];

// Jede Zuordnung wird festgehalten - auch die ohne Sender. Sonst blieben
// alte Eintraege stehen, wenn ein Spiel seine Sender wieder verliert
// (FotMob setzt sie auf "noch zu bestaetigen" zurueck).
const zuordnungen = [];

let zugeordnetFixture = 0;
let zugeordnetMatch = 0;

// Ob "Sky Sport Austria 1" die Konferenz ist oder der Kanal dieses Spiels,
// zeigt sich erst im Vergleich mit den zeitgleichen Partien.
const parallelIndex = buildParallelIndex(gefunden);
const gefiltert = { geprueft: 0, entfernt: 0, gruende: new Map() };

for (const spiel of gefunden) {
  const competition = competitionFromFotmob(spiel.leagueId, spiel.leagueName);

  const tFix = zuordnen(unsereFixtures, spiel);
  const tMat = zuordnen(unsereMatches, spiel);

  if (tFix) zugeordnetFixture++;
  if (tMat) zugeordnetMatch++;

  // Filterregeln anwenden: bewertet enthaelt alles, sichtbar nur die Auswahl.
  const bewertet = selectChannels(spiel, parallelIndex);
  const sichtbar = selectedOnly(bewertet);

  gefiltert.geprueft += bewertet.length;
  for (const c of bewertet) {
    if (c.selected) continue;
    gefiltert.entfernt++;
    const grund = c.dropReason.startsWith('konferenz')
      ? 'konferenz'
      : c.dropReason.startsWith('unspezifischer')
        ? 'unspezifischer'
        : c.dropReason;
    gefiltert.gruende.set(grund, (gefiltert.gruende.get(grund) ?? 0) + 1);
  }

  if (tFix || tMat) {
    zuordnungen.push({
      sourceMatchId: spiel.sourceMatchId,
      fixtureId: tFix?.kandidat.id ?? null,
      matchId: tMat?.kandidat.id ?? null,
      channels: sichtbar,
    });
  }

  // Wettbewerbe, die wir sonst nirgends herbekommen, hier anlegen.
  const istEigenquelle =
    importFixtures && competition && FOTMOB_ONLY_COMPETITIONS.includes(competition);

  if (istEigenquelle && !tFix) {
    neueFixtures.push({ ...spiel, competition, channels: sichtbar });
  }

  for (const ch of bewertet) {
    zeilen.push({
      fixtureId: tFix?.kandidat.id ?? null,
      matchId: tMat?.kandidat.id ?? null,
      sourceMatchId: spiel.sourceMatchId,
      country,
      leagueId: spiel.leagueId,
      leagueName: spiel.leagueName,
      leagueCcode: spiel.leagueCcode,
      competition,
      home: spiel.home,
      away: spiel.away,
      homeId: spiel.homeId,
      awayId: spiel.awayId,
      kickoffUtc: spiel.kickoffUtc,
      senderName: ch.name,
      senderType: ch.type,
      position: ch.position,
      isSelected: ch.selected ? 1 : 0,
      dropReason: ch.dropReason,
      parallelCount: ch.parallel,
    });
  }

  if (verbose && (tFix || istEigenquelle)) {
    const weg = bewertet.filter((c) => !c.selected).map((c) => c.name);
    console.log(
      `  ✓ ${pad(competition ?? spiel.leagueName, 6)} ${pad(`${spiel.home} – ${spiel.away}`, 38)} ` +
        `${sichtbar.map((c) => c.name).join(', ')}` +
        (weg.length ? `   (weg: ${weg.join(', ')})` : '')
    );
  }
}

// --- 5. Schreiben ----------------------------------------------------------

let ergebnis = { tvZeilen: 0, neueFixtures: 0, overrides: 0, uebersprungen: 0 };

if (!dryRun) {
  db.transaction(() => {
    // Neue AT1-Spiele zuerst, damit die tv_channels-Zeilen sie schon treffen.
    for (const s of neueFixtures) {
      const fixtureId = FOTMOB_ID_OFFSET + s.sourceMatchId;

      stmt.fixtureUpsert.run({
        id: fixtureId,
        competition: s.competition,
        home: s.home,
        away: s.away,
        kickoffUtc: s.kickoffUtc,
        sourceMatchId: String(s.sourceMatchId),
      });

      stmt.matchUpsert.run({
        sourceMatchId: String(s.sourceMatchId),
        competition: s.competition,
        kickoffUtc: s.kickoffUtc,
        home: s.home,
        away: s.away,
      });

      const matchId = stmt.matchId.get(String(s.sourceMatchId))?.id ?? null;

      // Die eben angelegten Zeilen den passenden tv_channels zuweisen.
      for (const z of zeilen) {
        if (z.sourceMatchId !== s.sourceMatchId) continue;
        z.fixtureId ??= fixtureId;
        z.matchId ??= matchId;
      }

      zuordnungen.push({
        sourceMatchId: s.sourceMatchId,
        fixtureId,
        matchId,
        channels: s.channels,
      });

      ergebnis.neueFixtures++;
    }

    stmt.tvClear.run(country);
    for (const z of zeilen) {
      stmt.tvInsert.run(z);
      ergebnis.tvZeilen++;
    }

    // fixtures.channels und broadcast_overrides neu setzen - fuer JEDE
    // Zuordnung, auch die ohne Sender. Ein leeres Ergebnis loescht die
    // alten Eintraege, statt sie stehen zu lassen.
    for (const z of zuordnungen) {
      const chs = z.channels.map((c) => ({ name: c.name, type: c.type }));

      if (z.fixtureId) {
        stmt.fixtureChannels.run(chs.length ? JSON.stringify(chs) : null, z.fixtureId);
      }

      if (!z.matchId) continue;

      if (stmt.ovHasManual.get(z.matchId, country)) {
        ergebnis.uebersprungen++;
        continue;
      }

      stmt.ovClear.run(z.matchId, country);
      for (const ch of chs) {
        stmt.ovInsert.run(z.matchId, country, ch.name, ch.type);
        ergebnis.overrides++;
      }
    }
  })();

  stmt.logInsert.run(
    country,
    guide.fromCache ? 1 : 0,
    gefunden.length,
    ergebnis.tvZeilen,
    guide.stale ? 'stale' : 'ok',
    guide.stale ? guide.error : null
  );
}

// --- 6. Bericht ------------------------------------------------------------

console.log('Filter (backend/config/channelRules.js):');
console.log(`  Sendereintraege geprueft:    ${gefiltert.geprueft}`);
console.log(`  davon ausgeblendet:          ${gefiltert.entfernt}`);
for (const [grund, n] of [...gefiltert.gruende].sort((a, b) => b[1] - a[1])) {
  console.log(`      ${pad(grund, 26)} ${n}`);
}
console.log(`  bleiben sichtbar:            ${gefiltert.geprueft - gefiltert.entfernt}\n`);

console.log('Zuordnung:');
console.log(`  Spiele auf der Seite:        ${gefunden.length}`);
console.log(`  davon fixtures zugeordnet:   ${zugeordnetFixture}`);
console.log(`  davon matches zugeordnet:    ${zugeordnetMatch}`);
console.log(`  neu angelegt (${FOTMOB_ONLY_COMPETITIONS.join(', ')}):        ${neueFixtures.length}`);

if (dryRun) {
  console.log('\nTrockenlauf - nichts geschrieben.');
} else {
  console.log(`\nGeschrieben:`);
  console.log(`  tv_channels:          ${ergebnis.tvZeilen} Zeilen`);
  console.log(`  neue Spiele:          ${ergebnis.neueFixtures}`);
  console.log(`  broadcast_overrides:  ${ergebnis.overrides}`);
  if (ergebnis.uebersprungen > 0) {
    console.log(`  uebersprungen (Handarbeit vorhanden): ${ergebnis.uebersprungen}`);
  }
}

// --- 7. Was ist mit unseren Spielen ohne Sender? ----------------------------

const ohne = db
  .prepare(
    `SELECT competition, home_team, away_team, kickoff_utc
       FROM fixtures
      WHERE kickoff_utc >= datetime('now', '-1 day') AND channels IS NULL
      ORDER BY kickoff_utc`
  )
  .all();

if (ohne.length > 0) {
  console.log(`\n${'─'.repeat(72)}`);
  console.log(`Ohne Sender (zeigen den Platzhalter): ${ohne.length}`);
  console.log('─'.repeat(72));
  for (const r of ohne.slice(0, 15)) {
    console.log(`  ${pad(zeit(r.kickoff_utc), 19)} ${pad(r.competition, 5)} ${r.home_team} – ${r.away_team}`);
    console.log(`  ${' '.repeat(19)}       "${canonical(r.home_team)}" / "${canonical(r.away_team)}"`);
  }
  if (ohne.length > 15) console.log(`  … und ${ohne.length - 15} weitere`);
  console.log('\nSteht ein Spiel hier, obwohl FotMob es hat: Schreibweise in');
  console.log('backend/config/teamAliases.js ergaenzen und erneut laufen lassen.');
}

// --- 8. Ligen, die wir nicht kennen ----------------------------------------

const unbekannt = new Map();
for (const s of gefunden) {
  if (competitionFromFotmob(s.leagueId, s.leagueName)) continue;
  const k = `${s.leagueId}`;
  if (!unbekannt.has(k)) unbekannt.set(k, { ...s, n: 0 });
  unbekannt.get(k).n++;
}

if (unbekannt.size > 0 && verbose) {
  console.log(`\nNicht zugeordnete Ligen auf der Seite (${unbekannt.size}):`);
  for (const l of [...unbekannt.values()].sort((a, b) => b.n - a.n).slice(0, 15)) {
    console.log(`  id=${String(l.leagueId).padStart(6)} ${pad(l.leagueCcode, 4)} ${pad(l.leagueName, 34)} ${l.n} Spiele`);
  }
  console.log('Interessiert dich eine davon: in backend/config/competitions.js');
  console.log('bei FOTMOB_LEAGUE_MAP ergaenzen.');
}

process.exit(0);
