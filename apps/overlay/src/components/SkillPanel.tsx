import { abilityImageUrl, type SkillReadout, type SkillSuggestion } from '@dc/shared';

function AbilityIcon({ abilityKey, size = 20 }: { abilityKey: string; size?: number }) {
  return (
    <img
      src={abilityImageUrl(abilityKey)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
      style={{ borderRadius: 3, flex: 'none' }}
    />
  );
}

const DMG_COLOR: Record<string, string> = {
  Magical: '#a78bfa', Physical: '#f87171', Pure: '#fbbf24',
};
const DMG_LABEL: Record<string, string> = { Magical: 'M', Physical: 'P', Pure: 'Pure' };

export interface SkillPanelProps {
  skills: SkillReadout[];
  nextSkill?: SkillSuggestion | null;
}

export function SkillPanel({ skills, nextSkill }: SkillPanelProps) {
  if (skills.length === 0) return null;
  return (
    <div style={{ fontSize: 12, lineHeight: 1.6 }}>
      {nextSkill && (
        <div style={{ marginBottom: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
          <AbilityIcon abilityKey={nextSkill.key} size={22} />
          <span style={{ fontSize: 11, color: '#0f172a', background: '#4ade80', borderRadius: 3, padding: '0 5px', fontWeight: 600 }}>
            LEVEL UP
          </span>
          <strong>{nextSkill.name}</strong>
          <span style={{ color: '#9ca3af' }}>{nextSkill.reason}</span>
        </div>
      )}
      {skills.map((s) => {
        const pips = '●'.repeat(s.level) + '○'.repeat(Math.max(0, s.maxLevel - s.level));
        const dmgColor = (s.dmgType !== null ? DMG_COLOR[s.dmgType] : undefined) ?? '#9ca3af';
        const dmgLabel = (s.dmgType !== null ? DMG_LABEL[s.dmgType] : undefined) ?? '?';
        return (
          <div
            key={s.key}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', opacity: s.level === 0 ? 0.45 : 1 }}
          >
            <AbilityIcon abilityKey={s.key} />
            <span>{s.name}</span>
            <span style={{ letterSpacing: 1 }}>{pips}</span>
            {s.passive && (
              <span style={{ fontSize: 11, color: '#9ca3af', background: '#1f2937', borderRadius: 3, padding: '0 4px' }}>
                passive
              </span>
            )}
            {s.damage !== null && (
              <span>
                {s.damage}{' '}
                <span style={{ fontSize: 11, color: dmgColor, background: '#1f2937', borderRadius: 3, padding: '0 4px' }}>
                  {dmgLabel}
                </span>
              </span>
            )}
            {s.damageNext !== null && <span style={{ color: '#6b7280' }}>→ {s.damageNext}</span>}
            {s.cooldown !== null && <span style={{ fontSize: 11, color: '#9ca3af' }}>CD {s.cooldown}s</span>}
            {s.manaCost !== null && <span style={{ fontSize: 11, color: '#9ca3af' }}>{s.manaCost} mana</span>}
            {s.remainingCooldown !== null && s.remainingCooldown > 0 && (
              <span style={{ fontSize: 11, color: '#fbbf24' }}>on CD {s.remainingCooldown}s</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
