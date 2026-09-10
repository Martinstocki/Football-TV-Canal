import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'broadcasters.json');

/**
 * Reihenfolge, in der ein Sender bestimmt wird:
 *
 *   1. manueller Override        - von Hand gesetzt, schlaegt alles
 *   2. Scraper-Treffer (fotmob)  - exakter Kanal inkl. Nummer
 *   3. Regeltabelle              - NUR wenn BROADCAST_FALLBACK=rule
 *   4. Platzhalter               - "Sender wird noch bekannt gegeben"
 *
 * Standard ist Stufe 4 statt Stufe 3: eine grobe Angabe wie "Sky Sport Austria"
 * ohne Kanalnummer ist bei Wettbewerben mit Parallelspielen wertlos und bei
 * Sendern mit Zweitverwertungsrecht schlicht falsch.
 */
export const PLACEHOLDER = Object.freeze({
  name: 'Sender wird noch bekannt gegeben',
  type: 'unknown',
  source: 'placeholder',
});

let cache = null;
let cacheMtime = 0;

/** Laedt broadcasters.json und liest sie neu ein, sobald die Datei geaendert wurde. */
function loadConfig() {
  const mtime = fs.statSync(CONFIG_PATH).mtimeMs;
  if (!cache || mtime !== cacheMtime) {
    cache = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    cacheMtime = mtime;
  }
  return cache;
}

export function availableCountries() {
  return loadConfig().countries ?? { AT: 'Österreich', DE: 'Deutschland' };
}

function fallbackMode() {
  return (process.env.BROADCAST_FALLBACK || 'placeholder').toLowerCase();
}

/** Grobe Sender laut Regelwerk - nur als ausdruecklich markierter Notnagel. */
export function channelsByRule(competitionCode, country) {
  const { rules = [] } = loadConfig();
  const rule = rules.find((r) => r.competition === competitionCode && r.country === country);

  return (rule?.channels ?? []).map((c) => ({ ...c, source: 'rule', approximate: true }));
}

const overridesForMatches = db.prepare(`
  SELECT match_id, channel, type, note, source
    FROM broadcast_overrides
   WHERE country = ?
     AND match_id IN (SELECT value FROM json_each(?))
   ORDER BY source = 'manual' DESC, id
`);

/**
 * Reichert Spiele um ihre Sender an.
 * Manuelle Eintraege ersetzen die des Scrapers, beide ersetzen die Regeln.
 */
export function attachBroadcasts(matches, country) {
  if (matches.length === 0) return matches;

  const ids = JSON.stringify(matches.map((m) => m.id));
  const byMatch = new Map();

  for (const row of overridesForMatches.all(country, ids)) {
    if (!byMatch.has(row.match_id)) byMatch.set(row.match_id, { manual: [], fotmob: [] });
    const bucket = byMatch.get(row.match_id);
    const entry = { name: row.channel, type: row.type, note: row.note, source: row.source };
    (row.source === 'manual' ? bucket.manual : bucket.fotmob).push(entry);
  }

  return matches.map((m) => {
    const bucket = byMatch.get(m.id);

    if (bucket?.manual.length) return { ...m, broadcasts: bucket.manual };
    if (bucket?.fotmob.length) return { ...m, broadcasts: sortChannels(bucket.fotmob) };

    if (fallbackMode() === 'rule') {
      const rules = channelsByRule(m.competitionCode, country);
      if (rules.length > 0) return { ...m, broadcasts: rules };
    }

    return { ...m, broadcasts: [PLACEHOLDER] };
  });
}

/** Fernsehkanaele zuerst, Streaming-Apps danach - sonst Reihenfolge der Quelle. */
function sortChannels(list) {
  return [...list].sort((a, b) => (a.type === 'tv' ? 0 : 1) - (b.type === 'tv' ? 0 : 1));
}

export function setOverride({ matchId, country, channel, type = 'tv', note = null, source = 'manual' }) {
  return db
    .prepare(
      `INSERT INTO broadcast_overrides (match_id, country, channel, type, note, source)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (match_id, country, channel)
       DO UPDATE SET type = excluded.type, note = excluded.note, source = excluded.source`
    )
    .run(matchId, country, channel, type, note, source);
}

/** Ohne "source" werden alle Eintraege des Spiels geloescht, sonst nur die dieser Herkunft. */
export function clearOverrides(matchId, country, source = null) {
  return source
    ? db
        .prepare(`DELETE FROM broadcast_overrides WHERE match_id = ? AND country = ? AND source = ?`)
        .run(matchId, country, source)
    : db
        .prepare(`DELETE FROM broadcast_overrides WHERE match_id = ? AND country = ?`)
        .run(matchId, country);
}
