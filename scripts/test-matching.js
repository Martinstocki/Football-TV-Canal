#!/usr/bin/env node
/**
 * Prueft die Vereinsnamen-Zuordnung ohne Netz und ohne Datenbank.
 *
 *   node scripts/test-matching.js
 *
 * Links steht die Schreibweise von football-data.org, rechts die von FotMob.
 * Die letzten Faelle MUESSEN scheitern - das sind die gefaehrlichen:
 * Reserve-, Jugend- und Frauenmannschaften duerfen nie auf die Profis passen.
 */
import { similarity, canonical, normalize, teamMarker } from '../backend/services/teamMatching.js';

const SOLL_PASSEN = [
  ['Man United', 'Manchester United'],
  ['Slavia Praha', 'Slavia Prague'],
  ['Shaktar', 'Shakhtar Donetsk'],
  ['RC Lens', 'Lens'],
  ['Como 1907', 'Como'],
  ['PSV', 'PSV Eindhoven'],
  ['Bayern', 'Bayern München'],
  ["M'gladbach", 'Borussia Mönchengladbach'],
  ['HSV', 'Hamburger SV'],
  ['Bremen', 'Werder Bremen'],
  ['Barça', 'Barcelona'],
  ['Atleti', 'Atlético Madrid'],
  ['1. FC Köln', 'Köln'],
  ['Fenerbahçe', 'Fenerbahçe'],
  ['Bodø/Glimt', 'Bodø/Glimt'],
  ['Sabah FK', 'Sabah FK'],
  ['Real Madrid', 'Real Madrid'],
  ['Nottingham', 'Nottingham Forest'],
  ['Brighton Hove', 'Brighton & Hove Albion'],
  ['Olympique Lyon', 'Lyon'],
  ['Stade Rennais', 'Rennes'],
  ['Santander', 'Racing Santander'],
  ['Rapid Wien', 'Rapid Wien'],
  ['Salzburg', 'Red Bull Salzburg'],
];

const DARF_NICHT_PASSEN = [
  ['Rapid Wien', 'Rapid Wien II'],
  ['Bayern München', 'Bayern München U19'],
  ['Werder Bremen', 'Werder Bremen (W)'],
  ['Austria Wien', 'Austria Wien II'],
  ['Real Madrid', 'Barcelona'],
  ['Inter', 'Milan'],
  ['Como', 'Roma'],
];

const SCHWELLE = 0.7;
let fehler = 0;

console.log('Sollen zusammenpassen (Schwelle ' + SCHWELLE + '):');
console.log('─'.repeat(78));

for (const [a, b] of SOLL_PASSEN) {
  const s = similarity(a, b);
  const ok = s >= SCHWELLE;
  if (!ok) fehler++;
  console.log(
    `  ${ok ? '✓' : '✗'} ${String(s.toFixed(2)).padStart(4)}  ` +
      `${a.padEnd(24)} ↔ ${b.padEnd(26)} "${canonical(a)}" / "${canonical(b)}"`
  );
}

console.log('\nDuerfen NICHT zusammenpassen:');
console.log('─'.repeat(78));

for (const [a, b] of DARF_NICHT_PASSEN) {
  const s = similarity(a, b);
  const ok = s < SCHWELLE;
  if (!ok) fehler++;
  const marker = `${teamMarker(a) ?? '–'}/${teamMarker(b) ?? '–'}`;
  console.log(
    `  ${ok ? '✓' : '✗'} ${String(s.toFixed(2)).padStart(4)}  ` +
      `${a.padEnd(24)} ↔ ${b.padEnd(26)} Marker ${marker}`
  );
}

console.log('\nNormalisierung einzelner Namen:');
console.log('─'.repeat(78));
for (const n of ['1. FC Köln', 'Como 1907', 'Bodø/Glimt', 'Fenerbahçe', 'M\'gladbach', 'Schalke 04']) {
  console.log(`  ${n.padEnd(18)} → "${normalize(n)}"`);
}

console.log(`\n${fehler === 0 ? 'Alle Faelle wie erwartet.' : `${fehler} Fall/Faelle abweichend.`}`);
process.exit(fehler === 0 ? 0 : 1);
