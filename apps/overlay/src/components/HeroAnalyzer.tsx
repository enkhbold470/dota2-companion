import { useEffect, useRef, useState } from 'react';
import { matchHeroNames, heroIconUrl, type HeroDataMap } from '@dc/shared';
import { t, btn, SectionLabel } from '../theme';
import { VISION_URL } from '../config';

export interface HeroAnalyzerProps {
  heroData: HeroDataMap;
  onHeroesDetected: (ids: number[]) => void;
  ownHeroId?: number | null;    // your hero, from GSI — excluded from enemies
  ownHeroName?: string | null;  // passed to vision so it returns the opposing team
  endpoint?: string;
}

const NO_KEY = 'Add OPENAI_API_KEY on the listener to enable screenshot analysis (GPT-4o vision).';
const UNAVAILABLE = 'Analyzer unavailable — is the listener running?';
const UPSTREAM = 'Vision error — check the OpenAI key/quota on the listener.';
const TOO_BIG = 'Image too large — crop to just the heroes and retry.';
const MAX_BYTES = 6_000_000;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

// Shrink to a sane width + JPEG so the POST stays small and vision is fast.
// Falls back to the raw data URL where canvas/createImageBitmap aren't available.
async function toUploadDataUrl(blob: Blob): Promise<string> {
  const raw = await blobToDataUrl(blob);
  try {
    if (typeof createImageBitmap !== 'function') return raw;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return raw;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 1280 / bitmap.width);
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return raw;
  }
}

export function HeroAnalyzer({
  heroData, onHeroesDetected, ownHeroId = null, ownHeroName = null,
  endpoint = VISION_URL,
}: HeroAnalyzerProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detected, setDetected] = useState<{ id: number; name: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  // Keep the latest own-hero without re-subscribing the paste listener.
  const ownRef = useRef({ id: ownHeroId, name: ownHeroName });
  ownRef.current = { id: ownHeroId, name: ownHeroName };

  const analyze = async (dataUrl: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setStatus('Analyzing screenshot…');
    setDetected([]);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: dataUrl, ownHero: ownRef.current.name }),
      });
      if (res.status === 501) { setStatus(NO_KEY); return; }
      if (res.status === 400) { setStatus(TOO_BIG); return; }
      if (res.status !== 200) { setStatus(UPSTREAM); return; }
      const data = (await res.json()) as { heroes?: unknown };
      const names = Array.isArray(data.heroes)
        ? (data.heroes as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      // Never treat your own hero as an enemy, even if it slips into the frame.
      const ids = matchHeroNames(names, heroData).filter((id) => id !== ownRef.current.id);
      if (ids.length === 0) {
        setStatus('No enemy heroes recognized — crop to just the enemy team, or pick below.');
        return;
      }
      onHeroesDetected(ids);
      setDetected(ids.map((id) => ({ id, name: heroData[String(id)]?.localizedName ?? `#${id}` })));
      setStatus(null);
    } catch {
      setStatus(UNAVAILABLE);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleBlob = async (blob: Blob | null | undefined) => {
    if (!blob) return;
    if (!blob.type.startsWith('image/')) { setStatus('That is not an image.'); return; }
    if (blob.size > MAX_BYTES) { setStatus(TOO_BIG); return; }
    try {
      void analyze(await toUploadDataUrl(blob));
    } catch {
      setStatus('Could not read that image.');
    }
  };

  // Paste anywhere on the page (Win+Shift+S → Ctrl+V). Ignore non-image pastes
  // so typing in the Ask box is unaffected.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const dt = e.clipboardData;
      if (!dt) return;
      const item = Array.from(dt.items).find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile() ?? Array.from(dt.files).find((f) => f.type.startsWith('image/'));
      if (file) { e.preventDefault(); void handleBlob(file); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroData]);

  return (
    <div style={{ fontSize: t.font.base, display: 'flex', flexDirection: 'column', gap: t.space.sm }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: t.space.md, flexWrap: 'wrap' }}>
        <SectionLabel tone="ai">Detect enemies from screenshot</SectionLabel>
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} style={btn('ghost')}>
          Upload
        </button>
        <span style={{ color: t.color.textFaint, fontSize: t.font.sm }}>Ctrl+V a shot of the enemy team (Win+Shift+S)</span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => void handleBlob(e.target.files?.[0])}
        />
      </div>

      {(busy || status) && (
        <div style={{ color: busy ? t.color.accentText : t.color.text }}>{busy ? 'Analyzing…' : status}</div>
      )}

      {detected.length > 0 && (
        <div style={{ display: 'flex', gap: t.space.sm, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: t.color.success, fontSize: t.font.sm }}>Detected:</span>
          {detected.map((d) => {
            const npc = heroData[String(d.id)]?.name;
            return (
              <span key={d.id} style={{ display: 'inline-flex', alignItems: 'center', gap: t.space.xs }} title={d.name}>
                {npc && (
                  <img
                    src={heroIconUrl(npc)} alt="" width={20} height={20}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    style={{ borderRadius: t.radius.sm }}
                  />
                )}
                <span style={{ fontSize: t.font.sm }}>{d.name}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
