import { t } from '../theme';

export function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <div style={{
      fontSize: t.font.base,
      fontWeight: t.weight.semibold,
      letterSpacing: 0.4,
      color: connected ? t.color.success : t.color.warn,
    }}>
      {connected ? '● LIVE' : '○ waiting for GSI…'}
    </div>
  );
}
