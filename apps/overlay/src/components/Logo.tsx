/**
 * App mascot — a cute little coach-bot (headset + friendly grin) drawn in the
 * design-system accent gradient. Self-contained SVG so it works as an inline
 * logo, a favicon, or an Electron window icon.
 */
export function Logo({ size = 28, title = 'Dota Coach' }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <defs>
        <linearGradient id="dcMascotBody" x1="16" y1="8" x2="48" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>

      {/* headset band */}
      <path d="M14 30a18 18 0 0 1 36 0" fill="none" stroke="#c7d2fe" strokeWidth="3.5" strokeLinecap="round" />
      {/* ear cups */}
      <rect x="9.5" y="28" width="8" height="13" rx="4" fill="#7c3aed" />
      <rect x="46.5" y="28" width="8" height="13" rx="4" fill="#7c3aed" />

      {/* body */}
      <rect x="16" y="18" width="32" height="34" rx="15" fill="url(#dcMascotBody)" />
      {/* face plate */}
      <rect x="21" y="26" width="22" height="17" rx="8.5" fill="#0b1220" />

      {/* eyes */}
      <circle cx="28.5" cy="34.5" r="3.4" fill="#e5e7eb" />
      <circle cx="35.5" cy="34.5" r="3.4" fill="#e5e7eb" />
      <circle cx="29.3" cy="35.1" r="1.5" fill="#0b1220" />
      <circle cx="36.3" cy="35.1" r="1.5" fill="#0b1220" />
      {/* eye shine */}
      <circle cx="27.7" cy="33.4" r="0.9" fill="#93c5fd" />
      <circle cx="34.7" cy="33.4" r="0.9" fill="#93c5fd" />

      {/* mic boom + tip */}
      <path d="M46 40c3 0 4 3 4 6" fill="none" stroke="#c7d2fe" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="50" cy="47" r="2.2" fill="#4ade80" />

      {/* little antenna spark */}
      <line x1="32" y1="12" x2="32" y2="18" stroke="#a855f7" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="32" cy="10" r="2.4" fill="#fbbf24" />
    </svg>
  );
}
