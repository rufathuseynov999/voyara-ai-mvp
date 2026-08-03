/**
 * Approved VOYARA logo (restored from the Task 001 reference), served from
 * /public/brand/voyara-logo.jpg. Rendered as a plain <img> with explicit
 * dimensions and a CSS class so no inline style is emitted (CSP-safe).
 */
export function BrandMark() {
  return (
    <img
      alt="VOYARA AI"
      className="brand-logo"
      decoding="async"
      height={96}
      loading="eager"
      src="/brand/voyara-logo.jpg"
      width={96}
    />
  );
}
