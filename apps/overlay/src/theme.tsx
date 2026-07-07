import type { CSSProperties, ReactNode } from 'react';

/**
 * Design system — the SINGLE source of truth for the overlay's look.
 *
 * Rules (follow every one):
 *  1. No raw hex/px in components. Pull colors from `t.color`, sizes from
 *     `t.font` / `t.space` / `t.radius`, and reuse the primitives below.
 *  2. Every top-level section is a <Panel>. A panel's title is a <SectionLabel>.
 *  3. Interactive controls use `btn(...)` or `inputStyle`. Small status tags use
 *     `pill(...)`. Nothing invents its own button/input/tag styling.
 *  4. The app background lives in theme.css (fills the whole window). Panels are
 *     the only raised surface; controls/tags sit one step lighter (`inset`).
 */
export const t = {
  // NeuroFocus design system — tokens mirrored from neurofocus.dev
  // (../neurofocus-dev-fdotinc/src/routes/layout.css :root). Dark instrument
  // chassis, one warm-amber "signal" accent, measured green/red status colors.
  color: {
    appBg: '#0a0a0c',      // --bg: window background (theme.css fills the viewport)
    panel: '#131019',      // --surface: card surface
    inset: '#1f1f23',      // --surface-2: controls, inputs, tags
    border: '#29292d',     // --line: hairline between panel sections
    borderStrong: '#5b5b64', // --line-strong: control borders
    text: '#fbfbfb',       // --ink: primary
    textMuted: '#a1a1aa',  // --ink-dim: secondary / reasons
    textFaint: '#7a7a83',  // --ink-faint: hints / placeholders
    accent: '#f1b27a',     // --signal: primary interactive (amber)
    accentText: '#f6c99e', // lighter signal for label text on dark controls
    accentDeep: '#5c3a1e', // selected control background (deep amber)
    ai: '#f1b27a',         // AI / vision sections share the signal accent
    aiDeep: '#8a5426',     // active AI toggle
    metaDeep: '#5b5b64',   // active meta toggle (neutral chassis)
    success: '#7dd3a8',    // --good
    warn: '#ed9a5a',       // --signal-dim
    danger: '#e5757b',     // --error
    info: '#a1a1aa',
  },
  // Damage-type accents (kept exact — asserted by SkillPanel tests).
  dmg: { Magical: '#a78bfa', Physical: '#f87171', Pure: '#fbbf24' } as Record<string, string>,
  // Focus-layer signal colors, same source. Focus rides the amber signal hue;
  // stress/death use the warm error red; kills the measured green.
  brand: {
    focus: '#f1b27a',       // --signal — PRIMARY focus hue / glow
    focusBright: '#f8cba4', // lightened signal — brightest glow core
    focusDeep: '#ed9a5a',   // --signal-dim — gradient partner
    stress: '#e5757b',      // --error — stress β / tilt warning
    kill: '#7dd3a8',        // --good — kill / positive
    death: '#d94f56',       // deepened --error — death / crash / destructive
    ink: '#fbfbfb',         // --ink — hero numerals
    canvas: '#0a0a0c',      // --bg — near-black plot background
    glow: '0 0 12px rgba(241,178,122,0.60)',                // amber signal glow
    glowLine: 'drop-shadow(0 0 6px rgba(241,178,122,0.45))',
    grad: 'linear-gradient(90deg, #f1b27a, #7dd3a8)',       // signature signal→good
  },
  font: { xs: 10, sm: 11, base: 12, md: 13, lg: 16, xl: 20 },
  weight: { normal: 400, semibold: 600 },
  radius: { sm: 4, md: 8, lg: 12, pill: 999 }, // --radius: 12px on cards/inputs
  space: { xs: 4, sm: 6, md: 8, lg: 12, xl: 16 },
  line: { tight: 1.3, normal: 1.5, loose: 1.6 },
} as const;

/* ---- primitives ---------------------------------------------------------- */

/** A raised card. Every top-level section is wrapped in one. */
export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <section
      style={{
        background: t.color.panel,
        border: `1px solid ${t.color.border}`,
        borderRadius: t.radius.lg,
        padding: t.space.md,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

/** The uppercase header that titles a panel. `tone` tints AI/vision sections. */
export function SectionLabel({ children, tone = 'default', style }: {
  children: ReactNode; tone?: 'default' | 'ai'; style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontSize: t.font.xs,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        fontWeight: t.weight.semibold,
        color: tone === 'ai' ? t.color.ai : t.color.textMuted,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ---- style helpers ------------------------------------------------------- */

export type BtnVariant = 'ghost' | 'primary' | 'toggle';

/** Button styling. `toggle` + `active` drives the Meta/Fun style toggles. */
export function btn(variant: BtnVariant = 'ghost', opts: { active?: boolean; tone?: 'ai' | 'meta' } = {}): CSSProperties {
  const base: CSSProperties = {
    fontSize: t.font.sm,
    cursor: 'pointer',
    borderRadius: t.radius.md,
    padding: '1px 8px',
    lineHeight: 1.6,
    border: `1px solid ${t.color.borderStrong}`,
    background: t.color.inset,
    color: t.color.accentText,
  };
  if (variant === 'primary') {
    return { ...base, background: t.color.accentDeep, borderColor: t.color.accent, color: t.color.text };
  }
  if (variant === 'toggle') {
    const activeBg = opts.tone === 'ai' ? t.color.aiDeep : t.color.metaDeep;
    return {
      ...base,
      padding: '0 6px',
      background: opts.active ? activeBg : t.color.panel,
      color: opts.active ? '#fff' : t.color.accentText,
    };
  }
  return base;
}

/** Text input / search field. */
export const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontSize: t.font.base,
  padding: '3px 6px',
  background: t.color.inset,
  color: t.color.text,
  border: `1px solid ${t.color.borderStrong}`,
  borderRadius: t.radius.md,
};

/** Small status tag ("passive", "BUY NOW", damage type). `fg` sets the text. */
export function pill(fg: string = t.color.textMuted): CSSProperties {
  return {
    fontSize: t.font.sm,
    color: fg,
    background: t.color.inset,
    borderRadius: t.radius.sm,
    padding: '0 4px',
  };
}

/** Hairline used between rows inside a panel (replaces raw <hr>). */
export const divider: CSSProperties = {
  border: 0,
  borderTop: `1px solid ${t.color.border}`,
  margin: `${t.space.sm}px 0`,
};
