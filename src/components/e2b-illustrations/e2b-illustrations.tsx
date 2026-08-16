/**
 * E.2B.2 — locally-generated, project-owned SVG illustrations. No
 * external image requests, no third-party photography. These are
 * original simple vector illustrations, not photographic content, and
 * are never presented as representing a confirmed supplier property.
 * Provenance: hand-authored inline SVG for this checkpoint, VOYARA AI,
 * 2026.
 */

export function DestinationIllustration({ variant }: { variant: 'skyline' | 'bazaar' | 'bosphorus' }) {
  const palette = variant === 'bazaar' ? ['#c9a227', '#8a6d1f'] : variant === 'bosphorus' ? ['#1f6f4a', '#0d3d29'] : ['#2b4a63', '#16283a'];
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label={`Illustrative ${variant} scene`} className="e2b-illustration">
      <rect width="320" height="200" fill={palette[1]} />
      <circle cx="260" cy="40" r="24" fill={palette[0]} opacity="0.7" />
      {variant === 'skyline' && (
        <g fill={palette[0]} opacity="0.9">
          <rect x="20" y="120" width="18" height="70" />
          <rect x="46" y="90" width="18" height="100" />
          <circle cx="90" cy="95" r="14" />
          <rect x="82" y="95" width="16" height="95" />
          <rect x="120" y="110" width="20" height="80" />
          <rect x="160" y="80" width="18" height="110" />
        </g>
      )}
      {variant === 'bazaar' && (
        <g fill={palette[0]} opacity="0.9">
          {[0, 1, 2, 3, 4].map((i) => (
            <path key={i} d={`M ${20 + i * 60} 130 Q ${50 + i * 60} 90 ${80 + i * 60} 130 Z`} />
          ))}
        </g>
      )}
      {variant === 'bosphorus' && (
        <g>
          <rect x="0" y="140" width="320" height="60" fill={palette[0]} opacity="0.5" />
          <path d="M 40 150 L 90 140 L 100 155 L 40 160 Z" fill="#f4ede0" opacity="0.9" />
        </g>
      )}
    </svg>
  );
}

export function RouteVisualization({ locale, label }: { locale: 'az' | 'ru' | 'en'; label: string }) {
  return (
    <div className="e2b-route-wrapper">
      <svg viewBox="0 0 400 120" role="img" aria-label="Illustrative route" className="e2b-route-svg">
        <path d="M 30 90 Q 130 20 200 60 T 370 40" stroke="#c9a227" strokeWidth="3" fill="none" strokeDasharray="6 6" />
        <circle cx="30" cy="90" r="7" fill="#1f6f4a" />
        <circle cx="200" cy="60" r="6" fill="#8a6d1f" />
        <circle cx="370" cy="40" r="7" fill="#1f6f4a" />
        <text x="10" y="108" fontSize="11" fill="#1b1b1b">{locale === 'az' ? 'Bakı' : locale === 'ru' ? 'Баку' : 'Baku'}</text>
        <text x="345" y="30" fontSize="11" fill="#1b1b1b">{locale === 'az' ? 'İstanbul' : locale === 'ru' ? 'Стамбул' : 'Istanbul'}</text>
      </svg>
      <p className="e2b-illustrative-note">{label}</p>
    </div>
  );
}

export function HotelIllustration() {
  return (
    <svg viewBox="0 0 200 140" role="img" aria-label="Illustrative hotel property" className="e2b-card-illustration">
      <rect width="200" height="140" fill="#16283a" />
      <rect x="20" y="40" width="160" height="80" fill="#2b4a63" />
      {[0, 1, 2, 3].map((row) => [0, 1, 2, 3, 4].map((col) => (
        <rect key={`${row}-${col}`} x={32 + col * 30} y={50 + row * 18} width="14" height="10" fill="#c9a227" opacity={0.5 + ((row + col) % 2) * 0.3} />
      )))}
      <rect x="70" y="100" width="60" height="20" fill="#0d3d29" />
    </svg>
  );
}

export function DiningIllustration() {
  return (
    <svg viewBox="0 0 200 140" role="img" aria-label="Illustrative local dining scene" className="e2b-card-illustration">
      <rect width="200" height="140" fill="#3a2a1a" />
      <circle cx="100" cy="70" r="42" fill="#f4ede0" opacity="0.9" />
      <circle cx="100" cy="70" r="30" fill="#c9a227" opacity="0.6" />
      <circle cx="60" cy="45" r="6" fill="#f4ede0" opacity="0.7" />
      <circle cx="145" cy="95" r="6" fill="#f4ede0" opacity="0.7" />
    </svg>
  );
}

export function ExperienceIllustration({ variant }: { variant: 'morning' | 'afternoon' | 'evening' }) {
  const bg = variant === 'morning' ? '#e8dcc0' : variant === 'afternoon' ? '#c9a227' : '#16283a';
  return (
    <svg viewBox="0 0 200 100" role="img" aria-label={`Illustrative ${variant} experience`} className="e2b-card-illustration e2b-card-illustration-small">
      <rect width="200" height="100" fill={bg} />
      <circle cx={variant === 'morning' ? 40 : variant === 'evening' ? 160 : 100} cy="30" r="16" fill={variant === 'evening' ? '#f4ede0' : '#fff8e6'} opacity="0.85" />
      <path d="M 0 75 Q 60 55 100 75 T 200 65 V 100 H 0 Z" fill="#0d3d29" opacity="0.6" />
    </svg>
  );
}
