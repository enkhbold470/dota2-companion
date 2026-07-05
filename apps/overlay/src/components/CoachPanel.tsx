import type { CoachTip } from '@dc/shared';

const SEVERITY_COLOR: Record<CoachTip['severity'], string> = {
  urgent: '#f87171', warn: '#fbbf24', info: '#60a5fa',
};

export function CoachPanel({ tips }: { tips: CoachTip[] }) {
  if (tips.length === 0) return null;
  return (
    <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {tips.map((t) => (
        <div key={t.id} style={{ borderLeft: `3px solid ${SEVERITY_COLOR[t.severity]}`, paddingLeft: 6 }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
