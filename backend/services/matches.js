import { db } from '../db/index.js';
import { attachBroadcasts } from './broadcasts.js';

const SELECT = `
  SELECT m.id, m.competition_code AS competitionCode, m.utc_date AS utcDate,
         m.matchday, m.stage, m.status,
         m.home_team AS homeTeam, m.away_team AS awayTeam,
         m.home_crest AS homeCrest, m.away_crest AS awayCrest,
         m.score_home AS scoreHome, m.score_away AS scoreAway,
         m.venue,
         c.name AS competitionName, c.short_name AS competitionShort, c.color AS competitionColor
    FROM matches m
    JOIN competitions c ON c.code = m.competition_code
`;

/**
 * @param {object} opts
 * @param {string} opts.from        ISO-Datum inklusive (YYYY-MM-DD)
 * @param {string} opts.to          ISO-Datum inklusive (YYYY-MM-DD)
 * @param {string[]} opts.competitions  Filter, leer = alle
 * @param {string} opts.country     AT | DE  (fuer die Sender-Zuordnung)
 * @param {string} opts.team        Teilstring-Suche auf Teamnamen
 */
export function findMatches({ from, to, competitions = [], country = 'AT', team = '' } = {}) {
  const where = [];
  const params = [];

  if (from) {
    where.push('m.utc_date >= ?');
    params.push(`${from}T00:00:00Z`);
  }
  if (to) {
    where.push('m.utc_date <= ?');
    params.push(`${to}T23:59:59Z`);
  }
  if (competitions.length > 0) {
    where.push(`m.competition_code IN (${competitions.map(() => '?').join(', ')})`);
    params.push(...competitions);
  }
  if (team) {
    where.push('(m.home_team LIKE ? OR m.away_team LIKE ?)');
    params.push(`%${team}%`, `%${team}%`);
  }

  const sql =
    SELECT +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY m.utc_date ASC, c.sort_order ASC';

  return attachBroadcasts(db.prepare(sql).all(...params), country);
}

export function findMatchById(id, country = 'AT') {
  const rows = db.prepare(`${SELECT} WHERE m.id = ?`).all(id);
  return attachBroadcasts(rows, country)[0] ?? null;
}

/** Gruppiert Spiele nach lokalem Kalendertag - das Frontend rendert danach. */
export function groupByDay(matches, timeZone = process.env.TZ || 'Europe/Vienna') {
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone, dateStyle: 'short' }); // -> YYYY-MM-DD
  const days = new Map();

  for (const m of matches) {
    const day = fmt.format(new Date(m.utcDate));
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(m);
  }

  return [...days.entries()].map(([date, items]) => ({ date, matches: items }));
}

export function stats() {
  return db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN utc_date >= datetime('now') THEN 1 ELSE 0 END) AS upcoming,
              MIN(utc_date) AS firstMatch,
              MAX(utc_date) AS lastMatch
         FROM matches`
    )
    .get();
}
