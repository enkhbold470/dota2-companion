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
  | 'done'         // enemies/allies set from the scan
  | 'no-key'       // vision has no OpenAI key → fall back to manual
  | 'failed';      // scan failed → fall back to manual

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
  grabFrame: () => Promise<string | null>;
  onEnemies: (ids: number[]) => void;
  enemiesManual: boolean;   // user hand-picked → never auto-overwrite this match
  heroData: HeroDataMap;
}

// Phases where the top hero bar is populated (heroes locked). Includes in_progress
// so opening the app mid-game still auto-detects from the always-visible top bar.
const SCAN_PHASES = new Set(['strategy', 'pre_game', 'in_progress']);

/**
 * Auto-detect enemies + allies from the screen at draft time. GSI can't see the
 * other players, so we grab one frame of the top hero bar and run it through the
 * /vision route (draft mode → {radiant,dire}), then split by our GSI team. Fires
 * once per match at strategy/pre-game, with one re-scan just after the horn to
 * catch late picks. Everything degrades to the manual picker.
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
  const inFlight = useRef(false);

  const scan = useCallback(async (): Promise<void> => {
    const s = depsRef.current;
    const st = stateRef.current;
    if (inFlight.current || !st) return;
    if (s.enemiesManual) { setStatus('idle'); return; }
    if (!s.captureArmed) { setStatus('need-arm'); return; }
    inFlight.current = true;
    setStatus('scanning');
    try {
      const image = await s.grabFrame();
      if (!image) { setStatus('failed'); return; }
      const res = await fetch(VISION_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image, mode: 'draft' }),
      });
      if (res.status === 501) { setStatus('no-key'); return; }
      if (res.status !== 200) { setStatus('failed'); return; }
      const draft = (await res.json()) as DraftSides;
      const { enemies, allies: allyIds } = splitDraftByTeam(st.team, draft, st.hero.id, s.heroData);
      if (enemies.length === 0 && allyIds.length === 0) { setStatus('failed'); return; }
      if (enemies.length > 0) s.onEnemies(enemies);
      setAllies(allyIds);
      scannedMatch.current = st.matchId;
      setStatus('done');
    } catch {
      setStatus('failed');
    } finally {
      inFlight.current = false;
    }
  }, []);

  const armAndScan = useCallback(async () => {
    await depsRef.current.armCapture().catch(() => undefined);
    await scan();
  }, [scan]);

  const rescan = useCallback(async () => {
    scannedMatch.current = null;
    await scan();
  }, [scan]);

  useEffect(() => {
    if (!state) return;
    const match = state.matchId;

    // Match changed → forget the previous scan and clear allies.
    if (match !== lastMatch.current) {
      lastMatch.current = match;
      scannedMatch.current = null;
      rescannedMatch.current = null;
      setAllies([]);
      setStatus('idle');
    }

    if (!match || depsRef.current.enemiesManual) return;

    // Primary scan: heroes-locked phase, attempted once per match (marked
    // synchronously so a failed/unarmed attempt doesn't retry every GSI tick — the
    // banner / rescan() are the retry paths).
    if (SCAN_PHASES.has(state.phase) && scannedMatch.current !== match) {
      scannedMatch.current = match;
      void scan();
      return;
    }

    // One re-scan a bit into the game to catch last-second picks / backfills, but
    // only if the first attempt actually succeeded.
    if (state.phase === 'in_progress' && (state.clock ?? -1) >= 15
      && scannedMatch.current === match && rescannedMatch.current !== match
      && status === 'done') {
      rescannedMatch.current = match;
      void scan();
    }
  }, [state, scan, status]);

  return { status, allies, armAndScan, rescan };
}

/** Own-hero display name, for banners. */
export function ownHeroName(state: NormalizedState | null): string | null {
  return heroById(state?.hero.id ?? null)?.localizedName ?? null;
}
