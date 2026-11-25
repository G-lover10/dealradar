import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ebayAdapter, _resetTokenCache as resetEbay } from '../src/adapters/ebay.js';
import { bestbuyAdapter } from '../src/adapters/bestbuy.js';
import { amazonAdapter, _resetTokenCache as resetAmazon } from '../src/adapters/amazon.js';
import { normalize } from '../src/ingest.js';

const load = async (name) => JSON.parse(await readFile(new URL(`../fixtures/api/${name}`, import.meta.url), 'utf8'));
const NOW = new Date('2026-11-16T12:00:00.000Z');
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** Fake fetch: routes by URL to handlers, records every request. */
function fakeFetch(route) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers ?? {}, body: init.body, hasSignal: Boolean(init.signal) });
    return route(String(url), init);
  };
  fn.calls = calls;
  return fn;
}

beforeEach(() => {
  resetEbay();
  resetAmazon();
});

// ---------------------------------------------------------------- eBay
const EBAY_ENV = { EBAY_CLIENT_ID: 'test-id', EBAY_CLIENT_SECRET: 'test-secret-value' };
const ebaySource = { id: 'ebay', name: 'eBay', allowed_domains: ['ebay.com', 'ebayimg.com'] };
const ebayRoute = (fixture, searchStatus = 200, searchHeaders = {}) => (url) =>
  url.includes('/identity/v1/oauth2/token')
    ? json({ access_token: 'fake-token-1', expires_in: 7200, token_type: 'Application Access Token' })
    : json(fixture, searchStatus, searchHeaders);

test('ebay: isConfigured', () => {
  assert.equal(ebayAdapter.isConfigured(EBAY_ENV), true);
  assert.equal(ebayAdapter.isConfigured({ EBAY_CLIENT_ID: 'x' }), false);
  assert.equal(ebayAdapter.isConfigured({}), false);
});

