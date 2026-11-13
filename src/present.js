// Turns stored rows into what a card shows. All trust wording lives here so
// the rules ("a lead is not a confirmed price") are in one tested place.

const TRUST = {
  lead: { label: 'Lead', note: 'Posted price, not checked at checkout.' },
  confirmed: { label: 'Confirmed', note: 'Confirmed by the seller.' },
  expected: { label: 'Expected', note: 'Announced or rumoured. Not live yet.' },
};

export function isExpired(item, now) {
  return item.expires_at != null && new Date(item.expires_at) <= now;
}

export function ageLabel(postedAt, now) {
  const mins = Math.max(0, Math.floor((now - new Date(postedAt)) / 60_000));
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/** Build the public shape of one item from its row and its source rows. */
export function present(item, sources, now) {
  const sorted = [...sources].sort((a, b) => a.price_cents - b.price_cents || a.posted_at.localeCompare(b.posted_at));
  const best = sorted[0];
  const extras = JSON.parse(item.extra_costs || '[]');
  const known = extras.filter((e) => e.amount_cents != null);
  const hasUnknown = extras.some((e) => e.amount_cents == null);
  const price = best.price_cents;
  const was = item.was_price_cents != null && item.was_price_cents > price ? item.was_price_cents : null;
  const trust = TRUST[item.status] ?? TRUST.lead;

  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    url: item.url,
    merchant: item.merchant,
    category: item.category,
    trip_type: item.trip_type,
    price_cents: price,
    was_price_cents: was,
    // Always relative to the seller's own "was" price, which is often inflated.
    percent_off_stated: was ? Math.round((1 - price / was) * 100) : null,
    extra_costs: extras,
    all_in_cents: known.length ? price + known.reduce((sum, e) => sum + e.amount_cents, 0) : null,
    has_unknown_costs: hasUnknown,
    trust: { status: item.status in TRUST ? item.status : 'lead', label: trust.label, note: trust.note },
    eligibility: item.eligibility,
    verification: item.verification,
    stock_checked: Boolean(item.stock_checked),
    affiliate: Boolean(item.affiliate),
    posted_at: best.posted_at,
    age: ageLabel(best.posted_at, now),
    expires_at: item.expires_at,
    cart_warning: item.kind === 'trip' ? 'The price can change in the cart. Open the link before you pay.' : null,
    sources: sorted.map((s) => ({
      name: s.source_name,
      url: s.source_url,
      price_cents: s.price_cents,
      posted_at: s.posted_at,
      age: ageLabel(s.posted_at, now),
    })),
  };
}

/** Every live item of one kind, lowest posted price first. */
export function listItems(db, kind, now) {
  const items = db.prepare('SELECT * FROM items WHERE kind = ?').all(kind);
  const sourceRows = db.prepare(
    'SELECT s.* FROM item_sources s JOIN items i ON i.id = s.item_id WHERE i.kind = ?',
  ).all(kind);
  const byItem = new Map();
  for (const row of sourceRows) {
    if (!byItem.has(row.item_id)) byItem.set(row.item_id, []);
    byItem.get(row.item_id).push(row);
  }
  return items
    .filter((item) => !isExpired(item, now) && byItem.has(item.id))
    .map((item) => present(item, byItem.get(item.id), now))
    .sort((a, b) => a.price_cents - b.price_cents || b.posted_at.localeCompare(a.posted_at));
}

/** Latest fetch result for each configured source. */
export function sourceStatus(db, config) {
  const latest = db.prepare('SELECT * FROM fetch_runs WHERE source = ? ORDER BY id DESC LIMIT 1');
  return config.sources.map((s) => {
    const run = latest.get(s.id);
    return {
      id: s.id,
      name: s.name,
      enabled: Boolean(s.enabled),
      sample: Boolean(s.sample),
      last_fetch: run?.started_at ?? null,
      ok: run ? Boolean(run.ok) : null,
      item_count: run?.item_count ?? 0,
      error: run?.error ?? '',
    };
  });
}
