import type { ItemRecommendation } from '@dc/shared';

export interface ItemAdvicePanelProps {
  recs: ItemRecommendation[];
  gold: number | null;
  hasEnemies: boolean;
}

export function ItemAdvicePanel({ recs, gold, hasEnemies }: ItemAdvicePanelProps) {
  if (!hasEnemies) {
    return (
      <div style={{ fontSize: 12, color: '#9ca3af' }}>
        Pick enemy heroes below to unlock counter-item advice.
      </div>
    );
  }
  if (recs.length === 0) {
    return (
      <div style={{ fontSize: 12, color: '#9ca3af' }}>
        No urgent counter-items — follow your standard build.
      </div>
    );
  }
  return (
    <div style={{ fontSize: 12, lineHeight: 1.5 }}>
      {recs.slice(0, 3).map((r) => (
        <div key={r.itemKey} style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline' }}>
            <strong>{r.itemName}</strong>
            <span style={{ color: '#9ca3af' }}>{r.cost}g</span>
            {r.affordable ? (
              <span style={{ fontSize: 11, color: '#4ade80', background: '#1f2937', borderRadius: 3, padding: '0 4px' }}>
                BUY NOW
              </span>
            ) : (
              <span style={{ fontSize: 11, color: '#9ca3af', background: '#1f2937', borderRadius: 3, padding: '0 4px' }}>
                {gold === null ? 'save up' : `save ${r.cost - gold}g more`}
              </span>
            )}
          </div>
          <ul style={{ margin: '2px 0 0', paddingLeft: 16, fontSize: 11, color: '#9ca3af' }}>
            {r.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
