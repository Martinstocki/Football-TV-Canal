/**
 * Provider: football-data.org (v4)
 *
 * Gratis-Tarif: 10 Anfragen/Minute, Wettbewerbe CL, BL1, PL, PD, SA, FL1.
 * Nicht enthalten: Europa League, Conference League, Bundesliga Österreich.
 */
import { getCompetition } from '../../config/competitions.js';

const BASE = 'https://api.football-data.org/v4';

const STATUS_MAP = {
  SCHEDULED: 'SCHEDULED',
  TIMED: 'SCHEDULED',
  IN_PLAY: 'LIVE',
  PAUSED: 'LIVE',
  FINISHED: 'FINISHED',
  AWARDED: 'FINISHED',
  POSTPONED: 'POSTPONED',
  SUSPENDED: 'POSTPONED',
  CANCELLED: 'CANCELLED',
  CANCELED: 'CANCELLED',
};

export const name = 'football-data';

export function isSupported(code) {
  return Boolean(getCompetition(code)?.footballData);
}

export function requiresKey() {
  return true;
}

/**
 * @param {string} code    interner Wettbewerbs-Code
 * @param {string} dateFrom  YYYY-MM-DD
 * @param {string} dateTo    YYYY-MM-DD
 * @returns {Promise<Array>} normalisierte Spiele
 */
export async function fetchMatches(code, dateFrom, dateTo) {
  const comp = getCompetition(code);
  const providerCode = comp?.footballData;

  if (!providerCode) {
    const err = new Error(
      `"${code}" ist bei football-data.org im Gratis-Tarif nicht verfuegbar. ` +
        `Setze DATA_PROVIDER=api-football, um diesen Wettbewerb zu laden.`
    );
    err.code = 'UNSUPPORTED_COMPETITION';
    throw err;
  }

  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) throw new Error('FOOTBALL_DATA_API_KEY fehlt in der .env');

  const url = `${BASE}/competitions/${providerCode}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`;
  const res = await fetch(url, { headers: { 'X-Auth-Token': apiKey } });

  if (res.status === 429) {
    const err = new Error('Rate-Limit von football-data.org erreicht (10 Anfragen/Minute).');
    err.code = 'RATE_LIMIT';
    throw err;
  }
  if (!res.ok) {
    throw new Error(`football-data.org antwortete mit ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();

  return (data.matches ?? []).map((m) => ({
    providerMatchId: String(m.id),
    competitionCode: code,
    utcDate: m.utcDate,
    matchday: m.matchday ?? null,
    stage: m.stage ?? null,
    status: STATUS_MAP[m.status] ?? 'SCHEDULED',
    homeTeam: m.homeTeam?.shortName || m.homeTeam?.name || 'TBD',
    awayTeam: m.awayTeam?.shortName || m.awayTeam?.name || 'TBD',
    homeCrest: m.homeTeam?.crest ?? null,
    awayCrest: m.awayTeam?.crest ?? null,
    scoreHome: m.score?.fullTime?.home ?? null,
    scoreAway: m.score?.fullTime?.away ?? null,
    venue: null,
  }));
}