test('ebay: requests match the docs', async () => {
  const f = fakeFetch(ebayRoute(await load('ebay-search.json')));
  await ebayAdapter.search(ebaySource, ' example widget ', { env: EBAY_ENV, fetchImpl: f, now: NOW });
  const [tok, srch] = f.calls;
  assert.equal(tok.url, 'https://api.ebay.com/identity/v1/oauth2/token');
  assert.equal(tok.method, 'POST');
  assert.equal(tok.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(tok.headers.Authorization, `Basic ${Buffer.from('test-id:test-secret-value').toString('base64')}`);
  const form = new URLSearchParams(tok.body);
  assert.equal(form.get('grant_type'), 'client_credentials');
  assert.equal(form.get('scope'), 'https://api.ebay.com/oauth/api_scope');

  const u = new URL(srch.url);
  assert.equal(u.host, 'api.ebay.com');
  assert.equal(u.pathname, '/buy/browse/v1/item_summary/search');
  assert.equal(u.searchParams.get('q'), 'example widget');
  assert.equal(u.searchParams.get('limit'), '20');
  assert.equal(u.searchParams.get('filter'), 'conditions:{NEW},buyingOptions:{FIXED_PRICE}');
  assert.equal(u.searchParams.get('sort'), 'price');
  assert.equal(srch.headers.Authorization, 'Bearer fake-token-1');
  assert.equal(srch.headers['X-EBAY-C-MARKETPLACE-ID'], 'EBAY_US');
  assert.equal(srch.headers['X-EBAY-C-ENDUSERCTX'], undefined);
  assert.ok(srch.hasSignal && tok.hasSignal);
});

test('ebay: records map correctly (no campaign)', async () => {
  const f = fakeFetch(ebayRoute(await load('ebay-search.json')));
  const recs = await ebayAdapter.search(ebaySource, 'example widget', { env: EBAY_ENV, fetchImpl: f, now: NOW });
  assert.equal(recs.length, 3); // EUR item skipped
  const [a, b, d] = recs;
  assert.equal(a.external_id, 'v1|110000000001|0');
  assert.equal(a.price_cents, 4999);
  assert.equal(a.was_price_cents, undefined);
  assert.equal(a.extra_costs, undefined); // free shipping
  assert.equal(a.merchant, 'eBay · example_seller_one');
  assert.equal(a.image_url, 'https://i.ebayimg.com/images/g/EXAMPLE01/s-l225.jpg');
  assert.equal(a.url, 'https://www.ebay.com/itm/110000000001');
  assert.equal(a.affiliate, false);
  assert.equal(a.status, 'listed');
  assert.equal(a.kind, 'deal');
  assert.equal(a.stock_checked, false);
  assert.equal(a.posted_at, NOW.toISOString());
  // without a campaign id the plain link is used even though the API returned an affiliate link
  assert.equal(b.url, 'https://www.ebay.com/itm/110000000002');
  assert.equal(b.was_price_cents, 9999);
  assert.deepEqual(b.extra_costs, [{ label: 'Shipping', amount_cents: 599 }]);
  assert.deepEqual(d.extra_costs, [{ label: 'Shipping', amount_cents: null }]);
  assert.equal(d.image_url, undefined);
  assert.ok(!recs.some((r) => r.external_id.includes('110000000003')));
});

test('ebay: campaign id sends the header and uses the affiliate link', async () => {
  const f = fakeFetch(ebayRoute(await load('ebay-search.json')));
  const env = { ...EBAY_ENV, EBAY_CAMPAIGN_ID: '5300000000', EBAY_MARKETPLACE: 'EBAY_US' };
  const recs = await ebayAdapter.search(ebaySource, 'example widget', { env, fetchImpl: f, now: NOW });
  assert.equal(f.calls[1].headers['X-EBAY-C-ENDUSERCTX'], 'affiliateCampaignId=5300000000');
  const b = recs.find((r) => r.external_id === 'v1|110000000002|0');
  assert.equal(b.url, 'https://www.ebay.com/itm/110000000002?example_affiliate_tracking=1');
  assert.equal(b.source_url, 'https://www.ebay.com/itm/110000000002');
  assert.equal(b.affiliate, true);
  const a = recs.find((r) => r.external_id === 'v1|110000000001|0'); // no affiliate url returned
  assert.equal(a.affiliate, false);
});

test('ebay: limit caps results', async () => {
  const f = fakeFetch(ebayRoute(await load('ebay-search.json')));
  const recs = await ebayAdapter.search(ebaySource, 'example widget', { env: EBAY_ENV, fetchImpl: f, now: NOW, limit: 1 });
  assert.equal(recs.length, 1);
  assert.equal(new URL(f.calls[1].url).searchParams.get('limit'), '1');
});

test('ebay: short query returns [] without fetching', async () => {
  const f = fakeFetch(() => json({}));
  assert.deepEqual(await ebayAdapter.search(ebaySource, ' a ', { env: EBAY_ENV, fetchImpl: f }), []);
  assert.equal(f.calls.length, 0);
});

test('ebay: HTTP 500 throws, 429 carries status and retryAfter, no secret leaks', async () => {
  const f500 = fakeFetch(ebayRoute({}, 500));
  await assert.rejects(ebayAdapter.search(ebaySource, 'widget', { env: EBAY_ENV, fetchImpl: f500 }), (e) => {
    assert.equal(e.message, 'eBay search failed (HTTP 500)');
    assert.ok(!e.message.includes('test-secret-value') && !e.message.includes('fake-token-1'));
    return true;
  });
  resetEbay();
  const f429 = fakeFetch(ebayRoute({}, 429, { 'retry-after': '30' }));
  await assert.rejects(ebayAdapter.search(ebaySource, 'widget', { env: EBAY_ENV, fetchImpl: f429 }), (e) => {
    assert.equal(e.status, 429);
    assert.equal(e.retryAfter, 30);
    return true;
  });
  assert.equal(f429.calls.length, 2); // token + one search, no retry loop
  resetEbay();
  const fTok = fakeFetch(() => json({ error: 'invalid_client' }, 401));
  await assert.rejects(ebayAdapter.search(ebaySource, 'widget', { env: EBAY_ENV, fetchImpl: fTok }), (e) => {
    assert.ok(!e.message.includes('test-secret-value') && !e.message.includes('test-id'));
    return true;
  });
});

test('ebay: token fetched once across two searches', async () => {
  const f = fakeFetch(ebayRoute(await load('ebay-search.json')));
  await ebayAdapter.search(ebaySource, 'widget', { env: EBAY_ENV, fetchImpl: f, now: NOW });
  await ebayAdapter.search(ebaySource, 'gadget', { env: EBAY_ENV, fetchImpl: f, now: NOW });
  assert.equal(f.calls.filter((c) => c.url.includes('oauth2/token')).length, 1);
  assert.equal(f.calls.length, 3);
});

test('ebay: records pass normalize()', async () => {
  const f = fakeFetch(ebayRoute(await load('ebay-search.json')));
  const env = { ...EBAY_ENV, EBAY_CAMPAIGN_ID: '5300000000' };
  for (const r of await ebayAdapter.search(ebaySource, 'widget', { env, fetchImpl: f, now: NOW })) {
    assert.notEqual(normalize(r, ebaySource, NOW), null);
  }
});

// ---------------------------------------------------------------- Best Buy
const BB_ENV = { BESTBUY_API_KEY: 'bb-test-key-123' };
const bbSource = { id: 'bestbuy', name: 'Best Buy', allowed_domains: ['bestbuy.com', 'bbystatic.com'] };

test('bestbuy: isConfigured', () => {
  assert.equal(bestbuyAdapter.isConfigured(BB_ENV), true);
  assert.equal(bestbuyAdapter.isConfigured({}), false);
});

test('bestbuy: request matches the docs', async () => {
  const f = fakeFetch(async () => json(await load('bestbuy-search.json')));
  await bestbuyAdapter.search(bbSource, '  Example Widget! ', { env: BB_ENV, fetchImpl: f, now: NOW });
  const u = new URL(f.calls[0].url);
  assert.equal(u.host, 'api.bestbuy.com');
  assert.equal(decodeURIComponent(u.pathname), '/v1/products(search=Example&search=Widget)');
  assert.equal(u.searchParams.get('apiKey'), 'bb-test-key-123');
  assert.equal(u.searchParams.get('format'), 'json');
  assert.equal(u.searchParams.get('pageSize'), '20');
  assert.match(u.searchParams.get('show'), /^sku,name,salePrice,regularPrice,/);
  assert.ok(f.calls[0].hasSignal);
});

test('bestbuy: query is reduced to safe words (no operators or wildcards)', async () => {
  const f = fakeFetch(async () => json(await load('bestbuy-search.json')));
  await bestbuyAdapter.search(bbSource, '*tv) | (sku>1', { env: BB_ENV, fetchImpl: f, now: NOW });
  const path = decodeURIComponent(new URL(f.calls[0].url).pathname);
  assert.equal(path, '/v1/products(search=tv&search=sku&search=1)');
});

test('bestbuy: records map correctly', async () => {
  const f = fakeFetch(async () => json(await load('bestbuy-search.json')));
  const recs = await bestbuyAdapter.search(bbSource, 'widget', { env: BB_ENV, fetchImpl: f, now: NOW });
  assert.equal(recs.length, 2); // missing price and not-online items skipped
  const [a, b] = recs;
  assert.equal(a.external_id, '1000001');
  assert.equal(a.price_cents, 19999);
  assert.equal(a.was_price_cents, undefined);
  assert.equal(a.extra_costs, undefined);
  assert.equal(a.merchant, 'Best Buy');
  assert.equal(a.status, 'listed');
  assert.equal(a.stock_checked, true);
  assert.equal(a.affiliate, false);
  assert.equal(a.url, 'https://api.bestbuy.com/click/-/1000001/pdp');
  assert.equal(a.image_url, 'https://pisces.bbystatic.com/image2/BestBuy_US/images/products/1000/1000001_sd.jpg');
  assert.equal(a.posted_at, NOW.toISOString());
  assert.equal(b.price_cents, 7999);
  assert.equal(b.was_price_cents, 10999);
  assert.deepEqual(b.extra_costs, [{ label: 'Shipping', amount_cents: 599 }]);
});

test('bestbuy: limit, short query, errors', async () => {
  const f = fakeFetch(async () => json(await load('bestbuy-search.json')));
  assert.equal((await bestbuyAdapter.search(bbSource, 'widget', { env: BB_ENV, fetchImpl: f, now: NOW, limit: 1 })).length, 1);
  const none = fakeFetch(() => json({}));
  assert.deepEqual(await bestbuyAdapter.search(bbSource, 'x', { env: BB_ENV, fetchImpl: none }), []);
  assert.equal(none.calls.length, 0);

  await assert.rejects(
    bestbuyAdapter.search(bbSource, 'widget', { env: BB_ENV, fetchImpl: fakeFetch(() => json({}, 500)) }),
    (e) => {
      assert.equal(e.message, 'Best Buy search failed (HTTP 500)');
      assert.ok(!e.message.includes('bb-test-key-123'));
      return true;
    },
  );
  await assert.rejects(
    bestbuyAdapter.search(bbSource, 'widget', { env: BB_ENV, fetchImpl: fakeFetch(() => json({}, 429, { 'retry-after': '12' })) }),
    (e) => e.status === 429 && e.retryAfter === 12,
  );
});

test('bestbuy: records pass normalize()', async () => {
  const f = fakeFetch(async () => json(await load('bestbuy-search.json')));
  for (const r of await bestbuyAdapter.search(bbSource, 'widget', { env: BB_ENV, fetchImpl: f, now: NOW })) {
    assert.notEqual(normalize(r, bbSource, NOW), null);
  }
});

// ---------------------------------------------------------------- Amazon
const AMZ_ENV = { AMAZON_CREDENTIAL_ID: 'amz-id', AMAZON_CREDENTIAL_SECRET: 'amz-secret-value', AMAZON_PARTNER_TAG: 'exampletag-20' };
const amzSource = { id: 'amazon', name: 'Amazon', allowed_domains: ['amazon.com', 'media-amazon.com'] };
const amzRoute = (fixture, status = 200, headers = {}) => (url) =>
  url.includes('/auth/o2/token') ? json({ access_token: 'amz-token-1', expires_in: 3600 }) : json(fixture, status, headers);

test('amazon: isConfigured', () => {
  assert.equal(amazonAdapter.isConfigured(AMZ_ENV), true);
  assert.equal(amazonAdapter.isConfigured({ ...AMZ_ENV, AMAZON_PARTNER_TAG: '' }), false);
  assert.equal(amazonAdapter.isConfigured({}), false);
});

test('amazon: requests match the docs', async () => {
  const f = fakeFetch(amzRoute(await load('amazon-search.json')));
  await amazonAdapter.search(amzSource, ' example widget ', { env: AMZ_ENV, fetchImpl: f, now: NOW });
  const [tok, srch] = f.calls;
  assert.equal(tok.url, 'https://api.amazon.com/auth/o2/token');
  assert.equal(tok.method, 'POST');
  assert.equal(tok.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(tok.body), {
    grant_type: 'client_credentials',
    client_id: 'amz-id',
    client_secret: 'amz-secret-value',
    scope: 'creatorsapi::default',
  });
  const u = new URL(srch.url);
  assert.equal(u.host, 'creatorsapi.amazon');
  assert.equal(u.pathname, '/catalog/v1/searchItems');
  assert.equal(srch.method, 'POST');
  assert.equal(srch.headers.Authorization, 'Bearer amz-token-1');
  assert.equal(srch.headers['Content-Type'], 'application/json');
  assert.equal(srch.headers['x-marketplace'], 'www.amazon.com');
  const body = JSON.parse(srch.body);
  assert.equal(body.partnerTag, 'exampletag-20');
  assert.equal(body.keywords, 'example widget');
  assert.equal(body.marketplace, 'www.amazon.com');
  assert.equal(body.itemCount, 10);
  assert.equal(body.condition, 'New');
  assert.ok(body.resources.includes('offersV2.listings.price'));
  assert.ok(srch.hasSignal && tok.hasSignal);
});

test('amazon: records map correctly', async () => {
  const f = fakeFetch(amzRoute(await load('amazon-search.json')));
  const recs = await amazonAdapter.search(amzSource, 'widget', { env: AMZ_ENV, fetchImpl: f, now: NOW });
  assert.equal(recs.length, 3); // item without an offer is skipped
  const [a, b, d] = recs;
  assert.equal(a.external_id, 'B0EXAMPL01');
  assert.equal(a.price_cents, 2499);
  assert.equal(a.was_price_cents, undefined);
  assert.equal(a.url, 'https://www.amazon.com/dp/B0EXAMPL01?tag=exampletag-20&linkCode=osi');
  assert.equal(a.source_url, 'https://www.amazon.com/dp/B0EXAMPL01');
  assert.equal(a.affiliate, true);
  assert.equal(a.merchant, 'Amazon');
  assert.equal(a.status, 'listed');
  assert.equal(a.stock_checked, true);
  assert.equal(a.image_url, 'https://m.media-amazon.com/images/I/EXAMPLE01._SL160_.jpg');
  assert.equal(a.extra_costs, undefined);
  assert.equal(b.price_cents, 5949);
  assert.equal(b.was_price_cents, 6999);
  assert.equal(d.price_cents, 3000);
  assert.equal(d.was_price_cents, undefined); // LOWEST_PRICE basis is not an original price
  assert.equal(d.stock_checked, false); // availability UNKNOWN
});

test('amazon: non-USD offer is skipped', async () => {
  const fx = await load('amazon-search.json');
  fx.searchResult.items[0].offersV2.listings[0].price.money.currency = 'CAD';
  const f = fakeFetch(amzRoute(fx));
  const recs = await amazonAdapter.search(amzSource, 'widget', { env: AMZ_ENV, fetchImpl: f, now: NOW });
  assert.ok(!recs.some((r) => r.external_id === 'B0EXAMPL01'));
});

test('amazon: limit, short query, errors, no secret leak', async () => {
  const f = fakeFetch(amzRoute(await load('amazon-search.json')));
  assert.equal((await amazonAdapter.search(amzSource, 'widget', { env: AMZ_ENV, fetchImpl: f, now: NOW, limit: 1 })).length, 1);
  assert.equal(JSON.parse(f.calls[1].body).itemCount, 1);
  const none = fakeFetch(() => json({}));
  assert.deepEqual(await amazonAdapter.search(amzSource, ' ', { env: AMZ_ENV, fetchImpl: none }), []);
  assert.equal(none.calls.length, 0);

  resetAmazon();
  await assert.rejects(amazonAdapter.search(amzSource, 'widget', { env: AMZ_ENV, fetchImpl: fakeFetch(amzRoute({}, 500)) }), (e) => {
    assert.equal(e.message, 'Amazon search failed (HTTP 500)');
    assert.ok(!e.message.includes('amz-secret-value') && !e.message.includes('amz-token-1'));
    return true;
  });
  resetAmazon();
  const f429 = fakeFetch(amzRoute({ type: 'ThrottleException', retryAfterSeconds: 60 }, 429));
  await assert.rejects(amazonAdapter.search(amzSource, 'widget', { env: AMZ_ENV, fetchImpl: f429 }), (e) => {
    assert.equal(e.status, 429);
    assert.equal(e.retryAfter, 60);
    return true;
  });
  assert.equal(f429.calls.length, 2);
  resetAmazon();
  const tok429 = fakeFetch(() => json({ error: 'too_many_requests' }, 429, { 'retry-after': '300' }));
  await assert.rejects(amazonAdapter.search(amzSource, 'widget', { env: AMZ_ENV, fetchImpl: tok429 }), (e) => {
    assert.equal(e.status, 429);
    assert.equal(e.retryAfter, 300);
    assert.ok(!e.message.includes('amz-secret-value'));
    return true;
  });
});

test('amazon: token fetched once across two searches', async () => {
  const f = fakeFetch(amzRoute(await load('amazon-search.json')));
  await amazonAdapter.search(amzSource, 'widget', { env: AMZ_ENV, fetchImpl: f, now: NOW });
  await amazonAdapter.search(amzSource, 'gadget', { env: AMZ_ENV, fetchImpl: f, now: NOW });
  assert.equal(f.calls.filter((c) => c.url.includes('/auth/o2/token')).length, 1);
  assert.equal(f.calls.length, 3);
});

test('amazon: records pass normalize()', async () => {
  const f = fakeFetch(amzRoute(await load('amazon-search.json')));
  for (const r of await amazonAdapter.search(amzSource, 'widget', { env: AMZ_ENV, fetchImpl: f, now: NOW })) {
    assert.notEqual(normalize(r, amzSource, NOW), null);
  }
});
