-- Schema des Fussball-TV-Programms. Wird bei jedem Start idempotent angewendet.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS competitions (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  short_name  TEXT NOT NULL,
  country     TEXT,
  color       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS matches (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  provider          TEXT NOT NULL,
  provider_match_id TEXT NOT NULL,
  competition_code  TEXT NOT NULL REFERENCES competitions(code),
  utc_date          TEXT NOT NULL,           -- ISO 8601, immer UTC
  matchday          INTEGER,
  stage             TEXT,
  status            TEXT NOT NULL DEFAULT 'SCHEDULED',
                    -- SCHEDULED | LIVE | FINISHED | POSTPONED | CANCELLED
  home_team         TEXT NOT NULL,
  away_team         TEXT NOT NULL,
  home_crest        TEXT,
  away_crest        TEXT,
  score_home        INTEGER,
  score_away        INTEGER,
  venue             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_match_id)
);

CREATE INDEX IF NOT EXISTS idx_matches_date        ON matches (utc_date);
CREATE INDEX IF NOT EXISTS idx_matches_competition ON matches (competition_code, utc_date);

-- Manuelle Sender-Korrekturen fuer einzelne Spiele.
-- Schlagen immer die Regeln aus config/broadcasters.json.
CREATE TABLE IF NOT EXISTS broadcast_overrides (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id   INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  country    TEXT NOT NULL,                 -- AT | DE
  channel    TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'tv',    -- tv | stream
  note       TEXT,
  source     TEXT NOT NULL DEFAULT 'manual',-- manual | fotmob
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (match_id, country, channel)
);

CREATE INDEX IF NOT EXISTS idx_overrides_match ON broadcast_overrides (match_id, country);

-- Schlanke Spiegelung der football-data.org-Spielplaene.
-- Wird von scripts/fetch-fixtures.js befuellt. "id" ist die Match-ID
-- des Anbieters - dadurch aktualisiert ein erneuter Abruf die Zeile,
-- statt eine zweite anzulegen.
CREATE TABLE IF NOT EXISTS fixtures (
  id          INTEGER PRIMARY KEY,      -- Match-ID von football-data.org
  competition TEXT NOT NULL,            -- CL | PL | PD | FL1 | SA | BL1
  home_team   TEXT NOT NULL,
  away_team   TEXT NOT NULL,
  kickoff_utc TEXT NOT NULL,            -- ISO 8601, UTC
  status      TEXT NOT NULL,            -- Rohstatus des Anbieters
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),

  -- Exakte Sender aus dem Scraper, JSON-Array [{name, type}].
  -- NULL heisst: noch kein Treffer, Anzeige faellt auf den Platzhalter zurueck.
  channels            TEXT,
  channels_source     TEXT,             -- z. B. "fotmob"
  channels_updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_fixtures_kickoff     ON fixtures (kickoff_utc);
CREATE INDEX IF NOT EXISTS idx_fixtures_competition ON fixtures (competition, kickoff_utc);

-- Rohergebnis des TV-Scrapers: eine Zeile je Spiel UND Sender.
-- Bewusst nah an der Quelle gehalten - was FotMob liefert, steht hier
-- unveraendert drin, auch wenn wir das Spiel (noch) nicht zuordnen konnten.
CREATE TABLE IF NOT EXISTS tv_channels (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Zuordnung zu unseren Daten. NULL = kein Treffer beim Team-Matching.
  fixture_id      INTEGER REFERENCES fixtures(id) ON DELETE SET NULL,
  match_id        INTEGER REFERENCES matches(id)  ON DELETE SET NULL,

  -- Identitaet auf Seite der Quelle
  source          TEXT    NOT NULL DEFAULT 'fotmob',
  source_match_id INTEGER NOT NULL,
  country         TEXT    NOT NULL,            -- AT | DE

  -- Spielinformationen, wie die Quelle sie schreibt
  league_id       INTEGER,
  league_name     TEXT,
  league_ccode    TEXT,
  competition     TEXT,                        -- unser Code, z. B. CL - NULL wenn unbekannt
  home_team       TEXT    NOT NULL,
  away_team       TEXT    NOT NULL,
  home_team_id    INTEGER,
  away_team_id    INTEGER,
  kickoff_utc     TEXT    NOT NULL,

  -- Der Sender
  sender_name     TEXT    NOT NULL,
  sender_type     TEXT    NOT NULL DEFAULT 'tv',  -- tv | stream
  position        INTEGER NOT NULL DEFAULT 0,     -- Reihenfolge wie auf der Seite

  -- Ergebnis der Filterregeln (config/channelRules.js).
  -- Die Zeile bleibt auch dann erhalten, wenn sie nicht angezeigt wird -
  -- drop_reason sagt, welche Regel gegriffen hat.
  is_selected     INTEGER NOT NULL DEFAULT 1,
  drop_reason     TEXT,
  parallel_count  INTEGER,                        -- zeitgleiche Spiele auf diesem Kanal

  scraped_at      TEXT    NOT NULL DEFAULT (datetime('now')),

  UNIQUE (source, source_match_id, country, sender_name)
);

CREATE INDEX IF NOT EXISTS idx_tv_channels_fixture ON tv_channels (fixture_id);
CREATE INDEX IF NOT EXISTS idx_tv_channels_match   ON tv_channels (match_id);
CREATE INDEX IF NOT EXISTS idx_tv_channels_kickoff ON tv_channels (kickoff_utc);

-- Wann wurde zuletzt gescraped? Verhindert zu haeufige Anfragen.
CREATE TABLE IF NOT EXISTS scrape_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,
  country     TEXT NOT NULL,
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now')),
  from_cache  INTEGER NOT NULL DEFAULT 0,
  matches     INTEGER NOT NULL DEFAULT 0,
  channels    INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'ok',
  message     TEXT
);

-- Protokoll der Abgleiche, damit man sieht warum Daten fehlen.
CREATE TABLE IF NOT EXISTS sync_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  provider         TEXT NOT NULL,
  competition_code TEXT,
  started_at       TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at      TEXT,
  inserted         INTEGER NOT NULL DEFAULT 0,
  updated          INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'running',  -- running | ok | error | skipped
  message          TEXT
);
