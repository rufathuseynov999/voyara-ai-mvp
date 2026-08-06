/**
 * Approved VOYARA logo (founder-approved master, 2026-08 refresh), served
 * from /public/brand/voyara-mark.png. This is the compact emblem-only
 * variant — deliberately NOT the full lockup with the "VOYARA" wordmark,
 * because the header renders this at 60-84px square (see .brand-logo in
 * globals.css); at that size a baked-in wordmark becomes illegible, so the
 * symbol alone reads far more clearly. The full wordmark lockup
 * (voyara-logo.jpg) is used elsewhere at larger sizes (hero watermark,
 * founder section, standalone demo header) where the text stays legible.
 * Rendered as a plain <img> with explicit dimensions and a CSS class so no
 * inline style is emitted (CSP-safe).
 */
export function BrandMark() {
  return (
    <img
      alt="VOYARA — approved brand emblem"
      className="brand-logo"
      decoding="async"
      height={96}
      loading="eager"
      src="/brand/voyara-mark.png"
      width={96}
    />
  );
}
