// Input cleaning. Nothing from a source is trusted or rendered as HTML.

const TRACKING = /^(utm_|ref$|ref_|tag$|aff$|affid$|aff_|affiliate|clickid$|gclid$|fbclid$|sid$|subid$)/i;

/** Strip tags and control characters, collapse spaces, and cap the length. */
export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

/** Return a safe https URL string, or null when the link is not allowed. */
export function safeUrl(value, allowedDomains) {
  let u;
  try {
    u = new URL(String(value));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const ok = allowedDomains.some((d) => host === d || host.endsWith('.' + d));
  return ok ? u.toString() : null;
}

/** A stable key for "the same offer", ignoring tracking parameters. */
export function canonicalUrl(value) {
  const u = new URL(value);
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.map(([k, v]) => `${k}=${v}`).join('&');
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.replace(/\/+$/, '') || '/';
  return host + path + (query ? '?' + query : '');
}

/** Whole cents from a number of cents, or null when it is not a sane price. */
export function cents(value) {
  return Number.isInteger(value) && value >= 0 && value < 100_000_000 ? value : null;
}

/** ISO string from a date-like value, or null. */
export function isoDate(value) {
  if (value == null) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
