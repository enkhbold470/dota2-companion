import type { EconomyGrade } from '@dc/shared';

const COLOR: Record<EconomyGrade['rating'], string> = {
  ahead: '#4ade80', 'on-track': '#e5e7eb', behind: '#f87171', unknown: '#9ca3af',
};

export function EconomyPanel({ grade }: { grade: EconomyGrade }) {
  const gpmDisplay = grade.gpm !== null ? String(grade.gpm) : '—';
  const targetDisplay = grade.target !== null ? ` / ${grade.target}` : '';
  return (
    <div style={{ color: COLOR[grade.rating] }}>
      <strong>GPM:</strong>{' '}
      <span>{gpmDisplay}{targetDisplay} ({grade.rating})</span>
    </div>
  );
}
