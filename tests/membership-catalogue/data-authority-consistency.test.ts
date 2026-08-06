import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  STEPS_BY_LOCALE as JOURNEY_STEPS_BY_LOCALE,
  JOURNEY_TITLE,
  OPERATING_PRINCIPLE
} from '@/lib/member-value-journey-data';
import {
  AGENTS_BY_LOCALE,
  STATUS_LABEL
} from '@/lib/ai-agent-membership-data';
import {
  PERSONAL_ROWS,
  CORPORATE_ROWS,
  HEADER_TEXT as COMPARISON_HEADER_TEXT
} from '@/lib/membership-comparison-data';

/**
 * Phase C7.2 — proves there is exactly ONE copy of each data authority,
 * and that both consumers (the React components and the standalone HTML
 * export bridge) import from that single module rather than each
 * maintaining its own duplicate.
 *
 * This is a structural/source-scan test, not a rendering test — its job is
 * to catch future drift (someone adding a second hand-written copy) before
 * it ships, which a rendering-only test could miss if both copies happened
 * to agree at the time the test was written.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function readSource(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('member-value-journey.tsx imports its content from the shared data module (does not redeclare it)', () => {
  const componentSrc = readSource('src/components/member-value-journey.tsx');
  assert.match(componentSrc, /from ['"]@\/lib\/member-value-journey-data['"]/);
  // The component file itself must not redeclare the step content arrays.
  assert.doesNotMatch(componentSrc, /const AZ_STEPS/);
  assert.doesNotMatch(componentSrc, /const RU_STEPS/);
  assert.doesNotMatch(componentSrc, /const EN_STEPS/);
});

test('ai-agent-membership-section.tsx imports its content from the shared data module (does not redeclare it)', () => {
  const componentSrc = readSource('src/components/ai-agent-membership-section.tsx');
  assert.match(componentSrc, /from ['"]@\/lib\/ai-agent-membership-data['"]/);
  assert.doesNotMatch(componentSrc, /const AZ_AGENTS/);
  assert.doesNotMatch(componentSrc, /const RU_AGENTS/);
  assert.doesNotMatch(componentSrc, /const EN_AGENTS/);
});

test('membership-comparison.tsx imports its row definitions from the shared data module (does not redeclare them)', () => {
  const componentSrc = readSource('src/components/membership-comparison.tsx');
  assert.match(componentSrc, /from ['"]@\/lib\/membership-comparison-data['"]/);
  assert.doesNotMatch(componentSrc, /const PERSONAL_ROWS/);
  assert.doesNotMatch(componentSrc, /const CORPORATE_ROWS/);
});

test('the export bridge script imports from the same shared data modules as the React components, not a separate copy', () => {
  const bridgeSrc = readSource('scripts/export-membership-catalogue.ts');
  assert.match(bridgeSrc, /from ['"]\.\.\/src\/lib\/member-value-journey-data['"]/);
  assert.match(bridgeSrc, /from ['"]\.\.\/src\/lib\/ai-agent-membership-data['"]/);
  assert.match(bridgeSrc, /from ['"]\.\.\/src\/lib\/membership-comparison-data['"]/);
});

test('journey data authority: exactly one array of 8 steps per locale, shared by both consumers', () => {
  for (const locale of ['az', 'ru', 'en'] as const) {
    assert.equal(JOURNEY_STEPS_BY_LOCALE[locale].length, 8);
  }
});

test('agent data authority: exactly one array of 8 agents per locale, shared by both consumers', () => {
  for (const locale of ['az', 'ru', 'en'] as const) {
    assert.equal(AGENTS_BY_LOCALE[locale].length, 8);
  }
});

test('comparison data authority: row definitions are non-empty and shared by both consumers', () => {
  assert.ok(PERSONAL_ROWS.length > 0);
  assert.ok(CORPORATE_ROWS.length > 0);
});

test('journey title and operating principle are defined for all three locales in the single authority', () => {
  for (const locale of ['az', 'ru', 'en'] as const) {
    assert.ok(JOURNEY_TITLE[locale].length > 0);
    assert.ok(OPERATING_PRINCIPLE[locale].length > 0);
  }
});

test('agent status labels and comparison headers are defined for all three locales in the single authority', () => {
  for (const locale of ['az', 'ru', 'en'] as const) {
    assert.ok(Object.keys(STATUS_LABEL[locale]).length === 6);
    assert.ok(COMPARISON_HEADER_TEXT[locale].personalTitle.length > 0);
    assert.ok(COMPARISON_HEADER_TEXT[locale].corporateTitle.length > 0);
  }
});
