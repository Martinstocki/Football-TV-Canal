#!/usr/bin/env node
/**
 * Legt die SQLite-Datenbank an bzw. bringt das Schema auf Stand.
 *
 *   npm run db:init
 *   npm run db:reset   (--force: loescht alle Spiele und Overrides)
 */
import 'dotenv/config';
import { db, initSchema, DB_PATH } from '../backend/db/index.js';

const force = process.argv.includes('--force');

const { dbPath } = initSchema();
console.log(`Schema angewendet: ${dbPath}`);

if (force) {
  db.exec(`
    DELETE FROM broadcast_overrides;
    DELETE FROM matches;
    DELETE FROM sync_log;
    DELETE FROM sqlite_sequence WHERE name IN ('matches','broadcast_overrides','sync_log');
  `);
  console.log('Alle Spiele, Sender-Overrides und Logs geloescht.');
}

const comps = db.prepare(`SELECT COUNT(*) AS n FROM competitions`).get().n;
const matches = db.prepare(`SELECT COUNT(*) AS n FROM matches`).get().n;
console.log(`Wettbewerbe: ${comps}, Spiele: ${matches}`);
console.log(`Datei: ${DB_PATH}`);
