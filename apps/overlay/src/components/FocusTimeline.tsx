import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EVENT_KINDS, EVENT_LABEL, type FocusReading, type GameEventKind, type MatchEvent } from '@dc/shared';
import { t, btn } from '../theme';

const H = 200;                 // css px
const PAD = { l: 6, r: 6, top: 16, bottom: 18 };
const MAX_PX_PER_SEC = 40;     // deepest zoom
const AXIS_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900]; // seconds

const EV_COLOR: Record<GameEventKind, string> = {
  game_start: t.brand.ink, game_end: t.color.textFaint,
  kill: t.brand.kill, death: t.brand.death, assist: t.color.accentText,
  respawn: t.color.info, level_up: t.brand.focusBright, battle: t.brand.stress,
  day: t.color.warn, night: t.color.accent,
};

function fmt(sec: number): string {
  const s = Math.round(sec);
  const sign = s < 0 ? '-' : '';
  const a = Math.abs(s);
  return `${sign}${Math.floor(a / 60)}:${(a % 60).toString().padStart(2, '0')}`;
}

interface View { pxPerSec: number; viewStart: number; }

export interface FocusTimelineProps {
  timeline: FocusReading[];
  events: MatchEvent[];
  /** Click (not drag) handler — receives the game-clock second under the cursor. */
  onSeek?: (t: number) => void;
  /** Playhead position (game-clock seconds), e.g. synced to a review video. */
  cursorT?: number | null;
}

/**
 * A video-editor-style timeline: focus + stress lines with colored game-event
 * markers, wheel-to-zoom (around the cursor), drag-to-pan, and a hover readout —
 * so you can scrub to the exact moment focus dropped after a death or a fight.
 * With `onSeek`/`cursorT` it doubles as the scrubber for the review video.
 */
