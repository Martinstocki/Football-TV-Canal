#!/usr/bin/env node
/**
 * Fuellt die DB mit erfundenen Beispielspielen, damit man das Frontend
 * ohne API-Key ansehen kann. Diese Spiele haben provider = "demo" und
 * werden von einem echten Abgleich nicht ueberschrieben.
 *
 *   npm run seed
 *   node scripts/seed-demo.js --clear   (entfernt nur die Demo-Spiele)
 */
import 'dotenv/config';
import { db, initSchema } from '../backend/db/index.js';

initSchema();

if (process.argv.includes('--clear')) {
  const n = db.prepare(`DELETE FROM matches WHERE provider = 'demo'`).run().changes;
  console.log(`${n} Demo-Spiele entfernt.`);
  process.exit(0);
}

const PAIRINGS = {
  CL: [['Bayern München', 'Real Madrid'], ['Man City', 'Inter'], ['PSG', 'Arsenal'], ['Salzburg', 'Liverpool']],
  EL: [['Roma', 'Rangers'], ['Frankfurt', 'Ajax'], ['Rapid Wien', 'Betis']],
  UECL: [['Fiorentina', 'LASK'], ['Gent', 'Djurgården']],
  BL1: [['Dortmund', 'Leipzig'], ['Leverkusen', 'Stuttgart'], ['Bayern München', 'Union Berlin']],
  AT1: [['Rapid Wien', 'Sturm Graz'], ['Salzburg', 'Austria Wien'], ['LASK', 'Wolfsberger AC']],
  PL: [['Arsenal', 'Liverpool'], ['Man United', 'Chelsea'], ['Tottenham', 'Newcastle']],
  PD: [['Real Madrid', 'Barcelona'], ['Atlético', 'Sevilla'], ['Villarreal', 'Real Sociedad']],
  SA: [['Inter', 'Juventus'], ['Milan', 'Napoli'], ['Roma', 'Atalanta']],
  FL1: [['PSG', 'Marseille'], ['Monaco', 'Lyon'], ['Lille', 'Nice']],
};

const KICKOFFS = ['15:30', '18:00', '18:45', '20:00', '21:00'];

const insert = db.prepare(`
  INSERT INTO matches (
    provider, provider_match_id, competition_code, utc_date, matchday, stage,
    status, home_team, away_team, score_home, score_away
  ) VALUES (
    'demo', @providerMatchId, @competitionCode, @utcDate, @matchday, @stage,
    @status, @homeTeam, @awayTeam, @scoreHome, @scoreAway
  )
  ON CONFLICT (provider, provider_match_id) DO UPDATE SET
    utc_date = excluded.utc_date, status = excluded.status,
    score_home = excluded.score_home, score_away = excluded.score_away,
    updated_at = datetime('now')
`);

let id = 0;
let created = 0;

db.transaction(() => {
  // -2 bis +13 Tage rund um heute
  for (let offset = -2; offset <= 13; offset++) {
    const day = new Date();
    day.setDate(day.getDate() + offset);
    const dayStr = day.toISOString().slice(0, 10);

    for (const [code, pairs] of Object.entries(PAIRINGS)) {
      // nicht jeder Wettbewerb spielt jeden Tag
      if ((offset + code.length) % 3 !== 0) continue;

      const [home, away] = pairs[Math.abs(offset + code.length) % pairs.length];
      const time = KICKOFFS[Math.abs(offset) % KICKOFFS.length];
      const past = offset < 0;

      insert.run({
        providerMatchId: `demo-${++id}`,
        competitionCode: code,
        utcDate: `${dayStr}T${time}:00.000Z`,
        matchday: 5 + offset,
        stage: 'REGULAR_SEASON',
        status: past ? 'FINISHED' : 'SCHEDULED',
        homeTeam: home,
        awayTeam: away,
        scoreHome: past ? id % 4 : null,
        scoreAway: past ? (id + 1) % 3 : null,
      });
      created++;
    }
  }
})();

console.log(`${created} Demo-Spiele angelegt.`);
console.log('Entfernen mit: node scripts/seed-demo.js --clear');
