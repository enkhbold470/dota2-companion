import { itemImageUrl, type ItemCategory, type ItemRecommendation } from '@dc/shared';
import { t, pill } from '../theme';

export interface ItemAdvicePanelProps {
  recs: ItemRecommendation[];
  gold: number | null;
  hasEnemies: boolean;
}

// Order and labels for the grouped columns. Aggressive first — swinging a fight
// is usually the call once you can afford it.
const GROUPS: { key: ItemCategory; label: string; color: string }[] = [
  { key: 'aggressive', label: 'Aggressive', color: t.color.danger },
  { key: 'defensive', label: 'Defensive', color: t.color.info },
  { key: 'utility', label: 'Utility', color: t.color.ai },
];
const PER_GROUP = 3;

function Rec({ r, gold }: { r: ItemRecommendation; gold: number | null }) {
  return (
    <div style={{ marginBottom: t.space.sm, display: 'flex', gap: t.space.sm }}>
      <img
        src={itemImageUrl(r.itemKey)}
        alt=""
        width={33}
        height={24}
        loading="lazy"
        onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
        style={{ borderRadius: t.radius.sm, flex: 'none', marginTop: 1 }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.space.sm, alignItems: 'baseline' }}>
          <strong>{r.itemName}</strong>
          <span style={{ color: t.color.textMuted }}>{r.cost}g</span>
          {r.affordable ? (
            <span style={pill(t.color.success)}>BUY NOW</span>
          ) : (
            <span style={pill(t.color.textMuted)}>
              {gold === null ? 'save up' : `save ${r.cost - gold}g more`}
            </span>
          )}
        </div>
        <ul style={{ margin: '2px 0 0', paddingLeft: 16, fontSize: t.font.sm, color: t.color.textMuted }}>
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
      <div style={{ fontSize: t.font.base, color: t.color.textMuted }}>
        Pick enemy heroes below to unlock counter-item advice.
      </div>
    );
  }
  if (recs.length === 0) {
    return (
      <div style={{ fontSize: t.font.base, color: t.color.textMuted }}>
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
    <div style={{ fontSize: t.font.base, lineHeight: t.line.normal, display: 'flex', flexDirection: 'column', gap: t.space.md }}>
      {grouped.map((g) => (
        <div key={g.key}>
          <div style={{ fontSize: t.font.xs, letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: t.weight.semibold, color: g.color, marginBottom: 3 }}>
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
