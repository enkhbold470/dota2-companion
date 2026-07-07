import { useCallback, useEffect, useRef, useState } from 'react';
import {
  splitDraftByTeam, heroById,
  type DraftSides, type HeroDataMap, type NormalizedState,
} from '@dc/shared';
import { VISION_URL } from '../config';

export type AutoDraftStatus =
  | 'idle'         // nothing to do (no match / already resolved / manually set)
  | 'need-arm'     // draft is up but screen capture isn't armed → prompt the user
  | 'scanning'     // grabbing a frame + asking vision
  | 'retrying'     // last scan failed/partial — another attempt is scheduled
  | 'done'         // enemies/allies set from the scan
  | 'no-key'       // vision has no OpenAI key → fall back to manual
  | 'failed';      // scan failed (out of retries) → fall back to manual

export interface AutoDraftResult {
  status: AutoDraftStatus;
  allies: number[];
  /** Arm capture, then immediately scan (the one-click banner). */
  armAndScan: () => Promise<void>;
  /** Force a re-scan (manual refresh). */
  rescan: () => Promise<void>;
}

interface Deps {
  captureArmed: boolean;
  armCapture: () => Promise<void>;
  grabFrame: (mode?: 'full' | 'draftBar') => Promise<string | null>;
  onEnemies: (ids: number[]) => void;
  enemiesManual: boolean;   // user hand-picked → never auto-overwrite this match
  heroData: HeroDataMap;
}

// Phases where the top hero bar is populated (heroes locked). Includes in_progress
// so opening the app mid-game still auto-detects from the always-visible top bar.
const SCAN_PHASES = new Set(['strategy', 'pre_game', 'in_progress']);

// A failed or partial scan retries itself (bad frame timing, model hiccup) —
// up to MAX_ATTEMPTS per match, spaced so the hero bar has time to settle.
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [4_000, 12_000];

/**
 * Auto-detect enemies + allies from the screen at draft time. GSI can't see the
 * other players, so we grab a cropped frame of the top hero bar and run it
 * through the /vision route (draft mode → {radiant,dire}), then split by our GSI
 * team. Fires at strategy/pre-game with automatic retries on failed or partial
 * reads, plus one re-scan just after the horn to catch late picks. Everything
 * degrades to the manual picker.
 */
export function useAutoDraft(state: NormalizedState | null, deps: Deps): AutoDraftResult {
  const [status, setStatus] = useState<AutoDraftStatus>('idle');
  const [allies, setAllies] = useState<number[]>([]);

  const depsRef = useRef(deps);
  depsRef.current = deps;
  const stateRef = useRef(state);
  stateRef.current = state;

  // Per-match bookkeeping so we don't rescan forever.
  const lastMatch = useRef<string | null>(null);
  const scannedMatch = useRef<string | null>(null);
  const rescannedMatch = useRef<string | null>(null);
  const attempts = useRef(0);
  const bestEnemyCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const clearRetry = useCallback((): void => {
    if (retryTimer.current !== null) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, []);

  const scan = useCallback(async (): Promise<void> => {
    const s = depsRef.current;
    const st = stateRef.current;
    if (inFlight.current || !st) return;
    if (s.enemiesManual) { setStatus('idle'); return; }
    if (!s.captureArmed) { setStatus('need-arm'); return; }
    inFlight.current = true;
    attempts.current += 1;
    setStatus('scanning');

    // Terminal failure only once the retry budget is spent; otherwise schedule
    // another attempt and report 'retrying'.
    const failOrRetry = (): void => {
      if (attempts.current >= MAX_ATTEMPTS) { setStatus('failed'); return; }
      const delay = RETRY_DELAYS_MS[attempts.current - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 12_000;
      clearRetry();
      retryTimer.current = setTimeout(() => { retryTimer.current = null; void scan(); }, delay);
      setStatus('retrying');
    };

    try {
      const image = await s.grabFrame('draftBar');
      if (!image) { failOrRetry(); return; }
      const res = await fetch(VISION_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image, mode: 'draft' }),
      });
      if (res.status === 501) { setStatus('no-key'); return; }
      if (res.status !== 200) { failOrRetry(); return; }
      const draft = (await res.json()) as DraftSides;
      const { enemies, allies: allyIds } = splitDraftByTeam(st.team, draft, st.hero.id, s.heroData);
      if (enemies.length === 0 && allyIds.length === 0) { failOrRetry(); return; }
      // Never downgrade: a later (retry/rescan) read only wins with ≥ enemies.
      if (enemies.length >= bestEnemyCount.current) {
        if (enemies.length > 0) s.onEnemies(enemies);
        setAllies(allyIds);
        bestEnemyCount.current = enemies.length;
      }
      scannedMatch.current = st.matchId;
      if (enemies.length < 5 && attempts.current < MAX_ATTEMPTS) { failOrRetry(); return; }
      setStatus('done');
    } catch {
      failOrRetry();
    } finally {
      inFlight.current = false;
    }
  }, [clearRetry]);

  const armAndScan = useCallback(async () => {
    await depsRef.current.armCapture().catch(() => undefined);
    attempts.current = 0;
    await scan();
  }, [scan]);

  const rescan = useCallback(async () => {
    scannedMatch.current = null;
    attempts.current = 0;
    clearRetry();
    await scan();
  }, [scan, clearRetry]);

  useEffect(() => {
    if (!state) return;
    const match = state.matchId;

    // Match changed → forget the previous scan and clear allies.
    if (match !== lastMatch.current) {
      lastMatch.current = match;
      scannedMatch.current = null;
      rescannedMatch.current = null;
      attempts.current = 0;
      bestEnemyCount.current = 0;
      clearRetry();
      setAllies([]);
      setStatus('idle');
    }

    if (!match || depsRef.current.enemiesManual) return;

    // Primary scan: heroes-locked phase, attempted once per match (marked
    // synchronously so an unarmed attempt doesn't retry every GSI tick — the
    // banner / rescan() / the retry timer are the retry paths).
    if (SCAN_PHASES.has(state.phase) && scannedMatch.current !== match) {
      scannedMatch.current = match;
      void scan();
      return;
    }

    // One re-scan a bit into the game to catch last-second picks / backfills —
    // also when the first pass only read part of the bar.
    if (state.phase === 'in_progress' && (state.clock ?? -1) >= 15
      && scannedMatch.current === match && rescannedMatch.current !== match
      && (status === 'done' || status === 'failed') && bestEnemyCount.current < 5) {
      rescannedMatch.current = match;
      attempts.current = 0;
      void scan();
    }
    // Rescan when the first read succeeded fully? No — 5/5 enemies is final.
  }, [state, scan, status, clearRetry]);

  // Drop any pending retry on unmount.
  useEffect(() => clearRetry, [clearRetry]);

  return { status, allies, armAndScan, rescan };
}

/** Own-hero display name, for banners. */
export function ownHeroName(state: NormalizedState | null): string | null {
  return heroById(state?.hero.id ?? null)?.localizedName ?? null;
}
