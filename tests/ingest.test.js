import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { normalize, storeItems, refreshAll } from '../src/ingest.js';

const NOW = new Date('2026-11-13T18:00:00Z');
const SRC_A = { id: 'src-a', name: 'Source A', allowed_domains: ['example.com'] };
const SRC_B = { id: 'src-b', name: 'Source B', allowed_domains: ['example.com'] };

function raw(overrides = {}) {
  return {
    external_id: 'x-1',
    kind: 'deal',
    title: 'Cordless drill kit',
    summary: 'A sample drill',
    merchant: 'Northline Tools',
    url: 'https://shop.example.com/drill',
    source_url: 'https://feed.example.com/1',
    price_cents: 5000,
    posted_at: '2026-11-13T12:00:00Z',
    ...overrides,
  };
}

test('normalize accepts a good record', () => {
  const item = normalize(raw(), SRC_A, NOW);
  assert.ok(item);
  assert.equal(item.price_cents, 5000);
  assert.equal(item.kind, 'deal');
});

test('normalize returns null when required fields are missing or invalid', () => {
  assert.equal(normalize(null, SRC_A, NOW), null);
  assert.equal(normalize(raw({ title: '' }), SRC_A, NOW), null);
  assert.equal(normalize(raw({ title: '<b></b>' }), SRC_A, NOW), null);
  assert.equal(normalize(raw({ url: undefined }), SRC_A, NOW), null);
  assert.equal(normalize(raw({ url: 'http://shop.example.com/drill' }), SRC_A, NOW), null);
  assert.equal(normalize(raw({ url: 'https://evil.test/drill' }), SRC_A, NOW), null);
  assert.equal(normalize(raw({ price_cents: undefined }), SRC_A, NOW), null);
  assert.equal(normalize(raw({ price_cents: 12.5 }), SRC_A, NOW), null);
  assert.equal(normalize(raw({ price_cents: -1 }), SRC_A, NOW), null);
  assert.equal(normalize(raw({ posted_at: undefined }), SRC_A, NOW), null);
  assert.equal(normalize(raw({ posted_at: 'not a date' }), SRC_A, NOW), null);
  assert.equal(normalize(raw({ external_id: undefined }), SRC_A, NOW), null);
  assert.equal(normalize(raw({ external_id: '' }), SRC_A, NOW), null);
});

test('normalize returns null when posted in the future', () => {
  assert.equal(normalize(raw({ posted_at: '2026-11-14T12:00:00Z' }), SRC_A, NOW), null);
});

test('normalize drops a was_price that is not higher than the price', () => {
  assert.equal(normalize(raw({ was_price_cents: 5000 }), SRC_A, NOW).was_price_cents, null);
  assert.equal(normalize(raw({ was_price_cents: 4000 }), SRC_A, NOW).was_price_cents, null);
  assert.equal(normalize(raw({ was_price_cents: 8000 }), SRC_A, NOW).was_price_cents, 8000);
});

test('normalize falls back: unknown status -> lead, unknown category -> Other', () => {
  const item = normalize(raw({ status: 'verified-by-me', category: 'Spaceships' }), SRC_A, NOW);
  assert.equal(item.status, 'lead');
  assert.equal(item.category, 'Other');
});

test('normalize keeps null extra-cost amounts as unknown', () => {
  const item = normalize(raw({ extra_costs: [{ label: 'Resort fee', amount_cents: null }] }), SRC_A, NOW);
  assert.deepEqual(JSON.parse(item.extra_costs), [{ label: 'Resort fee', amount_cents: null }]);
});

test('storeItems: same (source, external_id) twice keeps one item and one source row', () => {
  const db = openDb();
  storeItems(db, SRC_A, [raw()], NOW);
  storeItems(db, SRC_A, [raw({ price_cents: 4500 })], NOW);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM items').get().n, 1);
  const rows = db.prepare('SELECT * FROM item_sources').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price_cents, 4500);
});

test('storeItems: same offer url from two sources gives one item with two source rows', () => {
  const db = openDb();
  storeItems(db, SRC_A, [raw({ external_id: 'a-1' })], NOW);
  storeItems(db, SRC_B, [raw({ external_id: 'b-1', url: 'https://shop.example.com/drill?utm_source=b', price_cents: 4000 })], NOW);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM items').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM item_sources').get().n, 2);
});

test('storeItems skips invalid records and returns the kept count', () => {
  const db = openDb();
  const kept = storeItems(db, SRC_A, [raw(), raw({ external_id: 'bad', title: '' })], NOW);
  assert.equal(kept, 1);
});

test('refreshAll: a throwing source is recorded as failed and does not stop the other', async () => {
  const db = openDb();
  const config = {
    sources: [
      { ...SRC_A, adapter: 'boom', enabled: true },
      { ...SRC_B, adapter: 'good', enabled: true },
    ],
  };
  const adapters = {
    boom: { fetchItems: async () => { throw new Error('network down'); } },
    good: { fetchItems: async () => [raw({ external_id: 'g-1' })] },
  };
  const results = await refreshAll(db, config, adapters, NOW);
  assert.equal(results.length, 2);
  assert.equal(results[0].ok, false);
  assert.equal(results[1].ok, true);
  const runs = db.prepare('SELECT * FROM fetch_runs ORDER BY id').all();
  assert.equal(runs[0].source, 'src-a');
  assert.equal(runs[0].ok, 0);
  assert.match(runs[0].error, /network down/);
  assert.equal(runs[1].source, 'src-b');
  assert.equal(runs[1].ok, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM items').get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM item_sources WHERE source = 'src-b'").get().n, 1);
});

test('refreshAll: a failing source keeps items stored earlier', async () => {
  const db = openDb();
  const config = { sources: [{ ...SRC_A, adapter: 'flaky', enabled: true }] };
  let fail = false;
  const adapters = {
    flaky: { fetchItems: async () => { if (fail) throw new Error('later failure'); return [raw()]; } },
  };
  await refreshAll(db, config, adapters, NOW);
  fail = true;
  const results = await refreshAll(db, config, adapters, NOW);
  assert.equal(results[0].ok, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM items').get().n, 1);
});

test('refreshAll: an unknown adapter name is recorded as a failure, not a crash', async () => {
  const db = openDb();
  const config = { sources: [{ ...SRC_A, adapter: 'nope', enabled: true }] };
  const results = await refreshAll(db, config, {}, NOW);
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /nope/);
  const run = db.prepare('SELECT * FROM fetch_runs').get();
  assert.equal(run.ok, 0);
});

test('refreshAll: disabled sources are not fetched', async () => {
  const db = openDb();
  let called = false;
  const config = { sources: [{ ...SRC_A, adapter: 'x', enabled: false }] };
  const results = await refreshAll(db, config, { x: { fetchItems: async () => { called = true; return []; } } }, NOW);
  assert.equal(called, false);
  assert.equal(results.length, 0);
});
