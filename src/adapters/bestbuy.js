// Best Buy Products API search adapter (official API only, no scraping).
// Docs: https://bestbuyapis.github.io/api-documentation/  (Products API: base URL, search syntax,
//       apiKey, format, show, pageSize, attribute tables)
// Terms: https://developer.bestbuy.com/legal

const STORE = 'Best Buy';
const BASE = 'https://api.bestbuy.com/v1/products';
const TIMEOUT_MS = 15000;
// show= limits returned attributes (docs). Every name below is in the Products API attribute tables.
const SHOW = 'sku,name,salePrice,regularPrice,onSale,url,image,onlineAvailability,shippingCost,freeShipping';

function toCents(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const c = Math.round(n * 100);
  return Number.isSafeInteger(c) ? c : null;
}

export const bestbuyAdapter = {
  id: 'bestbuy',
  requiredEnv: ['BESTBUY_API_KEY'],
  optionalEnv: [],
  isConfigured(env) {
    return this.requiredEnv.every((k) => Boolean(env[k]));
  },
  async search(source, query, { env = process.env, fetchImpl = fetch, now = new Date(), limit = 20 } = {}) {
    const q = String(query ?? '').trim();
    if (q.length < 2) return [];
    if (!this.isConfigured(env)) throw new Error(`${STORE} is not configured`);

    // Keyword search: products(search=word1&search=word2) - "include an & between the words";
    // the docs show no URL-encoding rules, so only letters and digits are kept (this also keeps
    // the characters ( ) & | = * out of the criteria). Docs: leading wildcard gives a 400.
    const words = q.split(/[^A-Za-z0-9]+/).filter(Boolean).slice(0, 8);
    if (words.length === 0) return [];
    const criteria = words.map((w) => `search=${w}`).join('&');

    // Query parameters apiKey, format=json, show, pageSize (up to 100) per the Products API docs.
    const cap = Math.min(100, Math.max(1, Math.floor(Number(limit)) || 20));
    const params = new URLSearchParams({
      apiKey: env.BESTBUY_API_KEY,
      format: 'json',
      show: SHOW,
      pageSize: String(cap),
    });
    const url = `${BASE}(${criteria})?${params.toString().replace(/%2C/g, ',')}`;

    const res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      const err = new Error(`${STORE} search failed (HTTP ${res.status})`);
      err.status = res.status;
      if (res.status === 429) {
        const raw = res.headers?.get?.('retry-after');
        const ra = raw ? Number(raw) : NaN;
        err.retryAfter = Number.isFinite(ra) && ra >= 0 ? ra : null;
      }
      throw err;
    }
    const body = await res.json();

    // Response: top-level products[]; per product sku, name, salePrice ("Current item selling price"),
    // regularPrice, url, image, onlineAvailability, shippingCost, freeShipping (attribute tables, same doc)
    const list = Array.isArray(body?.products) ? body.products : [];
    const out = [];
    for (const p of list) {
      if (out.length >= cap) break;
      if (!p || typeof p !== 'object') continue;
      if (p.sku === undefined || p.sku === null || typeof p.name !== 'string' || !p.name.trim()) continue;
      if (typeof p.url !== 'string') continue;
      const price = toCents(p.salePrice);
      if (price === null) continue;
      if (p.onlineAvailability === false) continue; // cannot be bought online
      const rec = {
        external_id: String(p.sku),
        kind: 'deal',
        title: p.name,
        url: p.url,
        source_url: p.url,
        price_cents: price,
        merchant: 'Best Buy',
        posted_at: now.toISOString(),
        status: 'listed',
        affiliate: false, // affiliateUrl needs an Impact Partner ID whose parameter name the docs do not give
        stock_checked: p.onlineAvailability === true,
        category: 'Other',
      };
      const was = toCents(p.regularPrice);
      if (was !== null && was > price) rec.was_price_cents = was;
      if (typeof p.image === 'string' && p.image.startsWith('https://')) rec.image_url = p.image;
      const ship = Number(p.shippingCost);
      if (p.freeShipping !== true && Number.isFinite(ship) && ship > 0) {
        rec.extra_costs = [{ label: 'Shipping', amount_cents: Math.round(ship * 100) }];
      }
      out.push(rec);
    }
    return out;
  },
};
