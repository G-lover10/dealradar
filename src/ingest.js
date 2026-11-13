import { cleanText, safeUrl, canonicalUrl, cents, isoDate } from './validate.js';

export const CATEGORIES = ['Electronics', 'Home', 'Outdoors', 'Apparel', 'Tools', 'Other'];
export const TRIP_TYPES = ['ski', 'lifts', 'beach', 'cruise', 'stays'];
const STATUSES = ['lead', 'confirmed', 'expected'];
const ELIGIBILITY = ['everyone', 'first_responder'];

/**
 * Turn one raw source record into a clean item, or return null to skip it.
 * A record needs a title, an allowed https link, a price, and a posted date.
 */
export function normalize(raw, source, now) {
  if (!raw || typeof raw !== 'object') return null;
  const allowed = source.allowed_domains ?? [];
  const title = cleanText(raw.title, 300);
  const url = safeUrl(raw.url, allowed);
  const sourceUrl = safeUrl(raw.source_url ?? raw.url, allowed);
  const price = cents(raw.price_cents);
  const postedAt = isoDate(raw.posted_at);
  const externalId = cleanText(String(raw.external_id ?? ''), 200);
  if (!title || !url || !sourceUrl || price === null || !postedAt || !externalId) return null;
  if (new Date(postedAt) > new Date(now.getTime() + 5 * 60_000)) return null; // posted in the future

  const kind = raw.kind === 'trip' ? 'trip' : 'deal';
  const was = cents(raw.was_price_cents);
  const extras = Array.isArray(raw.extra_costs) ? raw.extra_costs.slice(0, 8) : [];

  return {
    merge_key: canonicalUrl(url),
    kind,
    title,
    summary: cleanText(raw.summary, 160),
    url,
    merchant: cleanText(raw.merchant, 80),
    category: CATEGORIES.includes(raw.category) ? raw.category : 'Other',
    trip_type: kind === 'trip' && TRIP_TYPES.includes(raw.trip_type) ? raw.trip_type : null,
    was_price_cents: was !== null && was > price ? was : null,
    status: STATUSES.includes(raw.status) ? raw.status : 'lead',
    eligibility: ELIGIBILITY.includes(raw.eligibility) ? raw.eligibility : 'everyone',
    verification: cleanText(raw.verification, 120),
    extra_costs: JSON.stringify(
      extras
        .map((e) => ({ label: cleanText(e?.label, 60), amount_cents: cents(e?.amount_cents) }))
        .filter((e) => e.label),
    ),
    stock_checked: raw.stock_checked === true ? 1 : 0,
    affiliate: raw.affiliate === true ? 1 : 0,
    expires_at: isoDate(raw.expires_at),
    // Per-source fields
    external_id: externalId,
    source_url: sourceUrl,
    price_cents: price,
    posted_at: postedAt,
  };
}

/**
 * Store a batch from one source. The same offer from two sources becomes one
 * item with two source rows. Returns how many records were kept.
 */
export function storeItems(db, source, rawItems, now) {
  const stamp = now.toISOString();
  const findSource = db.prepare('SELECT item_id FROM item_sources WHERE source = ? AND external_id = ?');
  const findItem = db.prepare('SELECT id FROM items WHERE merge_key = ?');
  const insertItem = db.prepare(`INSERT INTO items
    (merge_key, kind, title, summary, url, merchant, category, trip_type, was_price_cents, status,
     eligibility, verification, extra_costs, stock_checked, affiliate, expires_at, first_seen, last_seen)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const touchItem = db.prepare('UPDATE items SET last_seen = ?, expires_at = COALESCE(?, expires_at) WHERE id = ?');
  const upsertSource = db.prepare(`INSERT INTO item_sources
    (item_id, source, source_name, external_id, source_url, price_cents, posted_at, fetched_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT (source, external_id) DO UPDATE SET
      source_url = excluded.source_url, price_cents = excluded.price_cents,
      posted_at = excluded.posted_at, fetched_at = excluded.fetched_at`);

  let kept = 0;
  db.exec('BEGIN');
  try {
    for (const raw of rawItems) {
      const item = normalize(raw, source, now);
      if (!item) continue;
      let itemId = findSource.get(source.id, item.external_id)?.item_id ?? findItem.get(item.merge_key)?.id;
      if (itemId) {
        touchItem.run(stamp, item.expires_at, itemId);
      } else {
        itemId = Number(
          insertItem.run(
            item.merge_key, item.kind, item.title, item.summary, item.url, item.merchant, item.category,
            item.trip_type, item.was_price_cents, item.status, item.eligibility, item.verification,
            item.extra_costs, item.stock_checked, item.affiliate, item.expires_at, stamp, stamp,
          ).lastInsertRowid,
        );
      }
      upsertSource.run(itemId, source.id, source.name, item.external_id, item.source_url, item.price_cents, item.posted_at, stamp);
      kept += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return kept;
}

/**
 * Fetch every enabled source. One failing source is recorded and skipped;
 * it never clears or blocks the others.
 */
export async function refreshAll(db, config, adapters, now, { timeoutMs = 25_000 } = {}) {
  const logRun = db.prepare('INSERT INTO fetch_runs (source, started_at, ok, item_count, error) VALUES (?,?,?,?,?)');
  const results = [];
  for (const source of config.sources.filter((s) => s.enabled)) {
    const started = now.toISOString();
    try {
      const adapter = adapters[source.adapter];
      if (!adapter) throw new Error(`No adapter named "${source.adapter}"`);
      const raw = await withTimeout(adapter.fetchItems(source), timeoutMs);
      if (!Array.isArray(raw)) throw new Error('Source did not return a list');
      const count = storeItems(db, source, raw.slice(0, config.max_items_per_fetch ?? 200), now);
      logRun.run(source.id, started, 1, count, '');
      results.push({ source: source.id, ok: true, count });
    } catch (err) {
      const message = cleanText(String(err?.message ?? err), 200);
      logRun.run(source.id, started, 0, 0, message);
      results.push({ source: source.id, ok: false, error: message });
    }
  }
  return results;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}
