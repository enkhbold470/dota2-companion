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
  color: {
    appBg: '#0b1220',      // window background (theme.css fills the viewport)
    panel: '#111827',      // card surface
    inset: '#1f2937',      // controls, inputs, tags — one step above the panel
    border: '#1f2937',     // hairline between panel sections
    borderStrong: '#374151', // control borders
    text: '#e5e7eb',       // primary
    textMuted: '#9ca3af',  // secondary / reasons
    textFaint: '#6b7280',  // hints / placeholders
    accent: '#60a5fa',     // primary interactive (blue): dots, borders
    accentText: '#93c5fd', // label text on dark controls
    accentDeep: '#1e3a8a', // selected control background
    ai: '#c084fc',         // AI / vision sections (purple)
    aiDeep: '#7c3aed',     // active AI toggle
    metaDeep: '#2563eb',   // active meta toggle
    success: '#4ade80',
    warn: '#fbbf24',
    danger: '#f87171',
    info: '#60a5fa',
  },
  // Damage-type accents (kept exact — asserted by SkillPanel tests).
  dmg: { Magical: '#a78bfa', Physical: '#f87171', Pure: '#fbbf24' } as Record<string, string>,
  font: { xs: 10, sm: 11, base: 12, md: 13, lg: 16, xl: 20 },
  weight: { normal: 400, semibold: 600 },
  radius: { sm: 3, md: 4, lg: 8, pill: 999 },
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
