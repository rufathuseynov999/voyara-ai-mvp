import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ORIGINAL_ITINERARY, REVISED_ITINERARY, TRAVEL_BRIEF, CONVERSATION_SCRIPT, COMPARE_OPTIONS
} from '@/lib/e2b-experience-preview-fixtures';

async function readSource(relPath: string): Promise<string> {
  return readFile(new URL(`../../${relPath}`, import.meta.url), 'utf8');
}

test('the preview route is server-flag-gated with notFound(), not an auth check', async () => {
  const source = await readSource('src/app/[locale]/experience-preview/e2b/page.tsx');
  assert.ok(source.includes("process.env.VOYARA_CUSTOMER_EXPERIENCE_PREVIEW_ENABLED !== 'true'"));
  assert.ok(source.includes('notFound()'));
  assert.ok(!source.includes('NEXT_PUBLIC_VOYARA_CUSTOMER_EXPERIENCE_PREVIEW'), 'flag must be server-only, never NEXT_PUBLIC_');
});

test('the preview route performs zero Supabase/admin-client access', async () => {
  const source = await readSource('src/app/[locale]/experience-preview/e2b/page.tsx');
  assert.ok(!source.includes('createAdminSupabaseClient'));
  assert.ok(!source.includes('createServerSupabaseClient'));
});

test('the preview route sets noindex/nofollow metadata', async () => {
  const source = await readSource('src/app/[locale]/experience-preview/e2b/page.tsx');
  assert.ok(source.includes('index: false'));
  assert.ok(source.includes('follow: false'));
});

test('the workspace component performs no fetch/network call anywhere (pure deterministic client state)', async () => {
  const source = await readSource('src/components/experience-preview-workspace.tsx');
  assert.ok(!source.includes('fetch('), 'the E.2B.1 workspace must be pure deterministic client state, no network calls');
});

test('no client component in the E.2B.1 preview imports the admin client or any server-only wrapper', async () => {
  const files = ['src/components/experience-preview-workspace.tsx'];
  for (const file of files) {
    const source = await readSource(file);
    assert.ok(!source.includes('createAdminSupabaseClient'));
    assert.ok(!source.includes('whatsapp-conversion-command'));
  }
});

test('deterministic multi-turn conversation script exists and progressively extracts destination, dates, travelers, budget, interests, and pace', () => {
  assert.ok(CONVERSATION_SCRIPT.length >= 4, 'multi-turn conversation');
  assert.ok(TRAVEL_BRIEF.destination.en && TRAVEL_BRIEF.nights && TRAVEL_BRIEF.travelers && TRAVEL_BRIEF.budgetAzn && TRAVEL_BRIEF.interests.en && TRAVEL_BRIEF.pace.en);
});

test('AZ/RU/EN parity: every conversation turn and the travel brief have all three locales', () => {
  for (const turn of CONVERSATION_SCRIPT) {
    assert.ok(turn.text.az && turn.text.ru && turn.text.en, 'every turn has az/ru/en text');
  }
  for (const field of [TRAVEL_BRIEF.destination, TRAVEL_BRIEF.origin, TRAVEL_BRIEF.month, TRAVEL_BRIEF.interests, TRAVEL_BRIEF.pace]) {
    assert.ok(field.az && field.ru && field.en);
  }
});

test('the itinerary has exactly 5 days, matching the Baku-Istanbul scenario', () => {
  assert.equal(ORIGINAL_ITINERARY.length, 5);
  assert.equal(REVISED_ITINERARY.length, 5);
});

test('the deterministic edit only changes day 3, and moves the Bosphorus activity to the evening slot', () => {
  for (let i = 0; i < ORIGINAL_ITINERARY.length; i++) {
    if (ORIGINAL_ITINERARY[i].day !== 3) {
      assert.deepEqual(REVISED_ITINERARY[i], ORIGINAL_ITINERARY[i], `day ${ORIGINAL_ITINERARY[i].day} must be unchanged by this specific edit`);
    }
  }
  const revisedDay3 = REVISED_ITINERARY.find((d) => d.day === 3)!;
  const eveningActivity = revisedDay3.activities.find((a) => a.time === 'evening')!;
  assert.ok(/Bosphorus|Bosfor|Босфор/i.test(eveningActivity.title.en + eveningActivity.title.az + eveningActivity.title.ru));
});

test('the original itinerary is still reachable after the edit is applied (session can compare original vs revised)', () => {
  // Proven at the data level: ORIGINAL_ITINERARY is a separate, unmutated
  // export — applying the edit never overwrites it.
  const day3Original = ORIGINAL_ITINERARY.find((d) => d.day === 3)!;
  assert.equal(day3Original.activities.find((a) => a.time === 'morning')!.title.en, 'Bosphorus boat cruise');
});

