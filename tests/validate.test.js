import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, safeUrl, canonicalUrl } from '../src/validate.js';

const ALLOWED = ['example.com'];

test('cleanText strips HTML tags', () => {
  assert.equal(cleanText('<b>Big</b> <script>alert(1)</script>sale', 100), 'Big alert(1) sale');
});

test('cleanText caps length', () => {
  const out = cleanText('a'.repeat(50), 10);
  assert.equal(out.length, 10);
  assert.ok(out.endsWith('…'));
});

test('cleanText returns empty string for non-strings', () => {
  assert.equal(cleanText(null, 10), '');
  assert.equal(cleanText(42, 10), '');
});

test('safeUrl accepts https on an allowed domain', () => {
  assert.equal(safeUrl('https://shop.example.com/a', ALLOWED), 'https://shop.example.com/a');
});

test('safeUrl rejects http', () => {
  assert.equal(safeUrl('http://shop.example.com/a', ALLOWED), null);
});

test('safeUrl rejects embedded credentials', () => {
  assert.equal(safeUrl('https://user:pass@shop.example.com/x', ALLOWED), null);
  assert.equal(safeUrl('https://user@shop.example.com/x', ALLOWED), null);
});

test('safeUrl rejects a domain not on the list', () => {
  assert.equal(safeUrl('https://other.test/x', ALLOWED), null);
});

test('safeUrl rejects look-alike domains', () => {
  assert.equal(safeUrl('https://example.com.evil.test/x', ALLOWED), null);
  assert.equal(safeUrl('https://notexample.com/x', ALLOWED), null);
});

test('safeUrl accepts a subdomain of an allowed domain and the bare domain', () => {
  assert.ok(safeUrl('https://deep.sub.example.com/x', ALLOWED));
  assert.ok(safeUrl('https://example.com/x', ALLOWED));
});

test('safeUrl rejects garbage and non-web schemes', () => {
  assert.equal(safeUrl('not a url', ALLOWED), null);
  assert.equal(safeUrl('javascript:alert(1)', ALLOWED), null);
});

test('canonicalUrl ignores utm_ parameters', () => {
  assert.equal(
    canonicalUrl('https://shop.example.com/a?utm_source=x&utm_medium=y'),
    canonicalUrl('https://shop.example.com/a'),
  );
});

test('canonicalUrl ignores www.', () => {
  assert.equal(canonicalUrl('https://www.shop.example.com/a'), canonicalUrl('https://shop.example.com/a'));
});

test('canonicalUrl ignores a trailing slash', () => {
  assert.equal(canonicalUrl('https://shop.example.com/a/'), canonicalUrl('https://shop.example.com/a'));
});

test('canonicalUrl keeps meaningful parameters', () => {
  assert.notEqual(canonicalUrl('https://shop.example.com/a?id=1'), canonicalUrl('https://shop.example.com/a?id=2'));
});
