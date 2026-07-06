import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { matchItemKeys, itemImageUrl, type ItemDataMap, type ItemRecommendation } from '@dc/shared';
import { ItemAdvicePanel } from './ItemAdvicePanel';
import { ITEM_BUILD_URL } from '../config';

interface AiItem { name: string; reason: string }

export interface AiItemPanelProps {
  getContext: () => unknown;
  /** Changes when hero / enemies / role change — drives auto-refresh. */
  signature: string;
  ready: boolean;                 // we know the player's hero yet?
  itemData: ItemDataMap;
  gold: number | null;
  fallbackRecs: ItemRecommendation[]; // deterministic engine, used when there's no key
  hasEnemies: boolean;
  endpoint?: string;
  debounceMs?: number;
}

type Status = 'idle' | 'loading' | 'ok' | 'error' | 'no-key';
type Style = 'meta' | 'fun';

export function AiItemPanel({
  getContext, signature, ready, itemData, gold, fallbackRecs, hasEnemies,
  endpoint = ITEM_BUILD_URL, debounceMs = 1200,
}: AiItemPanelProps) {
  const [items, setItems] = useState<AiItem[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [style, setStyle] = useState<Style>('fun');
  // getContext is a fresh closure each render; keep the latest without retriggering fetches.
  const ctxRef = useRef(getContext);
  ctxRef.current = getContext;
  const styleRef = useRef(style);
  styleRef.current = style;
  const inFlight = useRef(false);

  const fetchBuild = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus('loading');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context: ctxRef.current(), style: styleRef.current }),
      });
      if (res.status === 501) { setStatus('no-key'); return; }
      if (res.status !== 200) { setStatus('error'); return; }
      const data = (await res.json()) as { items?: unknown };
      const list = Array.isArray(data.items)
        ? (data.items as AiItem[]).filter((i) => i && typeof i.name === 'string')
        : [];
      setItems(list);
      setStatus('ok');
    } catch {
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  };

  // Auto-refresh when the draft/hero/role changes (debounced). Never per gold tick.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => { void fetchBuild(); }, debounceMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, ready]);

  if (status === 'no-key') {
    return (
      <div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>
          Add OPENAI_API_KEY on the listener for hero-tuned AI builds — showing rule-based counters:
        </div>
        <ItemAdvicePanel recs={fallbackRecs} gold={gold} hasEnemies={hasEnemies} />
      </div>
    );
  }

  const keys = matchItemKeys(items.map((i) => i.name), itemData);

  const pickStyle = (next: Style) => {
    if (next === style) return;
    setStyle(next);
    styleRef.current = next;
    if (ready) void fetchBuild();
  };
  const styleBtn = (s: Style): CSSProperties => ({
    fontSize: 10, cursor: 'pointer', borderRadius: 4, padding: '0 6px',
    border: '1px solid #374151',
    background: style === s ? (s === 'fun' ? '#7c3aed' : '#2563eb') : '#111827',
    color: style === s ? '#fff' : '#93c5fd',
  });

  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: '#c084fc' }}>
          AI item build
        </span>
        <div style={{ display: 'inline-flex', gap: 3 }}>
          <button type="button" onClick={() => pickStyle('meta')} style={styleBtn('meta')}>Meta</button>
          <button type="button" onClick={() => pickStyle('fun')} style={styleBtn('fun')}>Fun 🎉</button>
        </div>
        <button
          type="button"
          onClick={() => void fetchBuild()}
          disabled={status === 'loading' || !ready}
          style={{ fontSize: 11, cursor: 'pointer', background: '#111827', color: '#93c5fd', border: '1px solid #374151', borderRadius: 4, padding: '0 6px', marginLeft: 'auto' }}
        >
          {status === 'loading' ? '…' : '↻'}
        </button>
      </div>

      {!ready && <div style={{ color: '#6b7280' }}>Waiting for your hero…</div>}
      {ready && status === 'loading' && items.length === 0 && <div style={{ color: '#93c5fd' }}>Thinking…</div>}
      {ready && status === 'error' && <div style={{ color: '#f87171' }}>Coach unavailable — is the listener running?</div>}
      {ready && status === 'ok' && items.length === 0 && <div style={{ color: '#9ca3af' }}>No build returned — try refresh.</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {items.map((it, idx) => {
          const key = keys[idx];
          const cost = key ? itemData[key]?.cost ?? null : null;
          const affordable = gold !== null && cost !== null && gold >= cost;
          return (
            <div key={`${it.name}-${idx}`} style={{ display: 'flex', gap: 6 }}>
              {key && (
                <img
                  src={itemImageUrl(key)} alt="" width={33} height={24} loading="lazy"
                  onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                  style={{ borderRadius: 3, flex: 'none', marginTop: 1 }}
                />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline' }}>
                  <strong>{it.name}</strong>
                  {cost !== null && <span style={{ color: '#9ca3af' }}>{cost}g</span>}
                  {affordable && (
                    <span style={{ fontSize: 11, color: '#4ade80', background: '#1f2937', borderRadius: 3, padding: '0 4px' }}>
                      BUY NOW
                    </span>
                  )}
                </div>
                {it.reason && <div style={{ fontSize: 11, color: '#9ca3af' }}>{it.reason}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
