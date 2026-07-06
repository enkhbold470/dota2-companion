import { useMemo, useState } from 'react';
import { heroIconUrl } from '@dc/shared';

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
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12 }}>Enemy heroes ({selected.length}/{max})</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{ fontSize: 11, cursor: 'pointer', background: '#111827', color: '#93c5fd', border: '1px solid #374151', borderRadius: 4, padding: '0 6px' }}
        >
          {expanded ? 'Hide list' : 'Browse all'}
        </button>
      </div>

      {selectedHeroes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {selectedHeroes.map((h) => (
            <button
              key={h.id}
              onClick={() => onToggle(h.id)}
              title={`Remove ${h.localized_name}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer',
                background: '#1e3a8a', color: '#fff', border: '1px solid #60a5fa', borderRadius: 4, padding: '1px 5px',
              }}
            >
              {h.name && (
                <img src={heroIconUrl(h.name)} alt="" width={18} height={18}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ borderRadius: 2 }} />
              )}
              <span style={{ fontSize: 10 }}>{h.localized_name}</span>
              <span style={{ color: '#93c5fd' }}>×</span>
            </button>
          ))}
        </div>
      )}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search hero to add…"
        style={{
          width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '3px 6px',
          background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', borderRadius: 4,
        }}
      />

      {results.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))', gap: 4, marginTop: 6,
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
                  background: isSelected ? '#1e3a8a' : '#1f2937',
                  border: isSelected ? '1px solid #60a5fa' : '1px solid #374151',
                  borderRadius: 4, color: '#fff', opacity: disabled ? 0.35 : 1,
                }}
              >
                {h.name && (
                  <img src={heroIconUrl(h.name)} alt="" width={28} height={28} loading="lazy"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ borderRadius: 3 }} />
                )}
                <span style={{ fontSize: 9, lineHeight: 1.1, textAlign: 'center' }}>{h.localized_name}</span>
              </button>
            );
          })}
        </div>
      )}

      {q !== '' && results.length === 0 && (
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>No heroes match “{query}”.</div>
      )}
    </div>
  );
}
