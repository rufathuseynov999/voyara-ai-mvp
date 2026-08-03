import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('commercial commands remain same-origin, server-authoritative and Role-gated', async () => {
  const [staffRoute, customerRoute, command, migration] = await Promise.all([
    readFile('src/app/api/v1/staff/commercial/route.ts', 'utf8'),
    readFile('src/app/api/v1/customer/commercial/route.ts', 'utf8'),
    readFile('src/server/commercial/command.ts', 'utf8'),
    readFile('supabase/migrations/20260717115718_task005_commercial_approval_vertical_slice.sql', 'utf8')
  ]);
  assert.match(staffRoute, /isSameOrigin\(request\)/);
  assert.match(staffRoute, /viewer\.assuranceLevel !== 'aal2'/);
  assert.match(staffRoute, /viewer\.roles\.includes\('founder'\)/);
  assert.match(staffRoute, /maximumBodyBytes/);
  assert.match(customerRoute, /isSameOrigin\(request\)/);
  assert.match(customerRoute, /viewer\.roles\.includes\('customer'\)/);
  assert.match(command, /createAdminSupabaseClient/);
  assert.match(command, /sha256\(canonicalPayload\)/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /grant execute on function public\.execute_commercial_command[\s\S]*to service_role/);
  assert.match(migration, /from public, anon, authenticated/);
});

test('commercial evidence is immutable and exact approved, published and accepted hashes are FK-bound', async () => {
  const migration = await readFile('supabase/migrations/20260717115718_task005_commercial_approval_vertical_slice.sql', 'utf8');
  assert.match(migration, /quotation_versions_immutable/);
  assert.match(migration, /commercial_approval_decisions_immutable/);
  assert.match(migration, /published_proposals_immutable/);
  assert.match(migration, /customer_quotation_acceptances_immutable/);
  assert.match(migration, /foreign key \(quotation_id, version_number, payload_hash\)/);
  assert.match(migration, /commercial_quotations_select_aal2_staff/);
  assert.match(migration, /action in \('quotation\.publish', 'quotation\.accept'\)/);
  assert.match(migration, /grant select \([\s\S]*customer_payload, locale, valid_until, published_at[\s\S]*published_proposals to authenticated/);
  assert.doesNotMatch(migration, /create table public\.(payments|bookings|vouchers)/i);
});

test('retained Proposal and Approval screens are live, localized and responsive', async () => {
  const [proposalPage, approvalPage, proposal, approval, css] = await Promise.all([
    readFile('src/app/[locale]/(customer)/proposal/page.tsx', 'utf8'),
    readFile('src/app/[locale]/staff/approvals/page.tsx', 'utf8'),
    readFile('src/components/published-proposals.tsx', 'utf8'),
    readFile('src/components/commercial-approval-workspace.tsx', 'utf8'),
    readFile('src/app/globals.css', 'utf8')
  ]);
  assert.doesNotMatch(proposalPage, /ScreenPreview/);
  assert.doesNotMatch(approvalPage, /ScreenPreview/);
  assert.match(proposalPage, /requireViewerRole\(locale, \['customer'\]/);
  assert.match(proposal, /acceptanceConfirmed: confirmed/);
  assert.match(proposal, /Viewing|viewingBoundary/);
  assert.match(approval, /quotation\.create_version/);
  assert.match(approval, /aria-live="polite"/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.proposal-version-strip[\s\S]*grid-template-columns: 1fr/);
});
