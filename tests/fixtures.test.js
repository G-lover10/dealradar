import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { normalize, refreshAll, CATEGORIES, TRIP_TYPES } from '../src/ingest.js';
import { listItems } from '../src/present.js';
import { fixtureAdapter } from '../src/adapters/fixture.js';

const NOW = new Date('2026-11-13T18:00:00Z');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adapters = { fixture: { fetchItems: (s) => fixtureAdapter.fetchItems(s, NOW) } };

let config;
let db;
let results;
let deals;
let trips;

before(async () => {
  config = JSON.parse(await readFile(path.join(ROOT, 'config/sources.json'), 'utf8'));
  db = openDb();
  results = await refreshAll(db, config, adapters, NOW);
  deals = listItems(db, 'deal', NOW);
  trips = listItems(db, 'trip', NOW);
});

test('every enabled source refreshed successfully', () => {
  assert.equal(results.length, config.sources.filter((s) => s.enabled).length);
  for (const r of results) assert.equal(r.ok, true, `${r.source}: ${r.error}`);
});

test('every record in both files normalizes (none skipped)', async () => {
  for (const source of config.sources) {
    const raw = await fixtureAdapter.fetchItems(source, NOW);
    assert.ok(raw.length > 0);
    const ids = new Set(raw.map((r) => r.external_id));
    assert.equal(ids.size, raw.length, `${source.id} has duplicate external_id`);
    for (const r of raw) assert.ok(normalize(r, source, NOW), `${source.id}/${r.external_id} was skipped`);
    const run = results.find((x) => x.source === source.id);
    assert.equal(run.count, raw.length);
  }
});

test('exactly three offers are merged (items with 2 sources)', () => {
  const merged = [...deals, ...trips].filter((i) => i.sources.length === 2);
  assert.equal(merged.length, 3);
  for (const item of merged) {
    const prices = item.sources.map((s) => s.price_cents);
    assert.notEqual(prices[0], prices[1]);
    assert.equal(item.price_cents, Math.min(...prices));
  }
  assert.equal([...deals, ...trips].filter((i) => i.sources.length > 2).length, 0);
});

test('the expired record is not in listItems but is stored', async () => {
  const raw = await fixtureAdapter.fetchItems(config.sources[0], NOW);
  const expired = raw.filter((r) => r.expires_in_days < 0);
  assert.equal(expired.length, 1);
  const all = [...deals, ...trips];
  assert.ok(!all.some((i) => i.title === expired[0].title));
  assert.ok(db.prepare('SELECT 1 FROM items WHERE title = ?').get(expired[0].title));
});

test('both kinds have items; every deal category and trip_type appears', () => {
  assert.ok(deals.length > 0);
  assert.ok(trips.length > 0);
  for (const c of CATEGORIES) assert.ok(deals.some((d) => d.category === c), `missing category ${c}`);
  for (const t of TRIP_TYPES) assert.ok(trips.some((x) => x.trip_type === t), `missing trip_type ${t}`);
});

test('no title, summary or merchant contains "free"', async () => {
  for (const source of config.sources) {
    const raw = JSON.parse(await readFile(path.join(ROOT, source.file), 'utf8'));
    for (const r of raw) {
      for (const field of ['title', 'summary', 'merchant']) {
        assert.ok(!/free/i.test(r[field] ?? ''), `${r.external_id}.${field}`);
      }
    }
  }
});

test('summaries are under 160 characters and every item has a trust label', () => {
  for (const item of [...deals, ...trips]) {
    assert.ok(item.summary.length <= 160, item.title);
    assert.ok(item.trust.label);
  }
});
