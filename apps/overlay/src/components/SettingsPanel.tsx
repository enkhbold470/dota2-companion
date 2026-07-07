import { useEffect, useState } from 'react';
import { t, btn, inputStyle, SectionLabel } from '../theme';
import { SETTINGS_URL, OPENAI_KEY_URL, OPENDOTA_PATCH_URL } from '../config';
import type { FocusSession } from '../eeg/useFocusSession';

const RAW_PATH_KEY = 'nf.rawPath';
export const SETUP_DONE_KEY = 'nf.setupDone';

type Save = 'idle' | 'saving' | 'ok' | 'bad-key' | 'error';

interface SettingsStatus {
  openaiKeySet?: boolean;
  version?: string | null;
  updater?: { state: string; info: string | null } | null;
  data?: { gamePatch: string; dataVersion: string } | null;
}

function updaterLabel(u: { state: string; info: string | null } | null | undefined): string {
  if (!u) return '';
  switch (u.state) {
    case 'checking': return 'Checking…';
    case 'up-to-date': return 'Up to date ✓';
    case 'available': return `v${u.info ?? '?'} available — see the prompt`;
    case 'downloading': return `Downloading… ${u.info ?? ''}`;
    case 'downloaded': return `v${u.info ?? '?'} ready — restart to install`;
    case 'error': return `Update error: ${u.info ?? 'unknown'}`;
    case 'dev': return 'dev build (no update feed)';
    default: return '';
  }
}

/** Reads the persisted raw-EEG folder path (client option). */
export function getRawDataPath(): string {
  try { return localStorage.getItem(RAW_PATH_KEY) ?? ''; } catch { return ''; }
}

export interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  session: FocusSession;
}

/**
 * First-time setup + settings. Configures the OpenAI key (saved to the listener,
 * hot-swapped without a restart) and the EEG headset + raw-data path. Rendered as
 * a modal over the overlay.
 */
