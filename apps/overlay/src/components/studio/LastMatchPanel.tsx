import { useEffect, useState } from 'react';
import {
  heroById, heroImageUrl, itemImageUrl, formatClock, ITEM_IDS,
} from '@dc/shared';
import { t, SectionLabel } from '../../theme';
import { OPENDOTA_MATCH_URL } from '../../config';

/** The slice of an OpenDota match we render. */
interface OdPlayer {
  account_id?: number | null;
  player_slot?: number;
  hero_id?: number;
  kills?: number; deaths?: number; assists?: number;
  last_hits?: number; denies?: number;
  gold_per_min?: number; xp_per_min?: number;
  hero_damage?: number; tower_damage?: number; hero_healing?: number;
  net_worth?: number; level?: number;
  item_0?: number; item_1?: number; item_2?: number; item_3?: number; item_4?: number; item_5?: number;
}
interface OdMatch {
  match_id?: number;
  duration?: number;
  radiant_win?: boolean;
  start_time?: number;
  players?: OdPlayer[];
}

type Status = 'idle' | 'loading' | 'ok' | 'not-found' | 'anonymous' | 'error';

function fmt(n: number | undefined): string {
  if (n === undefined) return '—';
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 64 }}>
      <span style={{ fontSize: t.font.xs, color: t.color.textFaint, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: t.font.md, fontWeight: t.weight.semibold, color: tone ?? t.color.text }}>{value}</span>
    </div>
  );
}

/**
 * Post-game stat sheet for one match, from the listener's OpenDota proxy.
 * GSI only ever shows the local player live — this is where the full,
 * spectator-grade numbers (damage, healing, denies) come from after the game.
 */
export function LastMatchPanel({ matchId, accountId }: { matchId: string | null; accountId: string | null }) {
  const [status, setStatus] = useState<Status>('idle');
  const [match, setMatch] = useState<OdMatch | null>(null);

  useEffect(() => {
    if (!matchId) { setStatus('idle'); setMatch(null); return; }
    let cancelled = false;
    setStatus('loading');
    void (async () => {
      try {
        const res = await fetch(`${OPENDOTA_MATCH_URL}/${matchId}`);
        if (cancelled) return;
        if (res.status !== 200) { setStatus('error'); return; }
        const data = (await res.json()) as OdMatch;
        if (cancelled) return;
        if (typeof data.match_id !== 'number') { setStatus('not-found'); return; }
        setMatch(data);
        setStatus('ok');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [matchId]);

  const me = match?.players?.find((p) => accountId !== null && p.account_id === Number(accountId)) ?? null;
  const isRadiant = me?.player_slot !== undefined ? me.player_slot < 128 : null;
  const won = me && match?.radiant_win !== undefined && isRadiant !== null
    ? match.radiant_win === isRadiant
    : null;
  const hero = heroById(me?.hero_id ?? null);
  const itemKeys = me
    ? [me.item_0, me.item_1, me.item_2, me.item_3, me.item_4, me.item_5]
        .map((id) => (id ? ITEM_IDS[String(id)] : undefined))
        .filter((k): k is string => !!k)
    : [];

  return (
    <div>
      <SectionLabel style={{ marginBottom: t.space.sm }}>Last match</SectionLabel>

      {!matchId && <div style={{ color: t.color.textFaint }}>Play a match to populate this — stats appear here after the game.</div>}
      {matchId && status === 'loading' && <div style={{ color: t.color.textMuted }}>Loading match {matchId}…</div>}
      {status === 'error' && <div style={{ color: t.color.danger }}>Couldn’t reach OpenDota — is the listener running?</div>}
      {status === 'not-found' && <div style={{ color: t.color.textMuted }}>OpenDota doesn’t know match {matchId} yet — try again in a few minutes.</div>}

      {status === 'ok' && match && !me && (
        <div style={{ color: t.color.textMuted }}>
          Match found, but your player row is hidden (anonymous match data). Enable “Expose Public Match Data” in Dota to unlock per-player stats.
        </div>
      )}

      {status === 'ok' && match && me && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.md }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: t.space.md, flexWrap: 'wrap' }}>
            {hero && (
              <img
                src={heroImageUrl(hero.name)} alt={hero.localizedName} width={86} height={48}
                onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                style={{ borderRadius: t.radius.md, background: t.color.inset }}
              />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: t.font.md, fontWeight: t.weight.semibold }}>{hero?.localizedName ?? 'Unknown hero'}</span>
              <span style={{ fontSize: t.font.sm, color: t.color.textMuted }}>
                {match.duration !== undefined ? formatClock(match.duration) : '—'} · {isRadiant ? 'Radiant' : 'Dire'} · level {me.level ?? '—'}
              </span>
            </div>
            {won !== null && (
              <span style={{
                marginLeft: 'auto', fontSize: t.font.md, fontWeight: t.weight.semibold,
                color: won ? t.color.success : t.color.danger,
              }}>
                {won ? 'VICTORY' : 'DEFEAT'}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: t.space.lg, flexWrap: 'wrap' }}>
            <Stat label="K / D / A" value={`${me.kills ?? '—'} / ${me.deaths ?? '—'} / ${me.assists ?? '—'}`} />
            <Stat label="LH / DN" value={`${fmt(me.last_hits)} / ${fmt(me.denies)}`} />
            <Stat label="GPM / XPM" value={`${fmt(me.gold_per_min)} / ${fmt(me.xp_per_min)}`} />
            <Stat label="Net worth" value={fmt(me.net_worth)} tone={t.color.accentText} />
          </div>
          <div style={{ display: 'flex', gap: t.space.lg, flexWrap: 'wrap' }}>
            <Stat label="Hero dmg" value={fmt(me.hero_damage)} />
            <Stat label="Tower dmg" value={fmt(me.tower_damage)} />
            <Stat label="Healing" value={fmt(me.hero_healing)} />
          </div>

          {itemKeys.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap' }}>
              <span style={{ fontSize: t.font.xs, color: t.color.textFaint, textTransform: 'uppercase', letterSpacing: 0.5 }}>Final items</span>
              {itemKeys.map((key, i) => (
                <img
                  key={`${key}-${i}`} src={itemImageUrl(key)} alt={key} title={key} width={40} height={29}
                  onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                  style={{ borderRadius: t.radius.sm, background: t.color.inset }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
