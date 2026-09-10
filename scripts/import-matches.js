#!/usr/bin/env node
/**
 * Holt die Spielplaene vom eingestellten Provider und schreibt sie in die DB.
 *
 *   npm run sync
 *   node scripts/import-matches.js --days 21
 *   node scripts/import-matches.js --competitions CL,PL,AT1
 *   node scripts/import-matches.js --provider api-football --days 30
 */
import 'dotenv/config';
import { initSchema } from '../backend/db/index.js';
import { syncMatches } from '../backend/services/sync.js';
import { COMPETITION_CODES } from '../backend/config/competitions.js';

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

initSchema();

const competitions = arg('competitions')
  ?.split(',')
  .map((s) => s.trim().toUpperCase())
  .filter((s) => COMPETITION_CODES.includes(s));

const options = {
  competitions: competitions?.length ? competitions : undefined,
  daysAhead: arg('days') ? Number(arg('days')) : undefined,
  daysBack: arg('days-back') ? Number(arg('days-back')) : undefined,
  providerName: arg('provider'),
  onProgress(code, r) {
    const detail = r.status === 'ok' ? `neu ${r.inserted}, aktualisiert ${r.updated}` : r.message;
    console.log(`  ${code.padEnd(5)} ${r.status.padEnd(8)} ${detail ?? ''}`);
  },
};

console.log('Abgleich laeuft ...');

const result = await syncMatches(options);

const ok = result.results.filter((r) => r.status === 'ok');
const skipped = result.results.filter((r) => r.status === 'skipped');
const failed = result.results.filter((r) => r.status === 'error');

console.log(`\nProvider: ${result.provider}   Zeitraum: ${result.dateFrom} bis ${result.dateTo}`);
console.log(
  `Fertig: ${ok.length} ok, ${skipped.length} uebersprungen, ${failed.length} fehlgeschlagen ` +
    `(${ok.reduce((s, r) => s + r.inserted, 0)} neue Spiele)`
);

if (skipped.length) {
  console.log(
    `\nHinweis: ${skipped.map((r) => r.competition).join(', ')} liefert dieser Provider nicht. ` +
      `Mit DATA_PROVIDER=api-football in der .env sind alle Wettbewerbe abgedeckt.`
  );
}

process.exit(failed.length ? 1 : 0);
