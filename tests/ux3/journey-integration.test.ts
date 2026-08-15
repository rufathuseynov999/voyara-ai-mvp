import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readSource(relPath: string): Promise<string> {
  return readFile(new URL(`../../${relPath}`, import.meta.url), 'utf8');
}

test('Journey Canvas: loads payments/bookings through the existing authoritative loaders, not new queries', async () => {
  const page = await readSource('src/app/[locale]/(customer)/proposal/page.tsx');
  assert.ok(page.includes("import { loadCustomerPaymentRequests } from '@/server/payment/queries'"));
  assert.ok(page.includes("import { loadCustomerBookings } from '@/server/booking/queries'"));
  assert.ok(page.includes('loadCustomerPublishedProposals'), 'proposal loader unchanged');
});

test('Journey Canvas: next-action is derived only for the accepted proposal, via the shared pure projection', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  assert.ok(source.includes("import { deriveJourneyNextAction } from '@/lib/journey-continuity'"));
  assert.ok(source.includes("proposals.find((p) => p.status === 'ACCEPTED')"), 'only considers the accepted proposal');
  assert.ok(!/function\s+deriveJourneyNextAction/.test(source), 'does not redefine the projection locally');
});

test('Journey Canvas never issues a write for payment or booking creation', async () => {
  const source = await readSource('src/components/journey-canvas.tsx');
  const forbidden = ['payment_requests', "'booking.create'", "'payment.", 'INSERT INTO', '.insert(', 'fetch('];
  for (const term of forbidden) {
    assert.ok(!source.includes(term), `journey-canvas.tsx must not reference ${term}`);
  }
});

test('Payment: cross-links to Journey Canvas and Trip Room are present, Trip Room link is state-conditional', async () => {
  const component = await readSource('src/components/customer-payment-workspace.tsx');
  assert.ok(component.includes('ctaBackToProposal'), 'always offers a way back to Journey Canvas');
  assert.ok(component.includes('hasBooking'), 'Trip Room link is gated on a real matching booking');
  assert.ok(component.includes('bookings.some((booking) => booking.quotationId === payment.quotationId)'), 'matching is by authoritative quotationId, not assumption');
});

test('Payment page still sources payment data from the real, unchanged loadCustomerPaymentRequests', async () => {
  const page = await readSource('src/app/[locale]/(customer)/payment/page.tsx');
  assert.ok(page.includes('loadCustomerPaymentRequests'));
  assert.ok(page.includes('loadCustomerBookings'), 'also loads real bookings for the cross-link check');
});

test('Trip Room: existing loaders remain the only data source (no new booking/support query introduced)', async () => {
  const page = await readSource('src/app/[locale]/(customer)/trip-room/page.tsx');
  assert.ok(page.includes('loadCustomerBookings'));
  assert.ok(page.includes('loadCustomerSupportCases'));
});

test('Trip Room: compact next-action card uses deriveBookingStage on the real booking status, not a separate guess', async () => {
  const component = await readSource('src/components/customer-trip-room.tsx');
  assert.ok(component.includes("import { deriveBookingStage } from '@/lib/journey-continuity'"));
  assert.ok(component.includes('deriveBookingStage(booking.status)'));
});

test('Trip Room: proposal cross-link and support panel both remain present', async () => {
  const component = await readSource('src/components/customer-trip-room.tsx');
  assert.ok(component.includes('ctaBackToProposal'));
  assert.ok(component.includes('<CustomerSupportPanel'), 'existing support functionality preserved');
});

test('Trip Room: voucher rendering condition is untouched (still gated on booking.voucher existing)', async () => {
  const component = await readSource('src/components/customer-trip-room.tsx');
  assert.ok(component.includes('booking.voucher ? (') || component.includes('booking.voucher ?'), 'voucher block still conditional on real voucher data');
});

test('Membership-in-context: shell badge is only fed from loadCurrentMembership and only when ACTIVE', async () => {
  const layout = await readSource('src/app/[locale]/(customer)/layout.tsx');
  assert.ok(layout.includes("import { loadCurrentMembership } from '@/server/agents/subscriptions/customer-subscription-queries'"));
  assert.ok(layout.includes("membership?.status === 'ACTIVE' ? membership.planCode : null"), 'badge is null unless a real ACTIVE membership was loaded');
});

test('Membership-in-context: ExperienceShell never fabricates a plan when none is passed', async () => {
  const shell = await readSource('src/components/experience-shell.tsx');
  assert.ok(shell.includes('planCode = null'), 'defaults to null, no placeholder plan');
  assert.ok(shell.includes('planLabel ?'), 'badge markup is conditional on a real planLabel');
  const forbidden = ['% off', 'discount', 'save up to', 'free upgrade'];
  for (const term of forbidden) {
    assert.ok(!shell.toLowerCase().includes(term.toLowerCase()), `must not invent savings/benefit language ("${term}")`);
  }
});

test('no UX3 surface performs a direct client write of operational status (read-side only)', async () => {
  const files = ['src/components/journey-canvas.tsx', 'src/components/next-action-card.tsx', 'src/lib/journey-continuity.ts'];
  for (const file of files) {
    const source = await readSource(file);
    assert.ok(!/fetch\(/.test(source), `${file} must not perform any network write — it is purely presentational/derived`);
  }
});
