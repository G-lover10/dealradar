import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  merge_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('deal','trip')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  merchant TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Other',
  trip_type TEXT,
  was_price_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'lead' CHECK (status IN ('lead','confirmed','expected')),
  eligibility TEXT NOT NULL DEFAULT 'everyone' CHECK (eligibility IN ('everyone','first_responder')),
  verification TEXT NOT NULL DEFAULT '',
  extra_costs TEXT NOT NULL DEFAULT '[]',
  stock_checked INTEGER NOT NULL DEFAULT 0,
  affiliate INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS item_sources (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_name TEXT NOT NULL,
  external_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  posted_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE (source, external_id)
);
CREATE TABLE IF NOT EXISTS fetch_runs (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sources_item ON item_sources(item_id);
`;

/** Open a database and make sure the schema exists. */
export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}
