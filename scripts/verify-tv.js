#!/usr/bin/env node
/**
 * Belegt, dass die Sender aus der Live-Seite kommen und nicht aus der
 * Regeltabelle.
 *
 *   node scripts/verify-tv.js
 *   node scripts/verify-tv.js --team Bayern
 *   node scripts/verify-tv.js --competition CL
 *
 * Fuer jedes Beispielspiel werden drei Dinge nebeneinandergestellt:
 *   ALT      was die feste Regeltabelle sagen wuerde
 *   DB       was gerade in unserer Datenbank steht
 *   LIVE     was fotmob.com in DIESEM Moment ausliefert
 *
 * Stimmen DB und LIVE ueberein und weichen von ALT ab, ist der Beweis erbracht.
 */
import 'dotenv/config';
import { db, initSchema } from '../backend/db/index.js';
import { loadGuide } from '../backend/services/fotmobGuide.js';
import { findBestMatch } from '../backend/services/teamMatching.js';
import { channelsByRule, PLACEHOLDER } from '../backend/services/broadcasts.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const country = String(arg('country', process.env.DEFAULT_COUNTRY || 'AT')).toUpperCase();
const team = arg('team');
const competition = arg('competition');

initSchema();

// --- Beispielspiele auswaehlen ---------------------------------------------

const where = [`kickoff_utc >= datetime('now', '-1 day')`];
const params = [];

if (team) {
  where.push('(home_team LIKE ? OR away_team LIKE ?)');
  params.push(`%${team}%`, `%${team}%`);
}
if (competition) {
  where.push('competition = ?');
  params.push(competition.toUpperCase());
}

let beispiele = db
  .prepare(
    `SELECT id, competition, home_team, away_team, kickoff_utc, channels, channels_source
       FROM fixtures
      WHERE ${where.join(' AND ')}
      ORDER BY kickoff_utc
      LIMIT 40`
  )
  .all(params);

// Ohne Filter: bewusst gemischt auswaehlen - mehrere Parallelspiele derselben
// Runde (dort trennt nur die Kanalnummer), dazu ein Spiel ohne Treffer.
if (!team && !competition) {
  const mitSender = beispiele.filter((r) => r.channels);
  const ohneSender = beispiele.filter((r) => !r.channels);

  const cl = mitSender.filter((r) => r.competition === 'CL').slice(0, 3);
  const andere = mitSender.filter((r) => r.competition !== 'CL').slice(0, 2);

  beispiele = [...cl, ...andere, ...ohneSender.slice(0, 1)];
}

if (beispiele.length === 0) {
  console.log('Keine passenden Spiele in der Tabelle "fixtures".');
  process.exit(0);
}

// --- Live-Stand holen ------------------------------------------------------

console.log(`Rufe fotmob.com/de/tv-guide/${country.toLowerCase()} frisch ab ...`);

// Fuer den Nachweis immer frisch laden - der Zwischenspeicher wuerde die
// Beweisfuehrung entwerten.
const guide = await loadGuide(country, { force: true });
const events = guide.matches.map((m) => ({
  home: m.home,
  away: m.away,
  startUtc: m.kickoffUtc,
  channels: m.channels,
  leagueName: m.leagueName,
}));
console.log(`  ${events.length} Spiele, abgerufen ${new Date().toLocaleTimeString('de-AT')}\n`);

const zeit = (utc) =>
  new Date(utc).toLocaleString('de-AT', {
    weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
    timeZone: process.env.TZ || 'Europe/Vienna',
  });

const namen = (list) => (list.length ? list.map((c) => c.name).join(', ') : '—');

let stimmig = 0;
let abweichend = 0;

for (const row of beispiele) {
  console.log('═'.repeat(78));
  console.log(`${row.home_team} – ${row.away_team}`);
  console.log(`${zeit(row.kickoff_utc)}   ${row.competition}   fixtures.id ${row.id}`);
  console.log('─'.repeat(78));

  // ALT: die feste Tabelle
  const regel = channelsByRule(row.competition, country);
  console.log(`  ALT   (feste Tabelle)  ${namen(regel) || '—'}`);

  // DB: was gespeichert ist
  const gespeichert = row.channels ? JSON.parse(row.channels) : [];
  console.log(
    `  DB    (gespeichert)    ${gespeichert.length ? namen(gespeichert) : PLACEHOLDER.name}` +
      (row.channels_source ? `   [${row.channels_source}]` : '')
  );

  // LIVE: was die Seite jetzt sagt
  const kickoff = new Date(row.kickoff_utc);
  const zeitlichPassend = events.filter(
    (e) => Math.abs(new Date(e.startUtc) - kickoff) / 60000 <= 120
  );
  const best = findBestMatch(
    { home: row.home_team, away: row.away_team },
    zeitlichPassend,
    0.7
  );
  const live = best?.kandidat.channels ?? [];

  console.log(
    `  LIVE  (fotmob.com)     ${live.length ? namen(live) : 'kein Eintrag auf der Seite'}` +
      (best ? `   [Zuordnung ${best.kandidat.home} – ${best.kandidat.away}, ${best.score.toFixed(2)}]` : '')
  );

  // Urteil
  const a = namen(gespeichert);
  const b = namen(live);

  if (a === b && live.length > 0) {
    stimmig++;
    const grobGleich = namen(regel) === a;
    console.log(
      `  ⇒ DB == LIVE` + (grobGleich ? '' : ', und beide weichen von der festen Tabelle ab')
    );
  } else if (live.length === 0 && gespeichert.length === 0) {
    stimmig++;
    console.log(`  ⇒ FotMob kennt das Spiel nicht → Platzhalter, keine geratene Angabe`);
  } else {
    abweichend++;
    console.log(`  ⇒ ACHTUNG: DB und LIVE unterscheiden sich (Programm geaendert?)`);
  }
}

console.log('═'.repeat(78));
console.log(`${stimmig} von ${beispiele.length} Beispielen stimmig, ${abweichend} abweichend.`);
