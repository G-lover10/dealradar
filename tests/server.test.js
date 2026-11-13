import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/server.js';

const NOW = new Date('2026-11-13T18:00:00Z');
let clock = NOW.getTime();
let server;
let base;
let app;

const config = {
  refresh_cooldown_seconds: 60,
  max_items_per_fetch: 200,
  sources: [
    { id: 'src-a', name: 'Source A', adapter: 'stub', enabled: true, sample: true, allowed_domains: ['example.com'] },
    { id: 'src-b', name: 'Source B', adapter: 'stub', enabled: true, sample: true, allowed_domains: ['example.com'] },
  ],
};
const adapters = {
  stub: {
    fetchItems: async (source) => [
      {
        external_id: `${source.id}-1`,
        kind: 'deal',
        title: `Deal from ${source.id}`,
        summary: 'Sample',
        merchant: 'Northline Tools',
        url: `https://shop.example.com/${source.id}`,
        source_url: `https://feed.example.com/${source.id}`,
        price_cents: 2500,
        posted_at: new Date(NOW.getTime() - 3_600_000).toISOString(),
      },
    ],
  },
};

before(async () => {
  const db = openDb();
  app = createApp({ db, config, adapters, now: () => new Date(clock) });
  await app.refresh();
  server = http.createServer(app.handle);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

test('GET /api/items?kind=deal returns an items array after refresh', async () => {
  const res = await fetch(`${base}/api/items?kind=deal`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.items));
  assert.equal(body.items.length, 2);
});

test('POST /api/refresh twice: second call is 429 with Retry-After', async () => {
  const first = await fetch(`${base}/api/refresh`, { method: 'POST' });
  assert.equal(first.status, 200);
  clock += 5_000;
  const second = await fetch(`${base}/api/refresh`, { method: 'POST' });
  assert.equal(second.status, 429);
  const retry = Number(second.headers.get('retry-after'));
  assert.ok(retry > 0 && retry <= 60);
  clock += 61_000;
  const third = await fetch(`${base}/api/refresh`, { method: 'POST' });
  assert.equal(third.status, 200);
});

test('path traversal does not return package.json', async () => {
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json']) {
    const res = await fetch(`${base}${p}`);
    const text = await res.text();
    assert.equal(res.status, 404, p);
    assert.ok(!text.includes('"dealradar"'), p);
  }
});

test('GET /api/status reports sample_only true when every enabled source is a sample', async () => {
  const res = await fetch(`${base}/api/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sample_only, true);
  assert.equal(body.sources.length, 2);
});

test('responses include a Content-Security-Policy header', async () => {
  for (const p of ['/api/items?kind=deal', '/api/status', '/nope.html']) {
    const res = await fetch(`${base}${p}`);
    await res.text();
    assert.ok(res.headers.get('content-security-policy'), p);
  }
});

test('a malformed escape in the path returns 404, not a server error', async () => {
  const { createApp } = await import('../src/server.js');
  const { openDb } = await import('../src/db.js');
  const http = await import('node:http');
  const app = createApp({ db: openDb(), config: { sources: [] }, adapters: {} });
  const server = http.createServer(app.handle);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/%zz`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});
