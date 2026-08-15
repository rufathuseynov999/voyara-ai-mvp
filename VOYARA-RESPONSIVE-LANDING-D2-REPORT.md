# VOYARA — Phase D2 Responsive Landing: Certification Report

**Status of this document:** generated to close a documentary gap. It reports
only evidence produced or independently verified in one Claude session
against the packaged source (`VOYARA-COMPLETE-NORMAL-CLAUDE-PACK.zip`,
`SOURCE-BASELINE.txt` claimed branch `preview/final-landing`). No number in
this report is copied from a prior conversation, memory, or the Strategic
Constitution without being re-verified here.

---

## 1. Project baseline

- Next.js 16.2.10, React 19.2.7, TypeScript 5.9.3, Node ≥20.9 (executed on
  Node 22.22.2).
- `npm install`: 113 packages, clean install from the packaged
  `package-lock.json`.
- 27 SQL migrations under `supabase/migrations/`, integrity-checked against
  `manifest.sha256`.

## 2. D2 defects addressed (source-verified, per `tests/standalone/responsive-landing-d2.test.ts`)

1. The eight-screen showcase section moved to appear immediately after the
   hero, before the scope/how/why sections.
2. `PlatformShowcase` default corrected from `screenRegistry[1]` (screen 02)
   to `screenRegistry[0]` (screen 01) on clean load.
3. A CSS specificity conflict (`.landing-v2 .sect` at 0,0,2,0 silently
   beating `.screens-section` at 0,0,1,0) that prevented the showcase's
   full-width background from rendering full-width — fixed.
4. A CSS grid blowout (`.scope-grid li` missing `min-width: 0`) causing
   horizontal overflow at 320px for long unbreakable words (confirmed
   Russian example: "Авиабилеты") — fixed, plus an added sub-380px
   single-column breakpoint as headroom.
5. Confirmed as a boundary check: D1 brand-mark assets and logo CSS classes
   were left untouched by D2.

## 3. Automated evidence (executed this session)

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **0 errors** |
| Full test suite | `npm test` | **1133 total / 1111 pass / 0 fail / 22 skip** |
| D1/D2/E1 standalone tests (isolated) | `node --import tsx --test tests/standalone/brand-assets-d1.test.ts tests/standalone/responsive-landing-d2.test.ts tests/standalone/hybrid-landing-e1.test.ts` | **28 total / 28 pass / 0 fail / 0 skip** |
| Security scan | `npm run security:scan` | **PASS** — no committed credential signatures, unsafe client authority imports, or seeded CI reset |
| Migration integrity | `npm run db:migrations:verify` | **PASS** — 27 ordered immutable SQL files match `manifest.sha256` |
| Production build | `npm run build` | **SUCCESS** — 102 static pages generated, full route map compiled, `postbuild` standalone prep completed |
| Runtime smoke | `npm run test:runtime` | **PASS** — 3-locale routing, protected routes, hardened headers, locale-formatted public prices |
| Browser/Playwright | `npm run test:browser` | **PASS** — real Chromium binary at `/opt/pw-browsers/chromium-1194`, run against the production standalone build |
| DB/sandbox suite | `npm run test:db` | 242 total / 8 pass / 0 fail / 234 skip (skipped: no live Postgres/Supabase instance in this sandbox — an honest skip, not a fabricated pass) |

## 4. Viewport / device coverage actually executed

The real Playwright run (`scripts/browser-launch-readiness.mjs`) exercises
exactly:

- **Viewports:** `mobile` (390×844), `desktop` (1440×900).
- **Locales:** `az`, `ru`, `en` (full route matrix); `ru`, `en` (secondary
  pass for `<html lang>` correctness after in-app language switch).
- **Assertions per state:** page status 200, ≤2px horizontal overflow, zero
  CSP violations, zero console/page errors, no raw/undefined translation
  keys, all eight showcase screens present, monthly/annual pricing correct,
  mobile menu behavior, `<html lang>` correctness.

This is **2 viewports × 3 locales** (with sub-checks), not a 7-width matrix.
See Section 6 for why the historical "21-state" figure cannot be equated
with this run.

## 5. Localization checks

- `test:runtime` confirms all three locale routes (`az`/`ru`/`en`) resolve
  correctly with hardened headers and correct public pricing formatting.
- `test:browser` confirms `<html lang>` switches correctly across all three
  locales and that no raw/undefined i18n keys leak into rendered text at
  either viewport.
- `test:legacy` (DOM audit against the preserved Task 001 reference) reports
  zero script errors and per-screen character/script breakdowns with no
  language-mixing artifacts detected.
- No language-mixing defect was found in any executed check.

## 6. Status of the historical "21-state" claim

The phrase **"21 states: 7 widths × 3 locales"** appears in exactly one
place in the packaged repository: a docstring comment inside
`tests/standalone/responsive-landing-d2.test.ts`, which states that this
empirical matrix "was run separately with Playwright against a live server
and is reported in `VOYARA-RESPONSIVE-LANDING-D2-REPORT.md`" (i.e., this
file, which did not exist until this session created it).

Repo-wide search confirms:

- No source file, script, or config anywhere in the package defines 7
  specific viewport widths.
- The actual current browser certification script
  (`scripts/browser-launch-readiness.mjs`) defines exactly **2** viewports
  (390px, 1440px), not 7.
- A separate, differently-scoped matrix exists in
  `tests/standalone/standalone-playwright.test.ts`, described in its own
  docstring as **"the full 48-state matrix: 8 screens × 3 locales × 2
  viewports"** — a distinct claim from the D2 21-state one, and also not
  independently reconstructable from source alone (it requires a live
  browser run, which is addressed separately in Section 3 above).
- No artifact, screenshot set, CSV, or log file recording 21 individual
  width/locale results was included in the package.

**Conclusion: the historical 21-state Playwright matrix cannot be
independently reconstructed from the packaged repository.** The specific
7 widths were never named in any source file available for inspection, so
inventing plausible widths (e.g., common breakpoints) to "fill in" the claim
would not be reconstruction — it would be fabrication, which this report
does not do.

What **is** independently verified in its place is the real browser
certification described in Sections 3–4 above: an actual Playwright/Chromium
run against the production standalone build, at 2 viewports × 3 locales,
with zero CSP violations, zero console/page errors, and a 390px overflow
guard passing at ≤2px — which directly covers the same defect classes (full
eight-screen showcase, CSS overflow, locale correctness) the original
21-state matrix was designed to catch, even though it is not the same
matrix.

## 7. Known limitations

- The historical 21-state artifact is unavailable (Section 6).
- Git history in the packaged export is squashed to a single synthetic
  commit; the claimed source commit hash (`4598e9e...`) in
  `SOURCE-BASELINE.txt` could not be independently verified from git log.
- `test:db`'s 234 skipped tests require a live Postgres/Supabase instance
  not available in this sandbox; they were not run, and are not claimed as
  passing.
- `npm run env:check` fails in this sandbox as expected (no real Supabase
  credentials present) — correct fail-closed behavior, not a defect.

## 8. Final certification status

**CERTIFIED — HISTORICAL 21-STATE ARTIFACT UNAVAILABLE, CURRENT
AUTHORITATIVE BROWSER CERTIFICATION PASSES.**

All executable checks available in this environment — typecheck, full
automated test suite, isolated D1/D2/E1 standalone tests, security scan,
migration integrity, production build, runtime smoke, and a real
Playwright/Chromium browser run — pass with zero failures. The only gap is
documentary: the specific historical 7-width matrix cannot be reconstructed
from source, and is reported honestly as unavailable rather than invented.
