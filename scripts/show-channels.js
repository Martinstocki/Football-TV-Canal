#!/usr/bin/env node
/**
 * Zeigt je Spiel ALLE Sendereintraege von FotMob und markiert, welche die
 * Filterregeln uebrig lassen - mit Begruendung fuer jeden aussortierten.
 *
 *   npm run tv:channels                     Beispiele quer durch die Ligen
 *   node scripts/show-channels.js --team Bayern
 *   node scripts/show-channels.js --competition CL
 *   node scripts/show-channels.js --provider DAZN
 *   node scripts/show-channels.js --all-dropped   nur die Ausblendgruende
 *
 * Gedacht zum Nachsehen, bevor man in backend/config/channelRules.js
 * etwas ergaenzt.
 */
import 'dotenv/config';
import { db, initSchema } from '../backend/db/index.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

initSchema();

const team = arg('team');
const competition = arg('competition');
const provider = arg('provider');

const zeit = (utc) =>
  new Date(utc).toLocaleString('de-AT', {
    weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: process.env.TZ || 'Europe/Vienna',
  });

// --- Nur die Ausblendgruende, gesammelt ------------------------------------

if (flag('all-dropped')) {
  console.log('Ausgeblendete Sendereintraege, gruppiert:\n');
  const rows = db
    .prepare(
      `SELECT sender_name, drop_reason, COUNT(*) n
         FROM tv_channels WHERE is_selected = 0
        GROUP BY sender_name, drop_reason ORDER BY n DESC`
    )
    .all();
  for (const r of rows) {
    console.log(`  ${String(r.n).padStart(3)}x  ${r.sender_name.padEnd(30)} ${r.drop_reason}`);
  }
  console.log(`\n${rows.reduce((s, r) => s + r.n, 0)} Eintraege ausgeblendet.`);
  process.exit(0);
}

// --- Beispielspiele waehlen ------------------------------------------------

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
if (provider) {
  where.push(
    `source_match_id IN (SELECT source_match_id FROM tv_channels WHERE sender_name LIKE ?)`
  );
  params.push(`%${provider}%`);
}

let spiele = db
  .prepare(
    `SELECT DISTINCT source_match_id, competition, league_name, home_team, away_team, kickoff_utc
       FROM tv_channels
      WHERE ${where.join(' AND ')}
      ORDER BY kickoff_utc
      LIMIT 60`
  )
  .all(params);

// Ohne Filter: bewusst mischen - Sky mit Parallelspielen, DAZN, Österreich.
if (!team && !competition && !provider) {
  const proWettbewerb = new Map();
  for (const s of spiele) {
    if (!s.competition) continue;
    if (!proWettbewerb.has(s.competition)) proWettbewerb.set(s.competition, []);
    proWettbewerb.get(s.competition).push(s);
  }
  spiele = [
    ...(proWettbewerb.get('CL') ?? []).slice(0, 2),
    ...(proWettbewerb.get('BL1') ?? []).slice(0, 1),
    ...(proWettbewerb.get('AT1') ?? []).slice(0, 1),
    ...(proWettbewerb.get('SA') ?? []).slice(0, 1),
    ...(proWettbewerb.get('FL1') ?? []).slice(0, 1),
  ];
}

if (spiele.length === 0) {
  console.log('Keine passenden Spiele. Erst "npm run tv" laufen lassen?');
  process.exit(0);
}

// --- Ausgabe ---------------------------------------------------------------

const eintraege = db.prepare(
  `SELECT sender_name, sender_type, is_selected, drop_reason, parallel_count, position
     FROM tv_channels WHERE source_match_id = ? ORDER BY position`
);

let gezeigt = 0;
let behalten = 0;
let entfernt = 0;

for (const s of spiele.slice(0, 8)) {
  const rows = eintraege.all(s.source_match_id);
  if (rows.length === 0) continue;
  gezeigt++;

  console.log('═'.repeat(74));
  console.log(`${s.home_team} – ${s.away_team}`);
  console.log(`${zeit(s.kickoff_utc)}   ${s.competition ?? s.league_name}`);
  console.log('─'.repeat(74));

  for (const r of rows) {
    if (r.is_selected) {
      behalten++;
      const par = r.parallel_count > 1 ? `  (${r.parallel_count} zeitgleiche Spiele)` : '';
      console.log(`  ✓  ${r.sender_name.padEnd(28)} ${r.sender_type.padEnd(7)}${par}`);
    } else {
      entfernt++;
      console.log(`  ✗  ${r.sender_name.padEnd(28)} ${''.padEnd(7)}${r.drop_reason}`);
    }
  }

  const sichtbar = rows.filter((r) => r.is_selected).map((r) => r.sender_name);
  console.log(`  ⇒ Angezeigt: ${sichtbar.join(', ') || 'nichts – Platzhalter'}`);
}

console.log('═'.repeat(74));
console.log(`${gezeigt} Spiele, ${behalten} Einträge behalten, ${entfernt} ausgeblendet.`);
