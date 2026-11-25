// Amazon Creators API SearchItems adapter (official API only, no scraping).
// Docs:
//   SearchItems:  https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/search-items
//   Token + host: https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-curl
//   Headers:      https://affiliate-program.amazon.com/creatorsapi/docs/en-us/concepts/common-request-headers-and-parameters
//   OffersV2:     https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/resources/offersV2
//   Errors:       https://affiliate-program.amazon.com/creatorsapi/docs/en-us/troubleshooting/error-codes-and-messages

const STORE = 'Amazon';
const TOKEN_URL = 'https://api.amazon.com/auth/o2/token'; // NA region (US, CA, MX, BR) - using-curl page
const SEARCH_URL = 'https://creatorsapi.amazon/catalog/v1/searchItems'; // using-curl / migration pages
const MARKETPLACE = 'www.amazon.com'; // United States - common-request-headers page
const TIMEOUT_MS = 15000;

let tokenCache = null; // { token, expiresAt, clientId }

export function _resetTokenCache() {
  tokenCache = null;
}

function retryAfterFrom(res, body) {
  const raw = res.headers?.get?.('retry-after');
  const h = raw ? Number(raw) : NaN;
  if (Number.isFinite(h) && h >= 0) return h;
  const b = Number(body?.retryAfterSeconds); // documented in the 429 ThrottleException body
  return Number.isFinite(b) && b >= 0 ? b : null;
}

async function failure(message, res) {
  const err = new Error(message);
  err.status = res.status;
  if (res.status === 429) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    err.retryAfter = retryAfterFrom(res, body);
  }
  return err;
}

async function getToken(env, fetchImpl) {
  const clientId = env.AMAZON_CREDENTIAL_ID;
  if (tokenCache && tokenCache.clientId === clientId && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  // Request: POST https://api.amazon.com/auth/o2/token, JSON body
  // {grant_type: client_credentials, client_id, client_secret, scope: creatorsapi::default} (using-curl page)
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: env.AMAZON_CREDENTIAL_SECRET,
      scope: 'creatorsapi::default',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw await failure(`${STORE} token request failed (HTTP ${res.status})`, res);
  const body = await res.json(); // access_token, expires_in (3600) - best-programming-practices page
  if (!body || typeof body.access_token !== 'string' || !body.access_token) {
    throw new Error(`${STORE} token response was not understood`);
  }
  const ttl = Number(body.expires_in);
  const seconds = Number.isFinite(ttl) && ttl > 0 ? ttl : 0;
  tokenCache = { token: body.access_token, clientId, expiresAt: Date.now() + Math.max(0, seconds - 300) * 1000 };
  return tokenCache.token;
}

function toCents(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const c = Math.round(n * 100);
  return Number.isSafeInteger(c) ? c : null;
}

// source_url: the response's detailPageURL minus the affiliate tracking params it carries
// (the docs' sample shows ?tag=...&linkCode=osi). Nothing is constructed from outside the response.
function plainLink(detailUrl) {
  try {
    const u = new URL(detailUrl);
    u.searchParams.delete('tag');
    u.searchParams.delete('linkCode');
    return u.toString();
  } catch {
    return null;
  }
}

export const amazonAdapter = {
  id: 'amazon',
  requiredEnv: ['AMAZON_CREDENTIAL_ID', 'AMAZON_CREDENTIAL_SECRET', 'AMAZON_PARTNER_TAG'],
  optionalEnv: [],
  isConfigured(env) {
    return this.requiredEnv.every((k) => Boolean(env[k]));
  },
  async search(source, query, { env = process.env, fetchImpl = fetch, now = new Date(), limit = 20 } = {}) {
    const q = String(query ?? '').trim();
    if (q.length < 2) return [];
    if (!this.isConfigured(env)) throw new Error(`${STORE} is not configured`);

    const token = await getToken(env, fetchImpl);

    // Request: POST https://creatorsapi.amazon/catalog/v1/searchItems
    // Headers: Authorization: Bearer, Content-Type: application/json, x-marketplace (no version header).
    // Body: partnerTag, keywords, marketplace, itemCount (1..10), condition (Any|New),
    //       sortBy (Price:LowToHigh is a listed value), resources (search-items page)
    const cap = Math.min(10, Math.max(1, Math.floor(Number(limit)) || 10));
    const res = await fetchImpl(SEARCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-marketplace': MARKETPLACE,
      },
      body: JSON.stringify({
        partnerTag: env.AMAZON_PARTNER_TAG,
        keywords: q,
        marketplace: MARKETPLACE,
        itemCount: cap,
        condition: 'New',
        sortBy: 'Price:LowToHigh',
        resources: ['images.primary.medium', 'itemInfo.title', 'offersV2.listings.price', 'offersV2.listings.availability'],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw await failure(`${STORE} search failed (HTTP ${res.status})`, res);
    const body = await res.json();

    // Response: searchResult.items[] -> asin, detailPageURL, itemInfo.title.displayValue,
    // images.primary.medium.url, offersV2.listings[0].price.money{amount,currency},
    // .price.savingBasis{money, savingBasisType}, .availability.type (search-items + offersV2 pages)
    const items = Array.isArray(body?.searchResult?.items) ? body.searchResult.items : [];
    const out = [];
    for (const it of items) {
      if (out.length >= cap) break;
      if (!it || typeof it !== 'object' || !it.asin || typeof it.detailPageURL !== 'string') continue;
      const title = it.itemInfo?.title?.displayValue;
      if (typeof title !== 'string' || !title.trim()) continue;
      const listing = Array.isArray(it.offersV2?.listings) ? it.offersV2.listings[0] : null;
      const money = listing?.price?.money;
      if (!money || money.currency !== 'USD') continue;
      const price = toCents(money.amount);
      if (price === null) continue;
      const link = plainLink(it.detailPageURL);
      if (!link) continue;

      const rec = {
        external_id: String(it.asin),
        kind: 'deal',
        title,
        url: it.detailPageURL, // carries the partnerTag (docs sample shows ?tag=...)
        source_url: link,
        price_cents: price,
        merchant: 'Amazon',
        posted_at: now.toISOString(),
        status: 'listed',
        affiliate: true,
        stock_checked: ['IN_STOCK', 'IN_STOCK_SCARCE'].includes(listing?.availability?.type),
        category: 'Other',
      };
      // Only list/was prices count as an "original" price; LOWEST_PRICE bases are not original prices.
      const basis = listing.price.savingBasis;
      if (basis && ['LIST_PRICE', 'WAS_PRICE'].includes(basis.savingBasisType) && basis.money?.currency === 'USD') {
        const was = toCents(basis.money.amount);
        if (was !== null && was > price) rec.was_price_cents = was;
      }
      const img = it.images?.primary?.medium?.url;
      if (typeof img === 'string' && img.startsWith('https://')) rec.image_url = img;
      out.push(rec);
    }
    return out;
  },
};
