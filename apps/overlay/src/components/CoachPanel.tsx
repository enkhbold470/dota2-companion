import type { CoachTip } from '@dc/shared';
import { t } from '../theme';

const SEVERITY_COLOR: Record<CoachTip['severity'], string> = {
  urgent: t.color.danger, warn: t.color.warn, info: t.color.info,
};

export function CoachPanel({ tips }: { tips: CoachTip[] }) {
  if (tips.length === 0) return null;
  return (
    <div style={{ fontSize: t.font.base, display: 'flex', flexDirection: 'column', gap: t.space.xs, lineHeight: t.line.normal }}>
      {tips.map((tip) => (
        <div key={tip.id} style={{ borderLeft: `3px solid ${SEVERITY_COLOR[tip.severity]}`, paddingLeft: t.space.sm }}>
          {tip.message}
        </div>
      ))}
    </div>
  );
}
