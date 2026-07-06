import { abilityImageUrl, type SkillReadout, type SkillSuggestion } from '@dc/shared';
import { t, pill } from '../theme';

function AbilityIcon({ abilityKey, size = 20 }: { abilityKey: string; size?: number }) {
  return (
    <img
      src={abilityImageUrl(abilityKey)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
      style={{ borderRadius: t.radius.sm, flex: 'none' }}
    />
  );
}

const DMG_LABEL: Record<string, string> = { Magical: 'M', Physical: 'P', Pure: 'Pure' };

export interface SkillPanelProps {
  skills: SkillReadout[];
  nextSkill?: SkillSuggestion | null;
}

export function SkillPanel({ skills, nextSkill }: SkillPanelProps) {
  if (skills.length === 0) return null;
  return (
    <div style={{ fontSize: t.font.base, lineHeight: t.line.loose, display: 'flex', flexDirection: 'column', gap: t.space.xs }}>
      {nextSkill && (
        <div style={{ marginBottom: t.space.xs, display: 'flex', gap: t.space.sm, alignItems: 'center' }}>
          <AbilityIcon abilityKey={nextSkill.key} size={22} />
          <span style={{ fontSize: t.font.sm, color: '#0f172a', background: t.color.success, borderRadius: t.radius.sm, padding: '0 5px', fontWeight: t.weight.semibold }}>
            LEVEL UP
          </span>
          <strong>{nextSkill.name}</strong>
          <span style={{ color: t.color.textMuted }}>{nextSkill.reason}</span>
        </div>
      )}
      {skills.map((s) => {
        const pips = '●'.repeat(s.level) + '○'.repeat(Math.max(0, s.maxLevel - s.level));
        const dmgColor = (s.dmgType !== null ? t.dmg[s.dmgType] : undefined) ?? t.color.textMuted;
        const dmgLabel = (s.dmgType !== null ? DMG_LABEL[s.dmgType] : undefined) ?? '?';
        return (
          <div
            key={s.key}
            style={{ display: 'flex', flexWrap: 'wrap', gap: t.space.sm, alignItems: 'center', opacity: s.level === 0 ? 0.45 : 1 }}
          >
            <AbilityIcon abilityKey={s.key} />
            <span>{s.name}</span>
            <span style={{ letterSpacing: 1, color: t.color.accent }}>{pips}</span>
            {s.passive && <span style={pill(t.color.textMuted)}>passive</span>}
            {s.damage !== null && (
              <span>
                {s.damage}{' '}
                <span style={pill(dmgColor)}>{dmgLabel}</span>
              </span>
            )}
            {s.damageNext !== null && <span style={{ color: t.color.textFaint }}>→ {s.damageNext}</span>}
            {s.cooldown !== null && <span style={{ fontSize: t.font.sm, color: t.color.textMuted }}>CD {s.cooldown}s</span>}
            {s.manaCost !== null && <span style={{ fontSize: t.font.sm, color: t.color.textMuted }}>{s.manaCost} mana</span>}
            {s.remainingCooldown !== null && s.remainingCooldown > 0 && (
              <span style={{ fontSize: t.font.sm, color: t.color.warn }}>on CD {s.remainingCooldown}s</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
