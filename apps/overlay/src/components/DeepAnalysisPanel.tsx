import { useEffect, useState } from 'react';
import {
  buildAnalysisContext, formatClock,
  type RecordedSession, type OdMatchSlice,
} from '@dc/shared';
import { t, btn, SectionLabel } from '../theme';
import { ANALYSIS_URL, OPENDOTA_MATCH_URL } from '../config';

export interface DeepAnalysis {
  summary: string;
  moments: { t: number; title: string; insight: string }[];
  tiltPattern: string;
  recommendation: string;
}

type Status = 'idle' | 'running' | 'ok' | 'no-key' | 'error';

const CACHE_PREFIX = 'nf.analysis.';

function readCache(sessionName: string): DeepAnalysis | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + sessionName);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeepAnalysis;
    return typeof parsed.summary === 'string' && Array.isArray(parsed.moments) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * NeuroFocus Intelligence deep analysis of one recorded session: where focus
 * was lost and why, tied to match events. One explicit LLM call per session
 * (cached in localStorage by session filename); moments seek the review video.
 */
export function DeepAnalysisPanel({ session, sessionName, onSeek }: {
  session: RecordedSession;
  sessionName: string;
  onSeek?: (t: number) => void;
}) {
  const [status, setStatus] = useState<Status>('idle');
  const [analysis, setAnalysis] = useState<DeepAnalysis | null>(null);

  // A new session resets the panel; a cached result shows instantly.
  useEffect(() => {
    const cached = readCache(sessionName);
    setAnalysis(cached);
    setStatus(cached ? 'ok' : 'idle');
  }, [sessionName]);

  const run = async (): Promise<void> => {
    setStatus('running');
    try {
      // Best-effort OpenDota enrichment — the gold curve helps the model tie
      // focus dips to the game swinging, but analysis works without it.
      let odMatch: OdMatchSlice | undefined;
      if (session.matchId) {
        try {
          const odRes = await fetch(`${OPENDOTA_MATCH_URL}/${session.matchId}`);
          if (odRes.status === 200) odMatch = (await odRes.json()) as OdMatchSlice;
        } catch { /* enrichment only */ }
      }
      const context = buildAnalysisContext(session, odMatch);
      const res = await fetch(ANALYSIS_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context }),
      });
      if (res.status === 501) { setStatus('no-key'); return; }
      if (res.status !== 200) { setStatus('error'); return; }
      const data = (await res.json()) as DeepAnalysis;
      if (typeof data.summary !== 'string' || !Array.isArray(data.moments)) { setStatus('error'); return; }
      setAnalysis(data);
      setStatus('ok');
      try { localStorage.setItem(CACHE_PREFIX + sessionName, JSON.stringify(data)); } catch { /* ignore */ }
    } catch {
      setStatus('error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.sm }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: t.space.sm }}>
        <SectionLabel tone="ai">NeuroFocus Intelligence</SectionLabel>
        <button
          type="button" onClick={() => void run()} disabled={status === 'running'}
          style={{ ...btn('primary'), marginLeft: 'auto' }}
        >
          {status === 'running' ? 'Analyzing…' : analysis ? '↻ Re-analyze' : '🧠 Deep analysis'}
        </button>
      </div>

      {status === 'idle' && !analysis && (
        <div style={{ fontSize: t.font.sm, color: t.color.textMuted, lineHeight: t.line.normal }}>
          Ask the AI coach to read this session: where your focus dipped, what in the game caused it, and one habit to train.
        </div>
      )}
      {status === 'no-key' && (
        <div style={{ fontSize: t.font.sm, color: t.color.textFaint }}>Needs an OpenAI key (Settings) for deep analysis.</div>
      )}
      {status === 'error' && (
        <div style={{ fontSize: t.font.sm, color: t.color.danger }}>Analysis failed — is the listener running?</div>
      )}

      {analysis && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.md }}>
          <div style={{ fontSize: t.font.base, lineHeight: t.line.normal }}>{analysis.summary}</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.sm }}>
            {analysis.moments.map((m) => (
              <div key={`${m.t}-${m.title}`} style={{ display: 'flex', gap: t.space.sm, alignItems: 'baseline' }}>
                <button
                  type="button"
                  onClick={() => onSeek?.(m.t)}
                  disabled={!onSeek}
                  style={{ ...btn('ghost'), flex: 'none' }}
                  title={onSeek ? 'Jump the video to this moment' : undefined}
                >
                  {formatClock(m.t)}
                </button>
                <div>
                  <strong style={{ fontSize: t.font.base }}>{m.title}</strong>
                  <div style={{ fontSize: t.font.sm, color: t.color.textMuted, lineHeight: t.line.normal }}>{m.insight}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: t.font.sm, color: t.color.textMuted, lineHeight: t.line.normal }}>
            <strong style={{ color: t.brand.stress }}>Tilt pattern:</strong> {analysis.tiltPattern}
          </div>
          <div style={{
            fontSize: t.font.base, lineHeight: t.line.normal,
            background: t.color.inset, borderRadius: t.radius.md, padding: t.space.md,
            borderLeft: `3px solid ${t.brand.focus}`,
          }}>
            <strong>Train next session:</strong> {analysis.recommendation}
          </div>
        </div>
      )}
    </div>
  );
}
