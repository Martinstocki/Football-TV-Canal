#!/usr/bin/env node
/**
 * Holt die Spiele der naechsten 7 Tage von football-data.org und schreibt
 * sie in die Tabelle "fixtures".
 *
 *   node scripts/fetch-fixtures.js
 *   node scripts/fetch-fixtures.js --days 14
 *   node scripts/fetch-fixtures.js --competitions CL,PL
 *   node scripts/fetch-fixtures.js --show          (nur anzeigen, nichts abrufen)
 *
 * Der API-Key kommt aus FOOTBALL_DATA_API_KEY in der .env.
 */
import 'dotenv/config';
import { db, initSchema } from '../backend/db/index.js';

// --- Wettbewerbe im Free-Tier von football-data.org ------------------------
// Oesterreichische Bundesliga, Europa League und Conference League fehlen
// hier bewusst - die deckt dieser Anbieter im Gratis-Tarif nicht ab.
const COMPETITIONS = {
  CL: 'Champions League',
  PL: 'Premier League',
  PD: 'La Liga',
  FL1: 'Ligue 1',
  SA: 'Serie A',
  BL1: 'Bundesliga',
};

const BASE_URL = 'https://api.football-data.org/v4';

// Der Gratis-Tarif erlaubt 10 Anfragen/Minute -> Pause zwischen den Abrufen.
const REQUEST_DELAY_MS = 6500;

// --- Argumente -------------------------------------------------------------

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const days = Number(arg('days', 7));
const showOnly = process.argv.includes('--show');

const selected = arg('competitions')
  ? arg('competitions')
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter((c) => c in COMPETITIONS)
  : Object.keys(COMPETITIONS);

if (!Number.isFinite(days) || days < 1) {
  console.error('--days braucht eine Zahl groesser 0.');
  process.exit(1);
}
if (selected.length === 0) {
  console.error(`Keine gueltigen Wettbewerbe. Erlaubt: ${Object.keys(COMPETITIONS).join(', ')}`);
  process.exit(1);
}

// --- Hilfsfunktionen -------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** YYYY-MM-DD, n Tage ab heute (UTC) */
function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function localTime(utc) {
  return new Date(utc).toLocaleString('de-AT', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: process.env.TZ || 'Europe/Vienna',
  });
}

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);

// --- Datenbank -------------------------------------------------------------

initSchema();

// Damit das Skript auch fuer sich allein lauffaehig ist.
db.exec(`
  CREATE TABLE IF NOT EXISTS fixtures (
    id          INTEGER PRIMARY KEY,
    competition TEXT NOT NULL,
    home_team   TEXT NOT NULL,
    away_team   TEXT NOT NULL,
    kickoff_utc TEXT NOT NULL,
    status      TEXT NOT NULL,
    fetched_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Der Upsert haengt an der Match-ID des Anbieters: ein zweiter Durchlauf
// aktualisiert dieselbe Zeile, statt eine neue anzulegen.
const upsert = db.prepare(`
  INSERT INTO fixtures (id, competition, home_team, away_team, kickoff_utc, status)
  VALUES (@id, @competition, @homeTeam, @awayTeam, @kickoffUtc, @status)
  ON CONFLICT (id) DO UPDATE SET
    competition = excluded.competition,
    home_team   = excluded.home_team,
    away_team   = excluded.away_team,
    kickoff_utc = excluded.kickoff_utc,
    status      = excluded.status,
    fetched_at  = datetime('now')
`);

const exists = db.prepare(`SELECT 1 FROM fixtures WHERE id = ?`);

const saveAll = db.transaction((rows) => {
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    if (exists.get(row.id)) updated++;
    else inserted++;
    upsert.run(row);
  }
  return { inserted, updated };
});

// --- Abruf -----------------------------------------------------------------

async function fetchCompetition(code, dateFrom, dateTo, apiKey) {
  const url = `${BASE_URL}/competitions/${code}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`;
  const res = await fetch(url, { headers: { 'X-Auth-Token': apiKey } });

  if (res.status === 429) throw new Error('Rate-Limit erreicht (10 Anfragen/Minute).');
  if (res.status === 403) throw new Error('Im Free-Tier nicht freigeschaltet.');
  if (res.status === 401) throw new Error('API-Key wurde abgelehnt.');
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);

  const data = await res.json();

  return (data.matches ?? []).map((m) => ({
    id: m.id,
    competition: code,
    homeTeam: m.homeTeam?.shortName || m.homeTeam?.name || 'offen',
    awayTeam: m.awayTeam?.shortName || m.awayTeam?.name || 'offen',
    kickoffUtc: m.utcDate,
    status: m.status,
  }));
}

// --- Ausgabe ---------------------------------------------------------------

function printTable() {
  const rows = db
    .prepare(
      `SELECT id, competition, home_team, away_team, kickoff_utc, status
         FROM fixtures
        ORDER BY kickoff_utc, competition`
    )
    .all();

  if (rows.length === 0) {
    console.log('\nKeine Spiele in der Tabelle "fixtures".');
    return rows;
  }

  console.log(`\n${'─'.repeat(78)}`);
  console.log(
    `${pad('ANSTOSS (lokal)', 18)} ${pad('LIGA', 5)} ${pad('BEGEGNUNG', 40)} STATUS`
  );
  console.log('─'.repeat(78));

  let lastDay = null;
  for (const r of rows) {
    const day = r.kickoff_utc.slice(0, 10);
    if (lastDay && day !== lastDay) console.log('');
    lastDay = day;

    const paarung = `${r.home_team} – ${r.away_team}`;
    console.log(
      `${pad(localTime(r.kickoff_utc), 18)} ${pad(r.competition, 5)} ${pad(paarung, 40)} ${r.status}`
    );
  }
  console.log('─'.repeat(78));
  console.log(`${rows.length} Spiele in der Tabelle "fixtures".`);

  return rows;
}

// --- Ablauf ----------------------------------------------------------------

if (showOnly) {
  printTable();
  process.exit(0);
}

const apiKey = process.env.FOOTBALL_DATA_API_KEY;
if (!apiKey) {
  console.error('FOOTBALL_DATA_API_KEY fehlt in der .env.');
  console.error('Key holen: https://www.football-data.org/client/register');
  process.exit(1);
}

const dateFrom = isoDate(0);
const dateTo = isoDate(days - 1);

console.log(`Zeitraum: ${dateFrom} bis ${dateTo} (${days} Tage)`);
console.log(`Wettbewerbe: ${selected.join(', ')}\n`);

let totalInserted = 0;
let totalUpdated = 0;
const failed = [];

for (const [i, code] of selected.entries()) {
  process.stdout.write(`  ${pad(code, 4)} ${pad(COMPETITIONS[code], 20)} `);

  try {
    const rows = await fetchCompetition(code, dateFrom, dateTo, apiKey);
    const { inserted, updated } = saveAll(rows);
    totalInserted += inserted;
    totalUpdated += updated;

    console.log(
      rows.length === 0
        ? 'keine Spiele im Zeitraum'
        : `${rows.length} Spiele (${inserted} neu, ${updated} aktualisiert)`
    );
  } catch (err) {
    console.log(`FEHLER – ${err.message}`);
    failed.push({ code, message: err.message });
  }

  if (i < selected.length - 1) await sleep(REQUEST_DELAY_MS);
}

console.log(`\nGesamt: ${totalInserted} neu, ${totalUpdated} aktualisiert.`);

if (failed.length > 0) {
  console.log(`\nNicht abgerufen: ${failed.map((f) => f.code).join(', ')}`);
}

printTable();

process.exit(failed.length > 0 ? 1 : 0);
