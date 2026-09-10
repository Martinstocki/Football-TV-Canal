#!/usr/bin/env node
/**
 * Legt einen erfundenen Conference-League-Spieltag an, damit man die
 * Darstellung ansehen kann, bevor die Ligaphase am 15.10.2026 beginnt.
 *
 *   npm run seed:uecl                        anlegen (15.10.2026)
 *   npm run seed:uecl -- --date 2026-09-17   auf ein anderes Datum legen
 *   npm run seed:uecl -- --clear             wieder entfernen
 *
 * Hinweis: Die App zeigt hoechstens 14 Tage im Voraus. Der echte erste
 * Spieltag am 15.10. taucht also erst ab Anfang Oktober auf. Zum Ansehen
 * der Darstellung deshalb --date auf einen Donnerstag in den naechsten
 * zwei Wochen legen.
 *
 * Die Sender laufen durch DIESELBE Filterlogik wie echte Scraper-Daten
 * (backend/services/channelSelection.js) - die Demo zeigt also wirklich,
 * was am Spieltag herauskaeme, und nicht ein geschoentes Wunschergebnis.
 *
 * Alle Zeilen tragen provider = 'demo-uecl' und lassen sich rueckstandslos
 * entfernen. Ein echter Scraper-Lauf fasst sie nicht an.
 */
import 'dotenv/config';
import { db, initSchema } from '../backend/db/index.js';
import {
  buildParallelIndex,
  selectChannels,
  selectedOnly,
} from '../backend/services/channelSelection.js';

initSchema();

const PROVIDER = 'demo-uecl';

if (process.argv.includes('--clear')) {
  const ids = db
    .prepare(`SELECT id FROM matches WHERE provider = ?`)
    .all(PROVIDER)
    .map((r) => r.id);

  db.transaction(() => {
    for (const id of ids) {
      db.prepare(`DELETE FROM broadcast_overrides WHERE match_id = ?`).run(id);
    }
    db.prepare(`DELETE FROM matches WHERE provider = ?`).run(PROVIDER);
    db.prepare(`DELETE FROM fixtures WHERE source = ?`).run(PROVIDER);
  })();

  console.log(`${ids.length} Demo-Spiele der Conference League entfernt.`);
  process.exit(0);
}

/** Datum des Spieltags, per --date verschiebbar. */
function spieltagDatum() {
  const i = process.argv.indexOf('--date');
  const roh = i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : '2026-10-15';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(roh)) {
    console.error(`--date braucht das Format YYYY-MM-DD, bekommen: "${roh}"`);
    process.exit(1);
  }
  return roh;
}

const DATUM = spieltagDatum();

const SPAET = `${DATUM}T19:00:00.000Z`; // 21:00 Ortszeit Wien
const FRUEH = `${DATUM}T16:45:00.000Z`; // 18:45 Ortszeit Wien

/**
 * Die Senderlisten sind so aufgebaut, wie FotMob sie liefern wuerde -
 * inklusive der Abspielwege, die herausgefiltert gehoeren.
 */
const SPIELTAG = [
  {
    home: 'Rapid Wien',
    away: 'Fiorentina',
    kickoff: SPAET,
    // Das von ServusTV ausgewaehlte Spiel - frei empfangbar.
    channels: ['ServusTV', 'ServusTV On', 'Joyn', 'Sky Sport Austria 3', 'Sky X', 'Sky Go'],
  },
  {
    home: 'Gent',
    away: 'Djurgården',
    kickoff: SPAET,
    channels: ['Sky Sport Austria 4', 'Sky Sport Austria 1', 'Sky X', 'Sky Go'],
  },
  {
    home: 'Legia Warschau',
    away: 'Crystal Palace',
    kickoff: SPAET,
    channels: ['Sky Sport Austria 5', 'Sky Sport Austria 1', 'Sky X', 'Sky Go'],
  },
  {
    home: 'Jagiellonia',
    away: 'Rayo Vallecano',
    kickoff: SPAET,
    // Nur die Konferenz - hier muss sie stehen bleiben.
    channels: ['Sky Sport Austria 1', 'Sky X', 'Sky Go'],
  },
  {
    home: 'Shakhtar Donetsk',
    away: 'Breidablik',
    kickoff: FRUEH,
    channels: ['Sky Sport Austria 2', 'Sky X'],
  },
  {
    home: 'Omonia Nicosia',
    away: 'Slovan Bratislava',
    kickoff: FRUEH,
    // Sender noch offen - muss den Platzhalter zeigen.
    channels: [],
  },
];

// --- Filterlogik anwenden, genau wie beim echten Lauf ----------------------

const alsGuide = SPIELTAG.map((s) => ({
  kickoffUtc: s.kickoff,
  channels: s.channels.map((name, position) => ({
    name,
    position,
    type: /sky x|sky go|joyn|dazn|on$/i.test(name) ? 'stream' : 'tv',
  })),
}));

const index = buildParallelIndex(alsGuide);

const insertMatch = db.prepare(`
  INSERT INTO matches (provider, provider_match_id, competition_code, utc_date,
                       status, home_team, away_team, matchday, stage)
  VALUES (?, ?, 'UECL', ?, 'SCHEDULED', ?, ?, 1, 'LEAGUE_STAGE')
  ON CONFLICT (provider, provider_match_id) DO UPDATE SET
    utc_date = excluded.utc_date, updated_at = datetime('now')
`);

const matchId = db.prepare(
  `SELECT id FROM matches WHERE provider = ? AND provider_match_id = ?`
);

const clearOv = db.prepare(`DELETE FROM broadcast_overrides WHERE match_id = ? AND country = 'AT'`);
const insertOv = db.prepare(`
  INSERT INTO broadcast_overrides (match_id, country, channel, type, note, source)
  VALUES (?, 'AT', ?, ?, NULL, 'demo')
  ON CONFLICT (match_id, country, channel) DO UPDATE SET type = excluded.type
`);

let angelegt = 0;
const bericht = [];

db.transaction(() => {
  for (const [i, s] of SPIELTAG.entries()) {
    const sid = `uecl-demo-${i + 1}`;
    insertMatch.run(PROVIDER, sid, s.kickoff, s.home, s.away);
    const id = matchId.get(PROVIDER, sid).id;

    const bewertet = selectChannels(alsGuide[i], index);
    const sichtbar = selectedOnly(bewertet);

    clearOv.run(id);
    for (const c of sichtbar) insertOv.run(id, c.name, c.type);

    bericht.push({
      spiel: `${s.home} – ${s.away}`,
      roh: s.channels,
      sichtbar: sichtbar.map((c) => c.name),
      weg: bewertet.filter((c) => !c.selected).map((c) => `${c.name} (${c.dropReason})`),
    });
    angelegt++;
  }
})();

// --- Bericht ---------------------------------------------------------------

console.log(`${angelegt} Conference-League-Demospiele angelegt (${DATUM}).\n`);

for (const b of bericht) {
  console.log('─'.repeat(72));
  console.log(b.spiel);
  console.log(`  FotMob liefert:  ${b.roh.join(', ') || '(keine Sender)'}`);
  console.log(`  Angezeigt wird:  ${b.sichtbar.join(', ') || 'Platzhalter'}`);
  for (const w of b.weg) console.log(`      ✗ ${w}`);
}

console.log('─'.repeat(72));
console.log('\nEntfernen mit:  npm run seed:uecl -- --clear');
