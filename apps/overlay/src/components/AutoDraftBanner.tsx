import { heroIconUrl, type HeroDataMap } from '@dc/shared';
import { t, btn, SectionLabel } from '../theme';
import type { AutoDraftResult } from '../eeg/useAutoDraft';

/**
 * Auto draft status + the read-only ally row. Enemies flow into the threat/item
 * engines as before; allies are shown here for context. When capture isn't armed
 * at draft, offers a one-click "Enable auto-detect" that arms + scans.
 */
export function AutoDraftBanner({ auto, allies, heroData }: {
  auto: AutoDraftResult;
  allies: number[];
  heroData: HeroDataMap;
}) {
  const { status } = auto;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.sm }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap' }}>
        <SectionLabel tone="ai">Auto draft</SectionLabel>
        {status === 'scanning' && <span style={{ fontSize: t.font.xs, color: t.color.accentText }}>reading the draft…</span>}
        {status === 'done' && <span style={{ fontSize: t.font.xs, color: t.color.success }}>detected ✓</span>}
        {status === 'no-key' && <span style={{ fontSize: t.font.xs, color: t.color.textFaint }}>needs an OpenAI key — pick manually below</span>}
        {status === 'failed' && (
          <>
            <span style={{ fontSize: t.font.xs, color: t.color.textFaint }}>couldn’t read it — pick below or</span>
            <button type="button" onClick={() => void auto.rescan()} style={btn('ghost')}>Retry</button>
          </>
        )}
        {status === 'done' && (
          <button type="button" onClick={() => void auto.rescan()} style={{ ...btn('ghost'), marginLeft: 'auto' }}>Re-scan</button>
        )}
      </div>

      {status === 'need-arm' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap',
          background: t.color.inset, border: `1px solid ${t.color.borderStrong}`,
          borderRadius: t.radius.md, padding: `${t.space.sm}px ${t.space.md}px`,
        }}>
          <span style={{ fontSize: t.font.sm, color: t.color.textMuted, flex: 1 }}>
            Enable one-click screen read to auto-detect both teams this game.
          </span>
          <button type="button" onClick={() => void auto.armAndScan()} style={btn('primary')}>🎥 Enable auto-detect</button>
        </div>
      )}

      {allies.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap' }}>
          <span style={{ fontSize: t.font.xs, color: t.color.textFaint, textTransform: 'uppercase', letterSpacing: 0.5 }}>Allies</span>
          {allies.map((id) => {
            const hero = heroData[String(id)];
            const label = hero?.localizedName ?? `#${id}`;
            return hero?.name
              ? <img key={id} src={heroIconUrl(hero.name)} alt={label} title={label} width={26} height={26}
                  style={{ borderRadius: t.radius.sm, background: t.color.inset }} />
              : <span key={id} title={label} style={{ fontSize: t.font.sm, color: t.color.textMuted }}>{label}</span>;
          })}
        </div>
      )}
    </div>
  );
}
