/**
 * The NeuroFocus mark — monochrome EEG-electrode glyph in a ringed circle,
 * copied from the brand source (neurofocus.dev static/logo.svg). Self-contained
 * SVG so it works inline, as a favicon, or as an Electron window icon.
 */
export function Logo({ size = 28, title = 'NeuroFocus' }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 300 300"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
      style={{ borderRadius: '50%' }}
    >
      <title>{title}</title>
      <circle cx="150" cy="150" r="150" fill="black" />
      <circle cx="150" cy="150" r="120" stroke="white" strokeWidth="10" fill="none" />
      <circle cx="150" cy="67" r="14.5" fill="white" stroke="white" />
      <circle cx="242" cy="129" r="14.5" fill="white" stroke="white" />
      <circle cx="150" cy="118" r="14.5" fill="white" stroke="white" />
      <circle cx="108" cy="99" r="9.5" fill="white" stroke="white" />
      <rect x="103.5" y="104.5" width="9" height="157" fill="white" stroke="white" />
      <rect x="130.5" y="187.5" width="9" height="81" fill="white" stroke="white" />
      <rect x="163.5" y="187.5" width="9" height="81" fill="white" stroke="white" />
      <circle cx="195" cy="99" r="9.5" fill="white" stroke="white" />
      <circle cx="222" cy="175" r="9.5" fill="white" stroke="white" />
      <rect x="190.5" y="103.5" width="9" height="157" fill="white" stroke="white" />
      <rect x="217.5" y="182.5" width="9" height="62" fill="white" stroke="white" />
      <rect x="237.5" y="139.5" width="9" height="85" fill="white" stroke="white" />
      <circle cx="15" cy="15" r="14.5" transform="matrix(-1 0 0 1 71 114)" fill="white" stroke="white" />
      <circle cx="10" cy="10" r="9.5" transform="matrix(-1 0 0 1 86 165)" fill="white" stroke="white" />
      <rect x="-0.5" y="0.5" width="9" height="62" transform="matrix(-1 0 0 1 80 182)" fill="white" stroke="white" />
      <rect x="-0.5" y="0.5" width="9" height="85" transform="matrix(-1 0 0 1 60 140)" fill="white" stroke="white" />
      <rect x="145.5" y="129.5" width="9" height="47" fill="white" stroke="white" />
      <path d="M130.513 186.5C130.773 181.486 134.921 177.5 140 177.5H163C168.079 177.5 172.227 181.486 172.487 186.5H130.513Z" fill="white" stroke="white" />
    </svg>
  );
}