export function SettingsPanel({ open, onClose, session }: SettingsPanelProps) {
  const [keySet, setKeySet] = useState<boolean | null>(null);
  const [key, setKey] = useState('');
  const [save, setSave] = useState<Save>('idle');
  const [rawPath, setRawPath] = useState(getRawDataPath());
  const [about, setAbout] = useState<SettingsStatus | null>(null);
  const [livePatch, setLivePatch] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSave('idle');
    fetch(SETTINGS_URL)
      .then((r) => (r.ok ? (r.json() as Promise<SettingsStatus>) : null))
      .then((d) => { setKeySet(d?.openaiKeySet ?? false); setAbout(d); })
      .catch(() => setKeySet(null));
    // Latest live game patch via the OpenDota proxy (cached listener-side for
    // 24 h) — lets us flag when the bundled coaching data lags the game.
    fetch(OPENDOTA_PATCH_URL)
      .then((r) => (r.ok ? (r.json() as Promise<{ name?: string }[]>) : null))
      .then((patches) => {
        const latest = patches?.[patches.length - 1]?.name;
        if (typeof latest === 'string') setLivePatch(latest);
      })
      .catch(() => undefined);
  }, [open]);

  // Kick a manual update check, then poll so progress/errors show inline.
  const checkUpdates = async () => {
    try { await fetch(`${SETTINGS_URL}/check-updates`, { method: 'POST' }); } catch { return; }
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const d = (await (await fetch(SETTINGS_URL)).json()) as SettingsStatus;
        setAbout(d);
        if (d.updater && ['up-to-date', 'error', 'downloaded'].includes(d.updater.state)) break;
      } catch { break; }
    }
  };

  if (!open) return null;

  const saveKey = async () => {
    setSave('saving');
    try {
      const res = await fetch(OPENAI_KEY_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: key.trim() }),
      });
      if (res.status === 400) { setSave('bad-key'); return; }
      if (!res.ok) { setSave('error'); return; }
      const d = (await res.json()) as { openaiKeySet?: boolean };
      setKeySet(d.openaiKeySet ?? true);
      setKey('');
      setSave('ok');
    } catch { setSave('error'); }
  };

  const saveRawPath = (v: string) => {
    setRawPath(v);
    try { localStorage.setItem(RAW_PATH_KEY, v); } catch { /* ignore */ }
  };

  const done = () => {
    try { localStorage.setItem(SETUP_DONE_KEY, '1'); } catch { /* ignore */ }
    onClose();
  };

  return (
    <div
      onClick={done}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: t.space.lg, overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420, background: t.color.panel, border: `1px solid ${t.color.border}`,
          borderRadius: t.radius.lg, padding: t.space.lg, display: 'flex', flexDirection: 'column', gap: t.space.lg,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: t.font.md, fontWeight: t.weight.semibold }}>Setup &amp; settings</span>
          <button type="button" onClick={done} style={{ ...btn('ghost'), marginLeft: 'auto' }}>Done</button>
        </div>

        {/* --- OpenAI key --- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.sm }}>
          <SectionLabel tone="ai">OpenAI API key</SectionLabel>
          <div style={{ fontSize: t.font.sm, color: t.color.textMuted, lineHeight: t.line.normal }}>
            Powers AI item builds, hero vision &amp; the coach. Stored locally on the listener — never bundled or shared.{' '}
            {keySet === true && <span style={{ color: t.color.success }}>Configured ✓</span>}
            {keySet === false && <span style={{ color: t.brand.stress }}>Not set</span>}
          </div>
          <div style={{ display: 'flex', gap: t.space.sm }}>
            <input
              type="password" value={key} onChange={(e) => setKey(e.target.value)}
              placeholder="sk-…" autoComplete="off" spellCheck={false} style={{ ...inputStyle, flex: 1 }}
            />
            <button type="button" onClick={() => void saveKey()} disabled={save === 'saving' || key.trim() === ''} style={btn('primary')}>
              {save === 'saving' ? 'Saving…' : 'Save'}
            </button>
          </div>
          {save === 'ok' && <div style={{ fontSize: t.font.sm, color: t.color.success }}>Saved — AI is live.</div>}
          {save === 'bad-key' && <div style={{ fontSize: t.font.sm, color: t.brand.death }}>That doesn’t look like a valid key (sk-…).</div>}
          {save === 'error' && <div style={{ fontSize: t.font.sm, color: t.brand.death }}>Couldn’t reach the listener.</div>}
        </div>

        {/* --- EEG headset --- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.sm }}>
          <SectionLabel tone="ai">NeuroFocus headset (EEG)</SectionLabel>
          <div style={{ fontSize: t.font.sm, color: t.color.textMuted, lineHeight: t.line.normal }}>
            Streams live focus once connected. To capture the raw signal, hit{' '}
            <strong>● Record</strong> in the focus strip at match start and <strong>Stop &amp; save</strong> when
            it ends — or turn on <strong>Auto-record</strong> below to start/stop with the game.
            Opt-in; neural data stays on this machine.
          </div>
          <div style={{ display: 'flex', gap: t.space.sm, alignItems: 'center', flexWrap: 'wrap' }}>
            {session.mode === 'off'
              ? <button type="button" onClick={() => void session.connect()} style={btn('primary')}>Connect headset</button>
              : <button type="button" onClick={() => void session.disconnect()} style={btn('ghost')}>Disconnect</button>}
            <span style={{ fontSize: t.font.sm, color: t.color.textFaint }}>
              {session.deviceName ? `${session.deviceName} · ${session.status}` : session.status}
            </span>
          </div>
        </div>

        {/* --- Gameplay video --- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.sm }}>
          <SectionLabel tone="ai">Gameplay video (screen recording)</SectionLabel>
          <div style={{ fontSize: t.font.sm, color: t.color.textMuted, lineHeight: t.line.normal }}>
            Arm capture once, and every recorded session also saves a .webm of your screen —
            the review timeline then jumps the video to the moment focus dropped. Stays on this
            machine, saved next to the session file.
          </div>
          <div style={{ display: 'flex', gap: t.space.sm, alignItems: 'center', flexWrap: 'wrap' }}>
            {session.captureArmed
              ? <button type="button" onClick={session.disarmCapture} style={btn('ghost')}>Disarm capture</button>
              : <button type="button" onClick={() => void session.armCapture().catch(() => undefined)} style={btn('primary')}>🎥 Arm screen capture</button>}
            <span style={{ fontSize: t.font.sm, color: session.captureArmed ? t.color.success : t.color.textFaint }}>
              {session.captureArmed ? 'armed — recordings include video' : 'not armed'}
            </span>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: t.space.sm, fontSize: t.font.sm, color: t.color.textMuted, cursor: 'pointer' }}>
            <input
              type="checkbox" checked={session.autoRecord}
              onChange={(e) => session.setAutoRecord(e.target.checked)}
            />
            Auto-record matches (start at the horn, stop &amp; save at game end)
          </label>
        </div>

        {/* --- Raw-data path (client option) --- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.sm }}>
          <SectionLabel>Raw EEG data folder</SectionLabel>
          <div style={{ fontSize: t.font.sm, color: t.color.textMuted, lineHeight: t.line.normal }}>
            Where per-match raw signal (<code>neurofocus_ble_eeg_v2</code>) and gameplay video are
            saved so you can compute your own features from the local stream.
          </div>
          <input
            value={rawPath} onChange={(e) => saveRawPath(e.target.value)}
            placeholder="e.g. C:\\Users\\you\\NeuroFocus\\dota" style={inputStyle}
          />
        </div>

        {/* --- About / updates --- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.sm, borderTop: `1px solid ${t.color.border}`, paddingTop: t.space.md }}>
          {about?.data && (
            <div style={{ fontSize: t.font.sm, color: t.color.textMuted }}>
              NeuroFocus Intelligence — powered by game patch <strong style={{ color: t.color.accentText }}>{about.data.gamePatch}</strong>
              {livePatch !== null && livePatch !== about.data.gamePatch && (
                <span style={{ color: t.brand.stress }}>
                  {' '}· live patch is {livePatch} — data may lag (run <code>pnpm up dotaconstants &amp;&amp; pnpm gen-data</code> when upstream catches up)
                </span>
              )}
              {livePatch !== null && livePatch === about.data.gamePatch && (
                <span style={{ color: t.color.success }}> · up to date with the live game ✓</span>
              )}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap' }}>
            <span style={{ fontSize: t.font.sm, color: t.color.textMuted }}>
              NeuroFocus — Dota 2 NeuroSync{about?.version ? ` v${about.version}` : ' (dev)'}
            </span>
            {about?.version != null && (
              <button type="button" onClick={() => void checkUpdates()} style={btn('ghost')}>
                Check for updates
              </button>
            )}
            <span style={{
              fontSize: t.font.xs,
              color: about?.updater?.state === 'error' ? t.brand.death : t.color.textFaint,
            }}>
              {updaterLabel(about?.updater)}
            </span>
          </div>
          <div style={{ display: 'flex', gap: t.space.md, fontSize: t.font.xs }}>
            <a href="https://neurofocus.dev" target="_blank" rel="noreferrer" style={{ color: t.color.textFaint }}>neurofocus.dev</a>
            <a href="https://neurofocus.dev/privacy" target="_blank" rel="noreferrer" style={{ color: t.color.textFaint }}>Privacy</a>
            <a href="https://neurofocus.dev/terms" target="_blank" rel="noreferrer" style={{ color: t.color.textFaint }}>Terms</a>
          </div>
        </div>
      </div>
    </div>
  );
}
