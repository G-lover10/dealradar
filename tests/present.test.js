import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { storeItems } from '../src/ingest.js';
import { listItems, ageLabel } from '../src/present.js';

const NOW = new Date('2026-11-13T18:00:00Z');
const SRC_A = { id: 'src-a', name: 'Source A', allowed_domains: ['example.com'] };
const SRC_B = { id: 'src-b', name: 'Source B', allowed_domains: ['example.com'] };
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const inDays = (d) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

function raw(id, overrides = {}) {
  return {
    external_id: id,
    kind: 'deal',
    title: `Item ${id}`,
    summary: 'Sample',
    merchant: 'Northline Tools',
    url: `https://shop.example.com/${id}`,
    source_url: `https://feed.example.com/${id}`,
    price_cents: 5000,
    posted_at: hoursAgo(2),
    ...overrides,
  };
}

function setup(src, records) {
  const db = openDb();
  storeItems(db, src, records, NOW);
  return db;
}

test('listItems sorts by lowest price first', () => {
  const db = setup(SRC_A, [raw('hi', { price_cents: 9000 }), raw('lo', { price_cents: 1000 }), raw('mid', { price_cents: 4000 })]);
  assert.deepEqual(listItems(db, 'deal', NOW).map((i) => i.price_cents), [1000, 4000, 9000]);
});

test('a merged item shows the lowest source price and lists both sources', () => {
  const db = openDb();
  storeItems(db, SRC_A, [raw('one', { price_cents: 5000 })], NOW);
  storeItems(db, SRC_B, [raw('two', { url: 'https://shop.example.com/one?utm_source=b', price_cents: 4200 })], NOW);
  const items = listItems(db, 'deal', NOW);
  assert.equal(items.length, 1);
  assert.equal(items[0].price_cents, 4200);
  assert.equal(items[0].sources.length, 2);
  assert.deepEqual(items[0].sources.map((s) => s.name), ['Source B', 'Source A']);
});

test('an expired item is not listed; a future expiry is', () => {
  const db = setup(SRC_A, [
    raw('old', { expires_at: inDays(-1) }),
    raw('new', { expires_at: inDays(2) }),
    raw('none'),
  ]);
  const titles = listItems(db, 'deal', NOW).map((i) => i.title);
  assert.ok(!titles.includes('Item old'));
  assert.ok(titles.includes('Item new'));
  assert.ok(titles.includes('Item none'));
});

test('status "expected" is labelled Expected and never Confirmed; default is Lead', () => {
  const db = setup(SRC_A, [raw('exp', { status: 'expected' }), raw('def')]);
  const items = listItems(db, 'deal', NOW);
  const exp = items.find((i) => i.title === 'Item exp');
  const def = items.find((i) => i.title === 'Item def');
  assert.equal(exp.trust.label, 'Expected');
  assert.notEqual(exp.trust.label, 'Confirmed');
  assert.equal(def.trust.label, 'Lead');
});

test('percent_off_stated is null with no was price, and computed with one', () => {
  const db = setup(SRC_A, [raw('nowas'), raw('was', { price_cents: 7500, was_price_cents: 10000 })]);
  const items = listItems(db, 'deal', NOW);
  assert.equal(items.find((i) => i.title === 'Item nowas').percent_off_stated, null);
  assert.equal(items.find((i) => i.title === 'Item was').percent_off_stated, 25);
});

test('all_in_cents adds known extra costs; has_unknown_costs is true for a null amount', () => {
  const db = setup(SRC_A, [
    raw('extras', {
      price_cents: 10000,
      extra_costs: [
        { label: 'Shipping', amount_cents: 599 },
        { label: 'Membership required', amount_cents: null },
      ],
    }),
    raw('plain', { price_cents: 10000 }),
  ]);
  const items = listItems(db, 'deal', NOW);
  const extras = items.find((i) => i.title === 'Item extras');
  assert.equal(extras.all_in_cents, 10599);
  assert.equal(extras.has_unknown_costs, true);
  const plain = items.find((i) => i.title === 'Item plain');
  assert.equal(plain.has_unknown_costs, false);
});

test('trip items carry the cart warning; deal items have null', () => {
  const db = openDb();
  storeItems(db, SRC_A, [raw('d1'), raw('t1', { kind: 'trip', trip_type: 'beach', url: 'https://travel.example.com/t1' })], NOW);
  const trip = listItems(db, 'trip', NOW)[0];
  const deal = listItems(db, 'deal', NOW)[0];
  assert.equal(trip.cart_warning, 'The price can change in the cart. Open the link before you pay.');
  assert.equal(deal.cart_warning, null);
});

test('every listed item has a source with name and url, posted_at, age and trust label', () => {
  const db = openDb();
  storeItems(db, SRC_A, [raw('d1'), raw('t1', { kind: 'trip', trip_type: 'ski', url: 'https://travel.example.com/t1' })], NOW);
  for (const kind of ['deal', 'trip']) {
    const items = listItems(db, kind, NOW);
    assert.ok(items.length > 0);
    for (const item of items) {
      assert.ok(item.sources.length >= 1);
      for (const s of item.sources) {
        assert.ok(s.name);
        assert.ok(s.url);
      }
      assert.ok(item.posted_at);
      assert.ok(item.age.length > 0);
      assert.ok(item.trust.label);
    }
  }
});

test('ageLabel formats minutes, hours and days', () => {
  assert.equal(ageLabel(new Date(NOW.getTime() - 30 * 60_000).toISOString(), NOW), '30 min ago');
  assert.equal(ageLabel(hoursAgo(5), NOW), '5 hours ago');
  assert.equal(ageLabel(hoursAgo(72), NOW), '3 days ago');
  assert.equal(ageLabel(hoursAgo(1), NOW), '1 hour ago');
  assert.equal(ageLabel(hoursAgo(24), NOW), '1 day ago');
});

test('first-responder items keep their eligibility and verification note', async () => {
  const { openDb } = await import('../src/db.js');
  const { storeItems } = await import('../src/ingest.js');
  const { listItems } = await import('../src/present.js');
  const now = new Date('2026-11-13T18:00:00Z');
  const db = openDb();
  const source = { id: 's', name: 'S', allowed_domains: ['example.com'] };
  const base = { kind: 'deal', price_cents: 1000, posted_at: '2026-11-13T12:00:00Z', source_url: 'https://feed.example.com/x' };
  storeItems(db, source, [
    { ...base, external_id: '1', title: 'Responder boots', url: 'https://shop.example.com/a', eligibility: 'first_responder', verification: 'ID check at checkout' },
    { ...base, external_id: '2', title: 'Public boots', url: 'https://shop.example.com/b' },
    { ...base, external_id: '3', title: 'Odd value', url: 'https://shop.example.com/c', eligibility: 'vip' },
  ], now);
  const byTitle = Object.fromEntries(listItems(db, 'deal', now).map((i) => [i.title, i]));
  assert.equal(byTitle['Responder boots'].eligibility, 'first_responder');
  assert.equal(byTitle['Responder boots'].verification, 'ID check at checkout');
  assert.equal(byTitle['Public boots'].eligibility, 'everyone');
  assert.equal(byTitle['Odd value'].eligibility, 'everyone');
});
