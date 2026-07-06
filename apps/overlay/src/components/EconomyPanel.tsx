import type { EconomyGrade } from '@dc/shared';
import { t, SectionLabel } from '../theme';

const COLOR: Record<EconomyGrade['rating'], string> = {
  ahead: t.color.success, 'on-track': t.color.text, behind: t.color.danger, unknown: t.color.textMuted,
};

export function EconomyPanel({ grade }: { grade: EconomyGrade }) {
  const gpmDisplay = grade.gpm !== null ? String(grade.gpm) : '—';
  const targetDisplay = grade.target !== null ? ` / ${grade.target}` : '';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: t.space.sm }}>
      <SectionLabel>GPM</SectionLabel>
      <span style={{ fontSize: t.font.md, fontWeight: t.weight.semibold, color: COLOR[grade.rating], fontVariantNumeric: 'tabular-nums' }}>
        {gpmDisplay}{targetDisplay}
      </span>
      <span style={{ fontSize: t.font.sm, color: COLOR[grade.rating] }}>({grade.rating})</span>
    </div>
  );
}
