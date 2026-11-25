// eBay Browse API search adapter (official API only, no scraping).
// Docs:
//   Search method:   https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
//   Token (client credentials): https://developer.ebay.com/api-docs/static/oauth-client-credentials-grant.html
//   Filter syntax:   https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html
//   Affiliate header: https://developer.ebay.com/api-docs/buy/static/api-browse.html
//   Display rules:   https://developer.ebay.com/api-docs/buy/static/buy-requirements.html

const STORE = 'eBay';
const SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';
const TIMEOUT_MS = 15000;

let tokenCache = null; // { token, expiresAt, clientId }

export function _resetTokenCache() {
  tokenCache = null;
}

function httpError(message, res) {
  const err = new Error(message);
  err.status = res.status;
  if (res.status === 429) {
    const raw = res.headers?.get?.('retry-after');
    const ra = raw ? Number(raw) : NaN;
    err.retryAfter = Number.isFinite(ra) && ra >= 0 ? ra : null;
  }
  return err;
}

async function getToken(env, fetchImpl) {
  const clientId = env.EBAY_CLIENT_ID;
  if (tokenCache && tokenCache.clientId === clientId && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  // Request: POST /identity/v1/oauth2/token, Basic auth of client_id:client_secret,
  // form body grant_type=client_credentials & scope (oauth-client-credentials-grant.html)
  const basic = Buffer.from(`${clientId}:${env.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw httpError(`${STORE} token request failed (HTTP ${res.status})`, res);
  // Response fields: access_token, expires_in (seconds) (same doc page)
  const body = await res.json();
  if (!body || typeof body.access_token !== 'string' || !body.access_token) {
    throw new Error(`${STORE} token response was not understood`);
  }
  const ttl = Number(body.expires_in);
  const seconds = Number.isFinite(ttl) && ttl > 0 ? ttl : 0;
  // Reuse until 5 minutes before expiry.
  tokenCache = { token: body.access_token, clientId, expiresAt: Date.now() + Math.max(0, seconds - 300) * 1000 };
  return tokenCache.token;
}

function toCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const c = Math.round(n * 100);
  return Number.isSafeInteger(c) ? c : null;
}

// Shipping: itemSummaries[].shippingOptions[].shippingCost.value/currency and .shippingCostType
// (FIXED or CALCULATED) - search method page.
function shippingExtra(options) {
  if (!Array.isArray(options) || options.length === 0) return null;
  const costs = [];
  let calculated = false;
  for (const o of options) {
    const sc = o?.shippingCost;
    if (sc && sc.currency === 'USD') {
      const n = Number(sc.value);
      if (Number.isFinite(n) && n >= 0) costs.push(Math.round(n * 100));
    } else if (o?.shippingCostType === 'CALCULATED') {
      calculated = true;
    }
  }
  if (costs.length) {
    const min = Math.min(...costs);
    return min > 0 ? [{ label: 'Shipping', amount_cents: min }] : null; // free shipping -> omit
  }
  return calculated ? [{ label: 'Shipping', amount_cents: null }] : null;
}

function httpsOrUndefined(u) {
  return typeof u === 'string' && u.startsWith('https://') ? u : undefined;
}

export const ebayAdapter = {
  id: 'ebay',
  requiredEnv: ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET'],
  optionalEnv: ['EBAY_CAMPAIGN_ID', 'EBAY_MARKETPLACE'],
  isConfigured(env) {
    return this.requiredEnv.every((k) => Boolean(env[k]));
  },
  async search(source, query, { env = process.env, fetchImpl = fetch, now = new Date(), limit = 20 } = {}) {
    const q = String(query ?? '').trim();
    if (q.length < 2) return [];
    if (!this.isConfigured(env)) throw new Error(`${STORE} is not configured`);

    const token = await getToken(env, fetchImpl);

    // Request: GET /buy/browse/v1/item_summary/search?q=...&limit=...&filter=...&sort=price
    //  - q, limit (1..200), sort=price (ascending total cost), filter syntax conditions:{NEW},
    //    buyingOptions:{FIXED_PRICE}: search method page + ref-buy-browse-filters.html
    const cap = Math.min(200, Math.max(1, Math.floor(Number(limit)) || 20));
    const url = new URL(SEARCH_URL);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', String(cap));
    url.searchParams.set('filter', 'conditions:{NEW},buyingOptions:{FIXED_PRICE}');
    url.searchParams.set('sort', 'price');

    // Headers: Authorization, X-EBAY-C-MARKETPLACE-ID (default EBAY_US), and
    // X-EBAY-C-ENDUSERCTX: affiliateCampaignId=<id> to receive itemAffiliateWebUrl (api-browse.html)
    const headers = {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': env.EBAY_MARKETPLACE || 'EBAY_US',
    };
    const campaign = env.EBAY_CAMPAIGN_ID ? String(env.EBAY_CAMPAIGN_ID).trim() : '';
    if (campaign) headers['X-EBAY-C-ENDUSERCTX'] = `affiliateCampaignId=${campaign}`;

    const res = await fetchImpl(url.toString(), { method: 'GET', headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw httpError(`${STORE} search failed (HTTP ${res.status})`, res);
    const body = await res.json();

    // Response: itemSummaries[] with itemId, title, price.value/currency, image.imageUrl,
    // itemWebUrl, itemAffiliateWebUrl, seller.username, marketingPrice.originalPrice.value/currency,
    // shippingOptions[] (search method page)
    const list = Array.isArray(body?.itemSummaries) ? body.itemSummaries : [];
    const out = [];
    for (const it of list) {
      if (out.length >= cap) break;
      if (!it || typeof it !== 'object') continue;
      const id = it.itemId;
      const title = it.title;
      const webUrl = it.itemWebUrl;
      if (!id || typeof title !== 'string' || !title.trim() || typeof webUrl !== 'string') continue;
      if (it.price?.currency !== 'USD') continue;
      const price = toCents(it.price.value);
      if (price === null) continue;

      const useAffiliate = Boolean(campaign) && typeof it.itemAffiliateWebUrl === 'string' && it.itemAffiliateWebUrl;
      const rec = {
        external_id: String(id),
        kind: 'deal',
        title,
        url: useAffiliate ? it.itemAffiliateWebUrl : webUrl,
        source_url: webUrl,
        price_cents: price,
        merchant: typeof it.seller?.username === 'string' && it.seller.username ? `eBay · ${it.seller.username}` : 'eBay',
        posted_at: now.toISOString(),
        status: 'listed',
        affiliate: Boolean(useAffiliate),
        stock_checked: false, // search method page does not state availability fields
        category: 'Other',
      };
      const orig = it.marketingPrice?.originalPrice;
      if (orig?.currency === 'USD') {
        const was = toCents(orig.value);
        if (was !== null && was > price) rec.was_price_cents = was;
      }
      const img = httpsOrUndefined(it.image?.imageUrl);
      if (img) rec.image_url = img;
      const extra = shippingExtra(it.shippingOptions);
      if (extra) rec.extra_costs = extra;
      out.push(rec);
    }
    return out;
  },
};
