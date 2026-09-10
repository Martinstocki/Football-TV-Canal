import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { COMPETITIONS } from '../config/competitions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const dbPath = path.resolve(
  PROJECT_ROOT,
  process.env.DATABASE_PATH || 'data/fussball.db'
);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
export const DB_PATH = dbPath;

/** Ergaenzt eine Spalte, falls sie in einer aelteren Datenbank noch fehlt. */
function addColumnIfMissing(table, column, definition) {
  const exists = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === column);

  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Nachtraegliche Aenderungen an Tabellen, die es in aelteren Datenbanken
 * schon gibt. CREATE TABLE IF NOT EXISTS allein wuerde die nicht erreichen.
 */
function migrate() {
  // Der Scraper legt seine Treffer als Override ab. "source" trennt sie von
  // Hand gesetzten Eintraegen, damit ein neuer Lauf nur seine eigenen ersetzt.
  addColumnIfMissing('broadcast_overrides', 'source', `TEXT NOT NULL DEFAULT 'manual'`);

  // Exakte Sender direkt an der fixtures-Zeile, als JSON-Array.
  addColumnIfMissing('fixtures', 'channels', 'TEXT');
  addColumnIfMissing('fixtures', 'channels_source', 'TEXT');
  addColumnIfMissing('fixtures', 'channels_updated_at', 'TEXT');

  // Woher die Zeile stammt. Wettbewerbe, die football-data.org im Free-Tier
  // nicht hat (oesterreichische Bundesliga), kommen aus dem TV-Programm.
  addColumnIfMissing('fixtures', 'source', `TEXT NOT NULL DEFAULT 'football-data'`);
  addColumnIfMissing('fixtures', 'source_match_id', 'TEXT');

  // tv_channels spiegelt die Quelle vollstaendig. Ob ein Eintrag angezeigt
  // wird und warum nicht, steht daneben - so bleibt nachvollziehbar, was
  // die Filterregeln aussortiert haben.
  addColumnIfMissing('tv_channels', 'is_selected', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('tv_channels', 'drop_reason', 'TEXT');
  addColumnIfMissing('tv_channels', 'parallel_count', 'INTEGER');
}

/** Legt Tabellen an (idempotent) und haelt die Wettbewerbsliste aktuell. */
export function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrate();

  const upsert = db.prepare(`
    INSERT INTO competitions (code, name, short_name, country, color, sort_order, active)
    VALUES (@code, @name, @shortName, @country, @color, @sortOrder, 1)
    ON CONFLICT (code) DO UPDATE SET
      name       = excluded.name,
      short_name = excluded.short_name,
      country    = excluded.country,
      color      = excluded.color,
      sort_order = excluded.sort_order
  `);

  db.transaction(() => {
    for (const c of COMPETITIONS) upsert.run(c);
  })();

  return { dbPath };
}
