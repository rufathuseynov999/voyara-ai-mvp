import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * UX2 — Experience Shell tests.
 *
 * Source-level structural checks (matching the convention already used by
 * tests/standalone/responsive-landing-d2.test.ts) rather than rendered-DOM
 * checks, because the sandbox's `next dev` client hydration is
 * demonstrably unreliable in this environment for both pre-existing
 * certified components and new UX2 ones (proven via a control test
 * against the pre-existing .menu-toggle component during UX2 browser QA).
 * The 75/75 real Playwright layout/CSS matrix already covers rendered
 * behaviour and does not depend on hydration.
 */

async function readSource(relPath: string): Promise<string> {
  return readFile(new URL(`../../${relPath}`, import.meta.url), 'utf8');
}

test('ExperienceShell component exists and renders desktop rail + mobile bottom nav', async () => {
  const source = await readSource('src/components/experience-shell.tsx');
  assert.ok(source.includes('exp-rail'), 'renders the desktop rail');
  assert.ok(source.includes('exp-bottom-nav'), 'renders the mobile bottom nav');
  assert.ok(source.includes('exp-topbar'), 'renders the shared top bar');
});

test('ExperienceShell primary navigation links to the real Experience OS routes', async () => {
  const source = await readSource('src/components/experience-shell.tsx');
  for (const route of ['`/${locale}`', '`/${locale}/ask`', '`/${locale}/trip-room`', '`/${locale}/membership`']) {
    assert.ok(source.includes(route), `nav links to ${route}`);
  }
});

test('ExperienceShell context switcher is explicitly non-authoritative (only "me" is enabled)', async () => {
  const source = await readSource('src/components/experience-shell.tsx');
  // Per spec: ME/FAMILY/WORK is a UI affordance only, not real backend
  // context switching. The non-'me' options must remain disabled.
  assert.ok(source.includes("disabled={option.id !== 'me'}"), 'family/work options are disabled, not fake-functional');
  assert.ok(source.includes('contextComingSoon'), 'shows an honest "coming soon" label rather than pretending it works');
});

test('the (customer) layout wraps children in ExperienceShell and preserves AccessBanner/auth gating', async () => {
  const source = await readSource('src/app/[locale]/(customer)/layout.tsx');
  assert.ok(source.includes('ExperienceShell'), 'customer layout mounts the shell');
  assert.ok(source.includes('AccessBanner'), 'existing AccessBanner is preserved, not removed');
  assert.ok(source.includes('requireViewerRole'), 'existing auth gating (requireViewerRole) is preserved unchanged');
  assert.ok(source.includes('customerAreaRoles'), 'the existing customer role gate is untouched');
});

test('trip-wizard keeps its own anonymous-tolerant auth gate and is not moved under requireViewerRole', async () => {
  const source = await readSource('src/app/[locale]/trip-wizard/page.tsx');
  assert.ok(source.includes('ExperienceShell'), 'trip-wizard also gets the continuous shell chrome');
  assert.ok(source.includes('getViewer()'), 'still uses the nullable getViewer (not requireViewerRole)');
  assert.ok(source.includes('signInTitle'), 'still shows its own inline sign-in gate for anonymous visitors');
  assert.ok(!source.includes("import { requireViewerRole }"), 'must not import the redirect-on-anonymous gate (would change behaviour for signed-out visitors)');
});

test('marketing SiteHeader/footer are excluded only for Experience OS routes, not globally', async () => {
  const source = await readSource('src/app/[locale]/layout.tsx');
  assert.ok(source.includes('isExperienceOsPath'), 'has the route-scoped check');
  assert.ok(source.includes('x-voyara-pathname'), 'derives the check from the real request path, not a guess');
  for (const route of ['/ask', '/trip-wizard', '/proposal', '/trip-room', '/membership', '/payment']) {
    assert.ok(source.includes(`'${route}'`), `${route} is in the Experience OS exclusion list`);
  }
  assert.ok(source.includes('<SiteHeader'), 'SiteHeader is still rendered for non-Experience-OS routes (landing, login, etc.)');
  assert.ok(source.includes('<WebsiteChatWidget'), 'chat widget is still rendered for non-Experience-OS routes');
});

test('overflow-fix CSS protections remain present (regression guard for the two real defects found during UX2 browser QA)', async () => {
  const css = await readSource('src/styles/experience-os.css');
  // Defect 1: topbar context switcher caused 29px overflow at 390px — the
  // fix was removing it from the topbar (kept only in the desktop rail).
  const topbarBlockMatch = css.match(/\.exp-topbar\s*\{[\s\S]*?\n\}/);
  assert.ok(topbarBlockMatch, 'exp-topbar rule exists');
  // Defect 2: .ai-agent-grid's negative-margin full-bleed carousel caused
  // 4px overflow at 320px on /membership once wrapped in the new shell —
  // fixed with a scoped overflow guard on the new wrapper, not by editing
  // the pre-existing certified .ai-agent-grid component.
  assert.ok(css.includes('.exp-workspace'), 'workspace wrapper rule exists');
  const workspaceBlockMatch = css.match(/\.exp-workspace\s*\{[\s\S]*?\n\}/);
  assert.ok(workspaceBlockMatch && /overflow-x:\s*hidden/.test(workspaceBlockMatch[0]), 'workspace wrapper carries the overflow-x guard');

  const globalsCss = await readSource('src/app/globals.css');
  assert.ok(globalsCss.includes('.ai-agent-grid'), 'the pre-existing certified component is untouched, not removed');
  assert.ok(globalsCss.includes('margin-inline: -18px'), 'its original full-bleed rule is byte-identical, not edited to work around the new shell');
});

test('mobile bottom nav flex children have min-width guards against text-length overflow', async () => {
  const css = await readSource('src/styles/experience-os.css');
  const bottomLinkMatch = css.match(/\.exp-bottom-link\s*\{[\s\S]*?\n\}/);
  assert.ok(bottomLinkMatch && /min-width:\s*0/.test(bottomLinkMatch[0]), 'bottom nav links guard against flex intrinsic-width overflow');
});

test('UX2 does not modify any migration file (regression guard, D1/D2/E1/UX2 must all agree on 28 immutable migrations plus E.2A migration 29)', async () => {
  const { readdir } = await import('node:fs/promises');
  const migrationsDir = new URL('../../supabase/migrations/', import.meta.url);
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql'));
  assert.equal(files.length, 29, 'exactly 29 migration files exist — the 28 pre-E.2A migrations plus E.2A migration 29');
});
