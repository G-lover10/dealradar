import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { refreshAll } from './ingest.js';
import { listItems, sourceStatus } from './present.js';
import { fixtureAdapter } from './adapters/fixture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/** Build the request handler. Everything it needs is passed in, so tests can drive it. */
export function createApp({ db, config, adapters, now = () => new Date() }) {
  const cooldownMs = (config.refresh_cooldown_seconds ?? 60) * 1000;
  let lastRefresh = 0;
  let refreshing = null;

  async function refresh() {
    refreshing ??= refreshAll(db, config, adapters, now()).finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  function send(res, status, body, headers = {}) {
    const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...headers,
    });
    res.end(payload);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/items' && req.method === 'GET') {
        const kind = url.searchParams.get('kind') === 'trip' ? 'trip' : 'deal';
        return send(res, 200, { as_of: now().toISOString(), items: listItems(db, kind, now()) });
      }
      if (url.pathname === '/api/status' && req.method === 'GET') {
        const sources = sourceStatus(db, config);
        const enabled = sources.filter((s) => s.enabled);
        return send(res, 200, {
          as_of: now().toISOString(),
          sample_only: enabled.length > 0 && enabled.every((s) => s.sample),
          sources,
        });
      }
      if (url.pathname === '/api/refresh' && req.method === 'POST') {
        const wait = lastRefresh + cooldownMs - now().getTime();
        if (wait > 0) {
          const seconds = Math.ceil(wait / 1000);
          return send(res, 429, { error: `Refreshed a moment ago. Try again in ${seconds}s.` }, { 'Retry-After': String(seconds) });
        }
        lastRefresh = now().getTime();
        return send(res, 200, { results: await refresh() });
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });

      let rel;
      try {
        rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      } catch {
        return send(res, 404, { error: 'Not found' }); // malformed escape such as /%zz
      }
      const file = path.resolve(PUBLIC, rel);
      if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, { error: 'Not found' });
      const type = TYPES[path.extname(file)];
      if (!type) return send(res, 404, { error: 'Not found' });
      const data = await readFile(file);
      return send(res, 200, req.method === 'HEAD' ? '' : data, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    } catch (err) {
      if (err?.code === 'ENOENT' || err?.code === 'EISDIR') return send(res, 404, { error: 'Not found' });
      console.error(err);
      return send(res, 500, { error: 'Something went wrong on the server.' });
    }
  }

  return { handle, refresh };
}

async function main() {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 8080);
  const config = JSON.parse(await readFile(path.join(ROOT, 'config/sources.json'), 'utf8'));
  let dbPath = ':memory:';
  if (process.env.DB_PATH) {
    dbPath = path.resolve(ROOT, process.env.DB_PATH);
    await mkdir(path.dirname(dbPath), { recursive: true });
  }
  const db = openDb(dbPath);
  const app = createApp({ db, config, adapters: { fixture: fixtureAdapter } });

  await app.refresh();
  setInterval(() => app.refresh().catch(console.error), (config.fetch_interval_minutes ?? 120) * 60_000).unref();

  http.createServer(app.handle).listen(port, host, () => {
    console.log(`DealRadar is running at http://${host}:${port}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
