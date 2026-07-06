import { useMemo, useState } from 'react';
import { heroIconUrl } from '@dc/shared';
import { t, btn, inputStyle, SectionLabel } from '../theme';

export interface HeroOption { id: number; localized_name: string; name?: string }

export interface EnemyPickerProps {
  heroes: HeroOption[];
  selected: number[];
  onToggle: (heroId: number) => void;
  max?: number;
}

const SEARCH_LIMIT = 24;

export function EnemyPicker({ heroes, selected, onToggle, max = 5 }: EnemyPickerProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const q = query.trim().toLowerCase();

  const selectedHeroes = selected
    .map((id) => heroes.find((h) => h.id === id))
    .filter((h): h is HeroOption => h !== undefined);

  const results = useMemo(() => {
    if (q) return heroes.filter((h) => h.localized_name.toLowerCase().includes(q)).slice(0, SEARCH_LIMIT);
    if (expanded) return heroes;
    return [];
  }, [q, expanded, heroes]);

  const atLimit = selected.length >= max;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.sm }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: t.space.md }}>
        <SectionLabel>Enemy heroes ({selected.length}/{max})</SectionLabel>
        <button type="button" onClick={() => setExpanded((v) => !v)} style={{ ...btn('ghost'), marginLeft: 'auto' }}>
          {expanded ? 'Hide list' : 'Browse all'}
        </button>
      </div>

      {selectedHeroes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.space.xs }}>
          {selectedHeroes.map((h) => (
            <button
              key={h.id}
              onClick={() => onToggle(h.id)}
              title={`Remove ${h.localized_name}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: t.space.xs, cursor: 'pointer',
                background: t.color.accentDeep, color: '#fff', border: `1px solid ${t.color.accent}`,
                borderRadius: t.radius.md, padding: '1px 5px',
              }}
            >
              {h.name && (
                <img src={heroIconUrl(h.name)} alt="" width={18} height={18}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ borderRadius: 2 }} />
              )}
              <span style={{ fontSize: t.font.xs }}>{h.localized_name}</span>
              <span style={{ color: t.color.accentText }}>×</span>
            </button>
          ))}
        </div>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search hero to add…"
        style={inputStyle}
      />

      {results.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))', gap: t.space.xs,
          maxHeight: expanded ? 224 : undefined, overflowY: expanded ? 'auto' : undefined,
        }}>
          {results.map((h) => {
            const isSelected = selected.includes(h.id);
            const disabled = atLimit && !isSelected;
            return (
              <button
                key={h.id}
                aria-pressed={isSelected ? 'true' : 'false'}
                disabled={disabled}
                onClick={() => onToggle(h.id)}
                title={h.localized_name}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  padding: '3px 2px', cursor: disabled ? 'not-allowed' : 'pointer',
                  background: isSelected ? t.color.accentDeep : t.color.inset,
                  border: `1px solid ${isSelected ? t.color.accent : t.color.borderStrong}`,
                  borderRadius: t.radius.md, color: '#fff', opacity: disabled ? 0.35 : 1,
                }}
              >
                {h.name && (
                  <img src={heroIconUrl(h.name)} alt="" width={28} height={28} loading="lazy"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ borderRadius: t.radius.sm }} />
                )}
                <span style={{ fontSize: 9, lineHeight: 1.1, textAlign: 'center' }}>{h.localized_name}</span>
              </button>
            );
          })}
        </div>
      )}

      {q !== '' && results.length === 0 && (
        <div style={{ fontSize: t.font.sm, color: t.color.textFaint }}>No heroes match “{query}”.</div>
      )}
    </div>
  );
}