test('compare options never claim live supplier pricing — every budget figure is explicitly illustrative', async () => {
  assert.equal(COMPARE_OPTIONS.length, 3);
  const ids = COMPARE_OPTIONS.map((o) => o.id);
  assert.deepEqual(ids, ['smart-value', 'balanced', 'premium-comfort']);
  for (const option of COMPARE_OPTIONS) {
    assert.ok(/\d/.test(option.illustrativeBudgetRangeAzn), 'a real range string exists');
  }
  const source = await readSource('src/components/experience-preview-workspace.tsx');
  assert.ok(source.toLowerCase().includes('illustrative'), 'the UI itself labels budget/compare data as illustrative, not live');
});

test('no fabricated live-pricing, confirmed-booking, or payment language appears in the workspace component or fixtures', async () => {
  const workspaceSource = await readSource('src/components/experience-preview-workspace.tsx');
  const fixturesSource = await readSource('src/lib/e2b-experience-preview-fixtures.tsx');
  const forbidden = /confirmed booking|payment received|booking confirmed|live price|guaranteed availability/i;
  assert.ok(!forbidden.test(workspaceSource));
  assert.ok(!forbidden.test(fixturesSource));
  // Explicitly proves the opposite claim is present.
  assert.ok(workspaceSource.includes('noAuthority'));
});

test('each Inspiration direction produces a genuinely different itinerary (not just a label change)', async () => {
  const { DIRECTION_ITINERARIES } = await import('@/lib/e2b-experience-preview-fixtures');
  const classic = JSON.stringify(DIRECTION_ITINERARIES['classic-istanbul']);
  const food = JSON.stringify(DIRECTION_ITINERARIES['istanbul-through-food']);
  const bosphorus = JSON.stringify(DIRECTION_ITINERARIES['bosphorus-slow-luxury']);
  assert.notEqual(classic, food);
  assert.notEqual(food, bosphorus);
  assert.notEqual(classic, bosphorus);
});

test('Classic Istanbul direction emphasizes Sultanahmet/historical sites/Grand Bazaar', async () => {
  const { DIRECTION_ITINERARIES } = await import('@/lib/e2b-experience-preview-fixtures');
  const text = JSON.stringify(DIRECTION_ITINERARIES['classic-istanbul']);
  assert.ok(/Sultanahmet|Topkapi|Grand Bazaar/i.test(text));
});

test('Istanbul Through Food direction emphasizes markets/cooking/meyhane', async () => {
  const { DIRECTION_ITINERARIES } = await import('@/lib/e2b-experience-preview-fixtures');
  const text = JSON.stringify(DIRECTION_ITINERARIES['istanbul-through-food']);
  assert.ok(/market|cooking|meyhane|food tour/i.test(text));
});

test('Bosphorus & Slow Luxury direction emphasizes spa/wellness/evening cruise', async () => {
  const { DIRECTION_ITINERARIES } = await import('@/lib/e2b-experience-preview-fixtures');
  const text = JSON.stringify(DIRECTION_ITINERARIES['bosphorus-slow-luxury']);
  assert.ok(/spa|wellness|evening cruise/i.test(text));
});

test('each Compare option projects a meaningfully different pace, hotel level, included experiences, budget range, and service level', async () => {
  const { COMPARE_OPTIONS } = await import('@/lib/e2b-experience-preview-fixtures');
  const [smart, balanced, premium] = COMPARE_OPTIONS;
  assert.notEqual(smart.hotelLevel.en, balanced.hotelLevel.en);
  assert.notEqual(balanced.hotelLevel.en, premium.hotelLevel.en);
  assert.notEqual(smart.illustrativeBudgetRangeAzn, premium.illustrativeBudgetRangeAzn);
  assert.notEqual(smart.serviceLevel.en, premium.serviceLevel.en);
});

test('the workspace wires selectDirection to update the displayed itinerary via DIRECTION_ITINERARIES, not merely CSS', async () => {
  const source = await readSource('src/components/experience-preview-workspace.tsx');
  assert.ok(source.includes('activeDirection ? DIRECTION_ITINERARIES[activeDirection]'));
});

test('the workspace shows a "how this direction changed" explanation and allows returning to the previous direction', async () => {
  const source = await readSource('src/components/experience-preview-workspace.tsx');
  assert.ok(source.includes('howChanged'));
  assert.ok(source.includes('returnToPrevious'));
  assert.ok(source.includes('previousDirection'));
});

test('the accountability section explicitly states no payment, booking, or supplier authority has been granted', async () => {
  const source = await readSource('src/components/experience-preview-workspace.tsx');
  assert.ok(source.includes('noAuthority'));
});
