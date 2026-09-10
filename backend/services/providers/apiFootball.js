/**
 * Provider: api-football.com (v3)
 *
 * Gratis-Tarif: 100 Anfragen/Tag - reicht fuer 9 Wettbewerbe x 1 Abgleich taeglich.
 * Deckt als einziger auch Europa League, Conference League und
 * die oesterreichische Bundesliga ab.
 */
import { getCompetition } from '../../config/competitions.js';

const STATUS_MAP = {
  TBD: 'SCHEDULED',
  NS: 'SCHEDULED',
  '1H': 'LIVE',
  HT: 'LIVE',
  '2H': 'LIVE',
  ET: 'LIVE',
  BT: 'LIVE',
  P: 'LIVE',
  LIVE: 'LIVE',
  INT: 'LIVE',
  FT: 'FINISHED',
  AET: 'FINISHED',
  PEN: 'FINISHED',
  AWD: 'FINISHED',
  WO: 'FINISHED',
  SUSP: 'POSTPONED',
  PST: 'POSTPONED',
  CANC: 'CANCELLED',
  ABD: 'CANCELLED',
};

export const name = 'api-football';

export function isSupported(code) {
  return Boolean(getCompetition(code)?.apiFootball);
}

export function requiresKey() {
  return true;
}

/** Europaeische Saisons laufen ueber den Jahreswechsel: ab Juli zaehlt das laufende Jahr. */
function seasonFor(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const year = d.getUTCFullYear();
  return d.getUTCMonth() + 1 >= 7 ? year : year - 1;
}

export async function fetchMatches(code, dateFrom, dateTo) {
  const comp = getCompetition(code);
  const leagueId = comp?.apiFootball;

  if (!leagueId) {
    const err = new Error(`Fuer "${code}" ist keine api-football League-ID hinterlegt.`);
    err.code = 'UNSUPPORTED_COMPETITION';
    throw err;
  }

  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) throw new Error('API_FOOTBALL_KEY fehlt in der .env');

  const host = process.env.API_FOOTBALL_HOST || 'v3.football.api-sports.io';
  const season = seasonFor(dateFrom);
  const url =
    `https://${host}/fixtures?league=${leagueId}&season=${season}` +
    `&from=${dateFrom}&to=${dateTo}&timezone=UTC`;

  // api-sports.io und RapidAPI erwarten unterschiedliche Header-Namen.
  const headers = host.includes('rapidapi')
    ? { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': host }
    : { 'x-apisports-key': apiKey };

  const res = await fetch(url, { headers });

  if (res.status === 429) {
    const err = new Error('Tageslimit von api-football erreicht.');
    err.code = 'RATE_LIMIT';
    throw err;
  }
  if (!res.ok) {
    throw new Error(`api-football antwortete mit ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();

  // api-football liefert Fehler mit HTTP 200 im Feld "errors".
  const errors = data.errors;
  const hasErrors = Array.isArray(errors) ? errors.length > 0 : Object.keys(errors ?? {}).length > 0;
  if (hasErrors) {
    throw new Error(`api-football meldet: ${JSON.stringify(errors)}`);
  }

  return (data.response ?? []).map((f) => ({
    providerMatchId: String(f.fixture.id),
    competitionCode: code,
    utcDate: f.fixture.date,
    matchday: parseRound(f.league?.round),
    stage: f.league?.round ?? null,
    status: STATUS_MAP[f.fixture?.status?.short] ?? 'SCHEDULED',
    homeTeam: f.teams?.home?.name ?? 'TBD',
    awayTeam: f.teams?.away?.name ?? 'TBD',
    homeCrest: f.teams?.home?.logo ?? null,
    awayCrest: f.teams?.away?.logo ?? null,
    scoreHome: f.goals?.home ?? null,
    scoreAway: f.goals?.away ?? null,
    venue: f.fixture?.venue?.name ?? null,
  }));
}

/** "Regular Season - 12" -> 12 */
function parseRound(round) {
  const m = /(\d+)\s*$/.exec(round ?? '');
  return m ? Number(m[1]) : null;
}
