export function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <div style={{ fontSize: 12, color: connected ? '#4ade80' : '#f59e0b' }}>
      {connected ? '● LIVE' : '○ waiting for GSI…'}
    </div>
  );
}
