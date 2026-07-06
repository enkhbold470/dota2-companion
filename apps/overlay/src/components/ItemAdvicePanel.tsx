import { itemImageUrl, type ItemCategory, type ItemRecommendation } from '@dc/shared';

export interface ItemAdvicePanelProps {
  recs: ItemRecommendation[];
  gold: number | null;
  hasEnemies: boolean;
}

// Order and labels for the grouped columns. Aggressive first — swinging a fight
// is usually the call once you can afford it.
const GROUPS: { key: ItemCategory; label: string; color: string }[] = [
  { key: 'aggressive', label: 'Aggressive', color: '#f87171' },
  { key: 'defensive', label: 'Defensive', color: '#60a5fa' },
  { key: 'utility', label: 'Utility', color: '#c084fc' },
];
const PER_GROUP = 3;

function Rec({ r, gold }: { r: ItemRecommendation; gold: number | null }) {
  return (
    <div style={{ marginBottom: 6, display: 'flex', gap: 6 }}>
      <img
        src={itemImageUrl(r.itemKey)}
        alt=""
        width={33}
        height={24}
        loading="lazy"
        onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
        style={{ borderRadius: 3, flex: 'none', marginTop: 1 }}
      />
      <div style={{ flex: 1 }}>
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
    </div>
  );
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
  // recs arrive score-sorted; keep that order within each column. Unmapped recs
  // (shouldn't happen from the engine) fall back to defensive.
  const grouped = GROUPS.map((g) => ({
    ...g,
    items: recs.filter((r) => (r.category ?? 'defensive') === g.key).slice(0, PER_GROUP),
  })).filter((g) => g.items.length > 0);

  return (
    <div style={{ fontSize: 12, lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {grouped.map((g) => (
        <div key={g.key}>
          <div style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: g.color, marginBottom: 3 }}>
            {g.label}
          </div>
          {g.items.map((r) => (
            <Rec key={r.itemKey} r={r} gold={gold} />
          ))}
        </div>
      ))}
    </div>
  );
}
