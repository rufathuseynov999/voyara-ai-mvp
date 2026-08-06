import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Phase D1 — brand asset verification.
 *
 * Confirms: the founder-approved master is preserved byte-identical; every
 * derived variant exists at the correct, previously-verified dimensions;
 * and the header component uses the compact emblem-only mark rather than
 * the full wordmark lockup (the D1 fix for the illegible-miniature-
 * wordmark defect found in both the React app and the standalone demo).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const FOUNDER_APPROVED_MASTER_SHA256 = 'b33ca6c64584ab7336c8091b9b573aa35a4949af558e38c7ddf470af7a857476';

function sha256Of(relPath: string): string {
  const buf = readFileSync(path.join(ROOT, relPath));
  return createHash('sha256').update(buf).digest('hex');
}

function pngDimensions(relPath: string): { width: number; height: number } {
  // PNG: width/height are 4-byte big-endian ints at offset 16/20 of the IHDR chunk.
  const buf = readFileSync(path.join(ROOT, relPath));
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegDimensions(relPath: string): { width: number; height: number } {
  const buf = readFileSync(path.join(ROOT, relPath));
  let offset = 2; // skip SOI marker
  while (offset < buf.length) {
    if (buf[offset] !== 0xff) { offset++; continue; }
    const marker = buf[offset + 1];
    // SOF0..SOF3 / SOF5..SOF7 / SOF9..SOF11 / SOF13..SOF15 markers carry dimensions.
    const isSOF = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isSOF) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height };
    }
    const segmentLength = buf.readUInt16BE(offset + 2);
    offset += 2 + segmentLength;
  }
  throw new Error(`could not locate SOF marker in ${relPath}`);
}

test('the founder-approved master logo is preserved byte-identical to the upload', () => {
  const actual = sha256Of('public/brand/voyara-logo-master.jpg');
  assert.equal(actual, FOUNDER_APPROVED_MASTER_SHA256, 'master logo has been altered from the founder-approved upload');
});

test('master logo file exists at the expected 1254x1254 resolution', () => {
  const dims = jpegDimensions('public/brand/voyara-logo-master.jpg');
  assert.deepEqual(dims, { width: 1254, height: 1254 });
});

test('full logo variant (emblem + wordmark) exists and preserves aspect proportions (no stretching)', () => {
  const dims = jpegDimensions('public/brand/voyara-logo.jpg');
  assert.equal(dims.width, 1034);
  assert.equal(dims.height, 865);
  // Aspect ratio sanity: width should exceed height (wordmark widens the
  // crop versus the roughly-square emblem alone) but not by an extreme,
  // stretched-looking ratio.
  const ratio = dims.width / dims.height;
  assert.ok(ratio > 1.05 && ratio < 1.35, `unexpected aspect ratio ${ratio} — possible stretching`);
});

test('compact mark variant is square (emblem only, no wordmark) — required for legible small-size rendering', () => {
  const dims = pngDimensions('public/brand/voyara-mark.png');
  assert.equal(dims.width, dims.height, 'compact mark must be square');
  assert.equal(dims.width, 658);
});

test('favicon source (icon.png) exists at 512x512', () => {
  const dims = pngDimensions('src/app/icon.png');
  assert.deepEqual(dims, { width: 512, height: 512 });
});

test('apple-icon.png exists at the standard 180x180 apple-touch-icon size', () => {
  const dims = pngDimensions('src/app/apple-icon.png');
  assert.deepEqual(dims, { width: 180, height: 180 });
});

test('opengraph-image.png exists at the standard 1200x630 social-preview size', () => {
  const dims = pngDimensions('src/app/opengraph-image.png');
  assert.deepEqual(dims, { width: 1200, height: 630 });
});

test('all brand asset files are non-trivial in size (not empty or truncated)', () => {
  for (const rel of [
    'public/brand/voyara-logo-master.jpg',
    'public/brand/voyara-logo.jpg',
    'public/brand/voyara-mark.png',
    'src/app/icon.png',
    'src/app/apple-icon.png',
    'src/app/opengraph-image.png'
  ]) {
    const size = statSync(path.join(ROOT, rel)).size;
    assert.ok(size > 5000, `${rel} is suspiciously small (${size} bytes) — possibly corrupt or truncated`);
  }
});

test('BrandMark component uses the compact mark (not the full wordmark lockup) for header rendering', () => {
  const src = readFileSync(path.join(ROOT, 'src/components/brand-mark.tsx'), 'utf8');
  assert.match(src, /voyara-mark\.png/, 'BrandMark should render the compact emblem-only mark at header scale');
  assert.doesNotMatch(src, /src="\/brand\/voyara-logo\.jpg"/, 'BrandMark should NOT set src to the full wordmark lockup at header scale (illegible at small size)');
  assert.match(src, /alt="[^"]{5,}"/, 'BrandMark must have meaningful, non-trivial alt text');
});

test('standalone generator header slot uses the compact mark placeholder, not the full-lockup placeholder', () => {
  const shell = readFileSync(path.join(ROOT, 'scripts/build-final-interactive-demo.shell.html'), 'utf8');
  assert.match(shell, /class="brand-logo" src="__MARK_DATAURI__"/, 'standalone header must use the compact mark, matching the React app fix');
});

test('standalone generator founder-section slot uses the founder asset, not the VOYARA company logo', () => {
  const shell = readFileSync(path.join(ROOT, 'scripts/build-final-interactive-demo.shell.html'), 'utf8');
  assert.match(shell, /alt="Rufat Huseynov" width="110" height="110" style="border-radius:14px">/);
  const founderImgLine = shell.split('\n').find((l) => l.includes('alt="Rufat Huseynov"'));
  assert.ok(founderImgLine, 'expected to find the founder-section image line');
  assert.match(founderImgLine as string, /__FOUNDER_DATAURI__/, 'founder section must embed the founder asset, not the VOYARA logo');
});

test('the generator embeds three distinct data URIs (logo, mark, founder), not one shared/misused source', () => {
  const src = readFileSync(path.join(ROOT, 'scripts/build-final-interactive-demo.mjs'), 'utf8');
  assert.match(src, /const LOGO_DATAURI/);
  assert.match(src, /const MARK_DATAURI/);
  assert.match(src, /const FOUNDER_DATAURI/);
});
