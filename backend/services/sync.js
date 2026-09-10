import { db } from '../db/index.js';
import { getProvider } from './providers/index.js';
import { COMPETITION_CODES } from '../config/competitions.js';

const upsertMatch = db.prepare(`
  INSERT INTO matches (
    provider, provider_match_id, competition_code, utc_date, matchday, stage,
    status, home_team, away_team, home_crest, away_crest,
    score_home, score_away, venue
  ) VALUES (
    @provider, @providerMatchId, @competitionCode, @utcDate, @matchday, @stage,
    @status, @homeTeam, @awayTeam, @homeCrest, @awayCrest,
    @scoreHome, @scoreAway, @venue
  )
  ON CONFLICT (provider, provider_match_id) DO UPDATE SET
    utc_date   = excluded.utc_date,
    matchday   = excluded.matchday,
    stage      = excluded.stage,
    status     = excluded.status,
    home_team  = excluded.home_team,
    away_team  = excluded.away_team,
    home_crest = excluded.home_crest,
    away_crest = excluded.away_crest,
    score_home = excluded.score_home,
    score_away = excluded.score_away,
    venue      = excluded.venue,
    updated_at = datetime('now')
`);

const countMatch = db.prepare(
  `SELECT 1 FROM matches WHERE provider = ? AND provider_match_id = ?`
);

const startLog = db.prepare(
  `INSERT INTO sync_log (provider, competition_code) VALUES (?, ?)`
);
const finishLog = db.prepare(`
  UPDATE sync_log
     SET finished_at = datetime('now'), inserted = ?, updated = ?, status = ?, message = ?
   WHERE id = ?
`);

/** YYYY-MM-DD, n Tage relativ zu heute */
export function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Holt die Spiele aller (oder ausgewaehlter) Wettbewerbe und schreibt sie in die DB.
 *
 * @param {object}   opts
 * @param {string[]} opts.competitions  Codes, default: alle
 * @param {number}   opts.daysBack
 * @param {number}   opts.daysAhead
 * @param {string}   opts.providerName
 * @param {function} opts.onProgress    (code, ergebnis) => void
 */
export async function syncMatches({
  competitions = COMPETITION_CODES,
  daysBack = Number(process.env.SYNC_DAYS_BACK ?? 2),
  daysAhead = Number(process.env.SYNC_DAYS_AHEAD ?? 14),
  providerName = process.env.DATA_PROVIDER,
  onProgress = () => {},
} = {}) {
  const provider = getProvider(providerName);
  const dateFrom = isoDate(-Math.abs(daysBack));
  const dateTo = isoDate(Math.abs(daysAhead));

  const results = [];

  for (const [i, code] of competitions.entries()) {
    const logId = startLog.run(provider.name, code).lastInsertRowid;

    if (!provider.isSupported(code)) {
      const message = `Von "${provider.name}" nicht unterstuetzt - uebersprungen.`;
      finishLog.run(0, 0, 'skipped', message, logId);
      const r = { competition: code, status: 'skipped', inserted: 0, updated: 0, message };
      results.push(r);
      onProgress(code, r);
      continue;
    }

    try {
      const matches = await provider.fetchMatches(code, dateFrom, dateTo);
      let inserted = 0;
      let updated = 0;

      db.transaction(() => {
        for (const m of matches) {
          const exists = countMatch.get(provider.name, m.providerMatchId);
          upsertMatch.run({ ...m, provider: provider.name });
          if (exists) updated++;
          else inserted++;
        }
      })();

      finishLog.run(inserted, updated, 'ok', null, logId);
      const r = { competition: code, status: 'ok', inserted, updated, message: null };
      results.push(r);
      onProgress(code, r);
    } catch (err) {
      finishLog.run(0, 0, 'error', err.message, logId);
      const r = { competition: code, status: 'error', inserted: 0, updated: 0, message: err.message };
      results.push(r);
      onProgress(code, r);
    }

    // football-data.org erlaubt nur 10 Anfragen/Minute.
    const isLast = i === competitions.length - 1;
    if (!isLast && provider.name === 'football-data') await sleep(6500);
  }

  return { provider: provider.name, dateFrom, dateTo, results };
}

export function lastSyncInfo() {
  return db
    .prepare(
      `SELECT provider, competition_code, started_at, finished_at, inserted, updated, status, message
         FROM sync_log
        ORDER BY id DESC
        LIMIT 20`
    )
    .all();
}