export function FocusTimeline({ timeline, events, onSeek, cursorT }: FocusTimelineProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState<View>({ pxPerSec: 1, viewStart: 0 });
  const [hoverX, setHoverX] = useState<number | null>(null);
  const interacted = useRef(false);
  const drag = useRef<{ x: number; viewStart: number; moved: boolean } | null>(null);
  // Refs so the window-level mouseup sees the live view/handler, not a stale closure.
  const viewRef = useRef(view);
  viewRef.current = view;
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;

  const plotW = Math.max(1, width - PAD.l - PAD.r);
  const tMin = timeline.length ? timeline[0]!.t : 0;
  const tMax = timeline.length ? timeline[timeline.length - 1]!.t : 1;
  const span = Math.max(1, tMax - tMin);

  // Track container width.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return; // jsdom / older envs
    const ro = new ResizeObserver((entries) => setWidth(entries[0]!.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    interacted.current = false;
    setView({ pxPerSec: plotW / span, viewStart: tMin });
  }, [plotW, span, tMin]);

  // Auto-fit until the user zooms/pans (then follow their view).
  useEffect(() => {
    if (!interacted.current && width > 0 && timeline.length > 1) {
      setView({ pxPerSec: plotW / span, viewStart: tMin });
    }
  }, [width, timeline.length, plotW, span, tMin]);

  const clamp = useCallback((v: View): View => {
    const minPx = plotW / span;                 // fully zoomed out = whole session
    const pxPerSec = Math.min(MAX_PX_PER_SEC, Math.max(minPx, v.pxPerSec));
    const windowSec = plotW / pxPerSec;
    const maxStart = Math.max(tMin, tMax - windowSec);
    const viewStart = Math.min(maxStart, Math.max(tMin, v.viewStart));
    return { pxPerSec, viewStart };
  }, [plotW, span, tMin, tMax]);

  const zoomAt = useCallback((clientX: number, factor: number) => {
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = clientX - rect.left - PAD.l;
    interacted.current = true;
    setView((v) => {
      const tAtCursor = v.viewStart + mx / v.pxPerSec;
      const pxPerSec = v.pxPerSec * factor;
      return clamp({ pxPerSec, viewStart: tAtCursor - mx / pxPerSec });
    });
  }, [clamp]);

  // Native wheel listener so we can preventDefault (React onWheel is passive).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Drag to pan; a press that never moves more than a few px is a click → seek.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) <= 4) return;
      d.moved = true;
      interacted.current = true;
      setView((v) => clamp({ ...v, viewStart: d.viewStart - dx / v.pxPerSec }));
    };
    const onUp = (e: MouseEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d || d.moved) return;
      const el = canvasRef.current;
      const seek = onSeekRef.current;
      if (!el || !seek) return;
      const rect = el.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
      const v = viewRef.current;
      seek(v.viewStart + (e.clientX - rect.left - PAD.l) / v.pxPerSec);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [clamp]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, H);

    const { pxPerSec, viewStart } = view;
    const x = (tt: number) => PAD.l + (tt - viewStart) * pxPerSec;
    const y = (score: number) => PAD.top + (1 - score / 100) * (H - PAD.top - PAD.bottom);
    const viewEnd = viewStart + plotW / pxPerSec;

    // Background.
    ctx.fillStyle = t.brand.canvas;
    ctx.fillRect(0, 0, width, H);

    // Time axis.
    const step = AXIS_STEPS.find((s) => s * pxPerSec >= 64) ?? AXIS_STEPS[AXIS_STEPS.length - 1]!;
    ctx.strokeStyle = t.color.border;
    ctx.fillStyle = t.color.textFaint;
    ctx.font = '10px system-ui, sans-serif';
    ctx.lineWidth = 1;
    const first = Math.ceil(viewStart / step) * step;
    for (let tt = first; tt <= viewEnd; tt += step) {
      const px = x(tt);
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(px, PAD.top); ctx.lineTo(px, H - PAD.bottom); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(fmt(tt), px + 2, H - 6);
    }

    if (timeline.length < 2) {
      ctx.fillStyle = t.color.textFaint;
      ctx.fillText('Record a session to build the timeline.', PAD.l + 6, H / 2);
      return;
    }

    // Event markers (draw under the lines).
    for (const e of events) {
      if (e.t < viewStart || e.t > viewEnd) continue;
      const px = x(e.t);
      ctx.strokeStyle = EV_COLOR[e.kind];
      ctx.globalAlpha = e.kind === 'battle' ? 0.35 : 0.7;
      ctx.lineWidth = e.kind === 'battle' ? 3 : 1;
      ctx.beginPath(); ctx.moveTo(px, PAD.top); ctx.lineTo(px, H - PAD.bottom); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = EV_COLOR[e.kind];
      ctx.beginPath(); ctx.arc(px, PAD.top - 4, 2.5, 0, Math.PI * 2); ctx.fill();
    }

    // Focus + stress lines (only points in view, plus one either side).
    const line = (pick: (r: FocusReading) => number, color: string, w: number, glow: boolean) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.shadowColor = glow ? color : 'transparent';
      ctx.shadowBlur = glow ? 6 : 0;
      ctx.beginPath();
      let started = false;
      for (const r of timeline) {
        if (r.t < viewStart - 2 || r.t > viewEnd + 2) continue;
        const px = x(r.t); const py = y(pick(r));
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };
    line((r) => r.stressScore, t.brand.stress, 1.25, false);
    line((r) => r.focusScore, t.brand.focus, 2, true);

    // Playhead (review video position).
    if (cursorT != null && cursorT >= viewStart && cursorT <= viewEnd) {
      const px = x(cursorT);
      ctx.strokeStyle = t.brand.ink;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(px, PAD.top - 8); ctx.lineTo(px, H - PAD.bottom); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = t.brand.ink;
      ctx.beginPath();
      ctx.moveTo(px - 4, PAD.top - 12); ctx.lineTo(px + 4, PAD.top - 12); ctx.lineTo(px, PAD.top - 4);
      ctx.closePath(); ctx.fill();
    }

    // Hover crosshair + readout.
    if (hoverX != null && drag.current == null) {
      const tt = viewStart + (hoverX - PAD.l) / pxPerSec;
      let near: FocusReading | null = null; let best = Infinity;
      for (const r of timeline) { const d = Math.abs(r.t - tt); if (d < best) { best = d; near = r; } }
      if (near) {
        const px = x(near.t);
        ctx.strokeStyle = t.color.borderStrong;
        ctx.beginPath(); ctx.moveTo(px, PAD.top); ctx.lineTo(px, H - PAD.bottom); ctx.stroke();
        const evHere = events.filter((e) => Math.abs(e.t - near!.t) <= Math.max(1, step / 6)).map((e) => EVENT_LABEL[e.kind]);
        const lines = [`${fmt(near.t)}  ·  focus ${near.focusScore}  stress ${near.stressScore}`, ...(evHere.length ? [evHere.join(', ')] : [])];
        ctx.font = '10px system-ui, sans-serif';
        const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 10;
        const bx = Math.min(width - bw - 2, Math.max(2, px + 6));
        const bh = 6 + lines.length * 13;
        ctx.fillStyle = t.color.inset;
        ctx.globalAlpha = 0.95;
        ctx.fillRect(bx, PAD.top, bw, bh);
        ctx.globalAlpha = 1;
        ctx.fillStyle = t.color.text;
        lines.forEach((l, i) => ctx.fillText(l, bx + 5, PAD.top + 13 + i * 13));
      }
    }
  }, [timeline, events, view, width, hoverX, plotW, cursorT]);

  const zoomedIn = view.pxPerSec > plotW / span * 1.02;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.sm }}>
      <div ref={wrapRef} style={{ width: '100%', borderRadius: t.radius.md, overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: H, cursor: drag.current ? 'grabbing' : 'grab' }}
          onMouseDown={(e) => { drag.current = { x: e.clientX, viewStart: view.viewStart, moved: false }; setHoverX(null); }}
          onMouseMove={(e) => { if (!drag.current) setHoverX(e.clientX - e.currentTarget.getBoundingClientRect().left); }}
          onMouseLeave={() => setHoverX(null)}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => zoomAt((canvasRef.current?.getBoundingClientRect().left ?? 0) + width / 2, 1 / 1.4)} style={btn('ghost')} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => zoomAt((canvasRef.current?.getBoundingClientRect().left ?? 0) + width / 2, 1.4)} style={btn('ghost')} aria-label="Zoom in">+</button>
        <button type="button" onClick={fit} style={btn('ghost')} disabled={!zoomedIn}>Fit</button>
        <span style={{ fontSize: t.font.xs, color: t.color.textFaint, marginLeft: 'auto' }}>
          scroll = zoom · drag = pan{onSeek ? ' · click = seek video' : ''}
        </span>
      </div>
      <TimelineLegend events={events} />
    </div>
  );
}

/** Colored key for the event kinds actually present in the session. */
function TimelineLegend({ events }: { events: MatchEvent[] }) {
  const present = new Set(events.map((e) => e.kind));
  const kinds = EVENT_KINDS.filter((k) => present.has(k));
  const shown: GameEventKind[] = kinds.length ? kinds : ['kill', 'death', 'battle'];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.space.md }}>
      <Key color={t.brand.focus} label="Focus" bar />
      <Key color={t.brand.stress} label="Stress β" bar />
      {shown.map((k) => <Key key={k} color={EV_COLOR[k]} label={EVENT_LABEL[k]} />)}
    </div>
  );
}

function Key({ color, label, bar }: { color: string; label: string; bar?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: t.font.sm, color: t.color.textMuted }}>
      <span style={{ width: bar ? 9 : 7, height: bar ? 3 : 7, background: color, borderRadius: bar ? 2 : '50%', display: 'inline-block' }} />
      {label}
    </span>
  );
}
