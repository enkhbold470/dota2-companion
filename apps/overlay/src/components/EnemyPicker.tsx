export interface HeroOption { id: number; localized_name: string }

export interface EnemyPickerProps {
  heroes: HeroOption[];
  selected: number[];
  onToggle: (heroId: number) => void;
  max?: number;
}

export function EnemyPicker({ heroes, selected, onToggle, max = 5 }: EnemyPickerProps) {
  return (
    <div>
      <div style={{ fontSize: 12, marginBottom: 4 }}>
        Enemy heroes ({selected.length}/{max})
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {heroes.map((h) => {
          const isSelected = selected.includes(h.id);
          const atLimit = selected.length >= max && !isSelected;
          return (
            <button
              key={h.id}
              aria-pressed={isSelected}
              disabled={atLimit}
              onClick={() => onToggle(h.id)}
              style={{
                fontSize: 11, padding: '2px 6px', cursor: atLimit ? 'not-allowed' : 'pointer',
                background: isSelected ? '#2563eb' : '#1f2937', color: '#fff', border: 'none', borderRadius: 4,
                opacity: atLimit ? 0.4 : 1,
              }}
            >
              {h.localized_name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
