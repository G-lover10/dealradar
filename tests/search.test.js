import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { storeItems } from '../src/ingest.js';
import { createSearch } from '../src/search.js';

const NOW = new Date('2026-11-16T12:00:00Z');
const posted = { id: 'posts', name: 'Posts', allowed_domains: ['example.com'] };
const store = (id, extra = {}) => ({ id, name: id.toUpperCase(), adapter: id, enabled: true, live: true, allowed_domains: ['example.com'], ...extra });
const rec = (id, title, cents, extra = {}) => ({
  external_id: id, kind: 'deal', title, url: `https://shop.example.com/${id}`, source_url: `https://shop.example.com/${id}`,
  price_cents: cents, posted_at: NOW.toISOString(), status: 'listed', ...extra,
});
function adapter(fn, configured = true) {
  const calls = [];
  return { calls, isConfigured: () => configured, search: async (source, q) => { calls.push(q); return fn(q); } };
}
function setup(adapters, sources, opts = {}) {
  const db = openDb();
  storeItems(db, posted, [rec('p1', 'Posted security camera', 5000, { status: 'lead' }), rec('p2', 'Posted drill', 3000, { status: 'lead' })], NOW);
  let t = NOW.getTime();
  const s = createSearch({ db, config: { sources, ...opts }, adapters, env: {}, now: () => new Date(t) });
  return { ...s, advance: (ms) => { t += ms; } };
}

test('merges posted listings with store results, lowest price first', async () => {
  const a = adapter(() => [rec('a1', 'Camera kit', 4000), rec('a2', 'Camera pro', 9000)]);
  const { search } = setup({ a }, [store('a')]);
  const r = await search('camera');
  assert.deepEqual(r.items.map((i) => i.price_cents), [4000, 5000, 9000]);
  assert.deepEqual(r.searched, ['A']);
  assert.equal(r.items[0].trust.label, 'Store price');
  assert.equal(r.items[0].id, 'live:a:a1');
});

test('a failing store is reported and does not hide other prices', async () => {
  const good = adapter(() => [rec('g1', 'Camera', 2500)]);
  const bad = adapter(() => { throw new Error('boom'); });
  const { search } = setup({ good, bad }, [store('good'), store('bad')]);
  const r = await search('camera');
  assert.deepEqual(r.failed, ['BAD']);
  assert.deepEqual(r.items.map((i) => i.price_cents), [2500, 5000]);
});

test('a store without keys is listed as not connected and never called', async () => {
  const off = adapter(() => [rec('x', 'Camera', 1)], false);
  const { search } = setup({ off }, [store('off')]);
  const r = await search('camera');
  assert.deepEqual(r.not_connected, ['OFF']);
  assert.equal(off.calls.length, 0);
  assert.equal(r.items.length, 1);
});

test('repeat searches use the cache until it expires', async () => {
  const a = adapter(() => [rec('a1', 'Camera', 4000)]);
  const s = setup({ a }, [store('a', { cache_minutes: 5 })]);
  await s.search('camera');
  await s.search('Camera ');
  assert.equal(a.calls.length, 1);
  s.advance(6 * 60_000);
  await s.search('camera');
  assert.equal(a.calls.length, 2);
});

test('short queries return nothing and call no store', async () => {
  const a = adapter(() => [rec('a1', 'Camera', 4000)]);
  const { search } = setup({ a }, [store('a')]);
  assert.equal((await search('c')).items.length, 0);
  assert.equal(a.calls.length, 0);
});

test('links outside the allowed domains are dropped', async () => {
  const a = adapter(() => [rec('ok', 'Camera', 4000), { ...rec('bad', 'Camera', 100), url: 'https://evil.test/x' }]);
  const { search } = setup({ a }, [store('a')]);
  const r = await search('camera');
  assert.ok(!r.items.some((i) => i.price_cents === 100));
});

test('a per-minute cap stops runaway store calls', async () => {
  const a = adapter(() => []);
  const { search } = setup({ a }, [store('a')], { live_searches_per_minute: 2 });
  await search('camera one');
  await search('camera two');
  const r = await search('camera three');
  assert.equal(r.limited, true);
  assert.equal(a.calls.length, 2);
});

test('trips are searched in posted listings only', async () => {
  const a = adapter(() => [rec('a1', 'Camera', 4000)]);
  const { search } = setup({ a }, [store('a')]);
  await search('camera', 'trip');
  assert.equal(a.calls.length, 0);
});
