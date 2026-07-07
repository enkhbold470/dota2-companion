import { useEffect, useState } from 'react';
import { heroById, heroIconUrl, formatClock } from '@dc/shared';
import { t, SectionLabel } from '../../theme';
import { OPENDOTA_RECENT_URL } from '../../config';

interface OdRecentMatch {
  match_id?: number;
  player_slot?: number;
  radiant_win?: boolean;
  hero_id?: number;
  kills?: number; deaths?: number; assists?: number;
  gold_per_min?: number;
  duration?: number;
  start_time?: number; // unix seconds
}

type Status = 'idle' | 'loading' | 'ok' | 'error';

function ago(startTime: number | undefined): string {
  if (!startTime) return '—';
  const mins = Math.max(0, Math.round((Date.now() / 1000 - startTime) / 60));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Recent-match history from OpenDota; a row click loads that match's stat sheet. */
export function RecentMatchesPanel({ accountId, selectedMatchId, onSelect }: {
  accountId: string | null;
  selectedMatchId: string | null;
  onSelect: (matchId: string) => void;
}) {
  const [status, setStatus] = useState<Status>('idle');
  const [matches, setMatches] = useState<OdRecentMatch[]>([]);

  useEffect(() => {
    if (!accountId) { setStatus('idle'); setMatches([]); return; }
    let cancelled = false;
    setStatus('loading');
    void (async () => {
      try {
        const res = await fetch(`${OPENDOTA_RECENT_URL}/${accountId}/recent`);
        if (cancelled) return;
        if (res.status !== 200) { setStatus('error'); return; }
        const data = (await res.json()) as unknown;
        if (cancelled) return;
        setMatches(Array.isArray(data) ? (data as OdRecentMatch[]).slice(0, 12) : []);
        setStatus('ok');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [accountId]);

  return (
    <div>
      <SectionLabel style={{ marginBottom: t.space.sm }}>Recent matches</SectionLabel>

      {!accountId && <div style={{ color: t.color.textFaint }}>Connect once in-game so we learn your account id.</div>}
      {status === 'loading' && <div style={{ color: t.color.textMuted }}>Loading…</div>}
      {status === 'error' && <div style={{ color: t.color.danger }}>Couldn’t reach OpenDota.</div>}
      {status === 'ok' && matches.length === 0 && <div style={{ color: t.color.textMuted }}>No recent matches on OpenDota.</div>}

      {matches.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {matches.map((m) => {
            const hero = heroById(m.hero_id ?? null);
            const won = m.radiant_win !== undefined && m.player_slot !== undefined
              ? m.radiant_win === (m.player_slot < 128)
              : null;
            const id = m.match_id !== undefined ? String(m.match_id) : null;
            const selected = id !== null && id === selectedMatchId;
            return (
              <button
                key={id ?? Math.random()}
                type="button"
                onClick={() => { if (id) onSelect(id); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: t.space.sm, textAlign: 'left',
                  background: selected ? t.color.inset : 'transparent',
                  border: 0, borderBottom: `1px solid ${t.color.border}`, cursor: 'pointer',
                  padding: `${t.space.sm}px ${t.space.xs}px`, color: t.color.text, width: '100%',
                }}
              >
                {hero && (
                  <img
                    src={heroIconUrl(hero.name)} alt={hero.localizedName} title={hero.localizedName}
                    width={24} height={24}
                    onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                    style={{ borderRadius: t.radius.sm, background: t.color.inset, flex: 'none' }}
                  />
                )}
                <span style={{
                  fontSize: t.font.sm, fontWeight: t.weight.semibold, width: 28, flex: 'none',
                  color: won === null ? t.color.textMuted : won ? t.color.success : t.color.danger,
                }}>
                  {won === null ? '—' : won ? 'W' : 'L'}
                </span>
                <span style={{ fontSize: t.font.sm, width: 76, flex: 'none' }}>
                  {m.kills ?? '—'}/{m.deaths ?? '—'}/{m.assists ?? '—'}
                </span>
                <span style={{ fontSize: t.font.sm, color: t.color.textMuted, width: 64, flex: 'none' }}>
                  {m.gold_per_min ?? '—'} gpm
                </span>
                <span style={{ fontSize: t.font.sm, color: t.color.textMuted, width: 48, flex: 'none' }}>
                  {m.duration !== undefined ? formatClock(m.duration) : '—'}
                </span>
                <span style={{ fontSize: t.font.xs, color: t.color.textFaint, marginLeft: 'auto' }}>
                  {ago(m.start_time)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
