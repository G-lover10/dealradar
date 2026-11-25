import { normalize, withTimeout } from './ingest.js';
import { cleanText } from './validate.js';
import { listItems, presentLive } from './present.js';

/**
 * Product search across posted listings and the stores' official search APIs.
 *
 * - A store that fails or is not connected never hides the other results.
 * - Results are kept in memory for a few minutes per store (cache_minutes in
 *   config) so repeat searches do not call the store again. Nothing from a
 *   store API is written to the database.
 * - A simple per-minute cap protects the stores' rate limits.
 */
export function createSearch({ db, config, adapters, env = {}, now = () => new Date(), fetchImpl = fetch }) {
  const cache = new Map();
  const perMinute = config.live_searches_per_minute ?? 30;
  let recent = [];

  function liveSources() {
    return config.sources.filter((s) => s.enabled && s.live);
  }
  function isConnected(source) {
    const adapter = adapters[source.adapter];
    return Boolean(adapter?.search && adapter.isConfigured?.(env));
  }

  async function search(rawQuery, kind = 'deal') {
    const query = cleanText(String(rawQuery ?? ''), 80).toLowerCase();
    const result = { query, as_of: now().toISOString(), items: [], searched: [], failed: [], not_connected: [], limited: false };
    if (query.length < 2) return result;

    const words = query.split(' ');
    const posted = listItems(db, kind, now()).filter((item) => {
      const hay = `${item.title} ${item.summary} ${item.merchant}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });

    const live = [];
    if (kind === 'deal') {
      await Promise.all(
        liveSources().map(async (source) => {
          if (!isConnected(source)) {
            result.not_connected.push(source.name);
            return;
          }
          const key = `${source.id}|${query}`;
          const ttl = (source.cache_minutes ?? 10) * 60_000;
          let hit = cache.get(key);
          if (!hit || now().getTime() - hit.at > ttl) {
            const t = now().getTime();
            recent = recent.filter((x) => t - x < 60_000);
            if (recent.length >= perMinute) {
              result.limited = true;
              return;
            }
            recent.push(t);
            try {
              const raw = await withTimeout(
                adapters[source.adapter].search(source, query, { env, fetchImpl, now: now(), limit: source.limit ?? 20 }),
                20_000,
              );
              if (!Array.isArray(raw)) throw new Error('Store did not return a list');
              const items = raw
                .map((r) => normalize({ ...r, kind: 'deal' }, source, now()))
                .filter(Boolean)
                .map((n) => presentLive(n, source, now()));
              hit = { at: t, items };
              cache.set(key, hit);
              if (cache.size > 300) cache.delete(cache.keys().next().value);
            } catch (err) {
              result.failed.push(source.name);
              console.error(`[search] ${source.id}: ${cleanText(String(err?.message ?? err), 200)}`);
              return;
            }
          }
          result.searched.push(source.name);
          live.push(...hit.items);
        }),
      );
    }

    result.items = [...posted, ...live].sort((a, b) => a.price_cents - b.price_cents);
    return result;
  }

  return { search, liveSources, isConnected };
}
