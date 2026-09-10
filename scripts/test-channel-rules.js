#!/usr/bin/env node
/**
 * Prueft die Sender-Filterregeln ohne Netz und ohne Datenbank.
 *
 *   npm run test:channels
 *
 * Der Schwerpunkt liegt auf dem Fall, der uns schon einmal um die Ohren
 * geflogen ist: Sender mit Zweitverwertungsrecht auf EIN Spiel pro Spieltag
 * (ServusTV bei Europa/Conference League, ORF bei oesterreichischen Spielen).
 * Die duerfen weder pauschal erscheinen noch versehentlich herausfallen.
 */
import { buildParallelIndex, selectChannels, selectedOnly } from '../backend/services/channelSelection.js';

const ch = (...namen) =>
  namen.map((name, position) => ({
    name,
    position,
    type: /sky x|sky go|dazn|joyn|on$/i.test(name) ? 'stream' : 'tv',
  }));

// Ein realistischer Conference-League-Spieltag: acht Spiele um 21:00.
// ServusTV zeigt genau eines davon frei empfangbar (das mit Rapid).
const CONFERENCE_SPIELTAG = [
  {
    name: 'Rapid Wien – Fiorentina',
    kickoffUtc: '2026-10-15T19:00:00.000Z',
    channels: ch('ServusTV', 'ServusTV On', 'Joyn', 'Sky Sport Austria 3', 'Sky X', 'Sky Go'),
    erwartet: ['ServusTV', 'Sky Sport Austria 3'],
  },
  {
    name: 'Gent – Djurgården',
    kickoffUtc: '2026-10-15T19:00:00.000Z',
    channels: ch('Sky Sport Austria 4', 'Sky Sport Austria 1', 'Sky X', 'Sky Go'),
    erwartet: ['Sky Sport Austria 4'],
  },
  {
    name: 'Legia Warschau – Crystal Palace',
    kickoffUtc: '2026-10-15T19:00:00.000Z',
    channels: ch('Sky Sport Austria 5', 'Sky Sport Austria 1', 'Sky X', 'Sky Go'),
    erwartet: ['Sky Sport Austria 5'],
  },
  {
    name: 'Jagiellonia – Rayo Vallecano',
    kickoffUtc: '2026-10-15T19:00:00.000Z',
    channels: ch('Sky Sport Austria 1', 'Sky X', 'Sky Go'),
    // Nur die Konferenz vorhanden - dann muss sie stehen bleiben,
    // sonst haette das Spiel gar keinen Sender.
    erwartet: ['Sky Sport Austria 1'],
  },
  {
    name: 'Sturm Graz – Shakhtar (Qualifikation)',
    kickoffUtc: '2026-08-27T17:00:00.000Z',
    channels: ch('ORF 1', 'ORF ON App', 'Sky Sport Austria 2', 'Sky X'),
    erwartet: ['ORF 1', 'Sky Sport Austria 2'],
  },
];

// Kontrollfall aus den echten Daten: fuenf zeitgleiche Bundesligaspiele.
const BUNDESLIGA_KONFERENZ = [
  {
    name: 'Dortmund – Paderborn',
    kickoffUtc: '2026-09-12T13:30:00.000Z',
    channels: ch('Sky Sport Bundesliga 1', 'Sky X', 'Sky Sport Bundesliga', 'Sky Sport Top Event'),
    erwartet: ['Sky Sport Bundesliga 1'],
  },
  {
    name: 'Augsburg – Leverkusen',
    kickoffUtc: '2026-09-12T13:30:00.000Z',
    channels: ch('Sky Sport Bundesliga 4', 'Sky X', 'Sky Sport Bundesliga'),
    erwartet: ['Sky Sport Bundesliga 4'],
  },
  {
    name: 'Freiburg – Gladbach',
    kickoffUtc: '2026-09-12T13:30:00.000Z',
    channels: ch('Sky Sport Bundesliga 3', 'Sky X', 'Sky Sport Bundesliga'),
    erwartet: ['Sky Sport Bundesliga 3'],
  },
  {
    name: 'Hoffenheim – Stuttgart',
    kickoffUtc: '2026-09-12T13:30:00.000Z',
    channels: ch('Sky Sport Bundesliga 2', 'Sky X', 'Sky Sport Bundesliga'),
    erwartet: ['Sky Sport Bundesliga 2'],
  },
  {
    name: 'Mainz – Frankfurt',
    kickoffUtc: '2026-09-12T13:30:00.000Z',
    channels: ch('Sky Sport Bundesliga 5', 'Sky X', 'Sky Sport Bundesliga'),
    erwartet: ['Sky Sport Bundesliga 5'],
  },
];

const GRUPPEN = [
  ['Conference League – ServusTV zeigt EIN Spiel', CONFERENCE_SPIELTAG],
  ['Bundesliga – fünf zeitgleiche Spiele', BUNDESLIGA_KONFERENZ],
];

let fehler = 0;

for (const [titel, spiele] of GRUPPEN) {
  console.log(`\n${titel}`);
  console.log('─'.repeat(78));

  const index = buildParallelIndex(spiele);

  for (const spiel of spiele) {
    const bewertet = selectChannels(spiel, index);
    const sichtbar = selectedOnly(bewertet).map((c) => c.name);

    const ok =
      sichtbar.length === spiel.erwartet.length &&
      spiel.erwartet.every((e) => sichtbar.includes(e));

    if (!ok) fehler++;

    console.log(`  ${ok ? '✓' : '✗'} ${spiel.name}`);
    console.log(`      erwartet:  ${spiel.erwartet.join(', ')}`);
    console.log(`      bekommen:  ${sichtbar.join(', ') || '(nichts)'}`);

    if (!ok) {
      for (const c of bewertet.filter((x) => !x.selected)) {
        console.log(`         ✗ ${c.name} — ${c.dropReason}`);
      }
    }
  }
}

// Der wichtigste Einzelnachweis, extra hervorgehoben.
console.log('\nZweitverwertung: erscheint NUR beim richtigen Spiel');
console.log('─'.repeat(78));

const index = buildParallelIndex(CONFERENCE_SPIELTAG);
for (const spiel of CONFERENCE_SPIELTAG.slice(0, 4)) {
  const sichtbar = selectedOnly(selectChannels(spiel, index)).map((c) => c.name);
  const hatServus = sichtbar.some((n) => /servus/i.test(n));
  const sollServus = spiel.channels.some((c) => /^servustv$/i.test(c.name));
  const ok = hatServus === sollServus;
  if (!ok) fehler++;
  console.log(
    `  ${ok ? '✓' : '✗'} ${spiel.name.padEnd(34)} ServusTV ${hatServus ? 'sichtbar' : 'nicht dabei'}` +
      `  (erwartet: ${sollServus ? 'sichtbar' : 'nicht dabei'})`
  );
}

console.log(
  `\n${fehler === 0 ? 'Alle Fälle wie erwartet.' : `${fehler} Fall/Fälle abweichend.`}`
);
process.exit(fehler === 0 ? 0 : 1);
