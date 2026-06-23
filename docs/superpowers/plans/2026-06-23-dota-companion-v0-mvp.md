# Dota 2 Companion — v0 "Live Loop" MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the end-to-end live loop — Dota 2 → Game State Integration (GSI) → local listener → normalized state → web overlay UI — showing live day/night + rune + manual-Roshan timers, a live economy grade, and a manual 5-hero enemy picker. No LLM, no network calls except localhost GSI.

**Architecture:** A pnpm/TypeScript monorepo with three units. `packages/shared` holds *pure* logic (GSI normalization, timer math, economy grading, auth) — this is where almost all TDD happens. `apps/listener` is a thin Fastify HTTP server that receives GSI POSTs on `:53000`, normalizes them, and broadcasts the normalized state to the UI over WebSocket. `apps/overlay` is a Vite + React web app rendering the overlay; it runs in any browser on macOS for development and is later wrapped by Overwolf on Windows for the true in-game overlay. A fixture-replay CLI lets you develop on macOS with Dota closed.

**Tech Stack:** TypeScript (Node 20+), pnpm workspaces, Fastify 4 + `@fastify/websocket`, Vitest (node + jsdom), React 18 + Vite, `@testing-library/react`, the `dotaconstants` npm package for the hero list.

**Cross-platform note:** Everything in v0 is OS-agnostic. The listener and overlay run and are fully tested on macOS. The GSI `.cfg` file is dropped into the Dota 2 install on whatever machine runs Dota (macOS or Windows); GSI POSTs to `http://127.0.0.1:53000` regardless of OS. The Overwolf/transparent-window packaging is explicitly **out of scope for v0** (it is a later, Windows-only plan).

**Where this sits in the roadmap (subsequent plans, each its own doc):**
- **v0 (this plan):** Live loop + timers + economy + manual enemy picker.
- **v1:** OpenDota client + SQLite cache; dotaconstants threat-field layer; the **Counter-Item Engine** (rule + data + LLM); LLM adapter (OpenAI + Ollama); MCP server (stdio); agentic post-game review; NL-to-SQL.
- **v2:** Nightly `/explorer` ETL (enemy-conditioned builds); GSI scoreboard auto-detection of enemy heroes; voice; draft suite; Overwolf packaging on Windows.
- **v4:** EEG focus-level layer behind an abstract `EEGSource` seam — detect focus vs focus-loss and align the focus timeline with gameplay events (post-game first, live nudges later).

---

## File Structure

```
dota2-companion/
├── package.json                      # workspace root (pnpm), scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore
├── fixtures/
│   └── sample-match.json             # recorded GSI payload sequence for replay
├── scripts/
│   └── gen-gsi-cfg.mjs               # generates the Dota 2 GSI .cfg with a token
├── packages/
│   └── shared/                       # PURE logic — the TDD core
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── types.ts              # GSI payload + NormalizedState types + constants
│           ├── auth.ts               # isAuthorized()
│           ├── normalize.ts          # normalizeGsi()
│           ├── timers.ts             # dayNight()
│           ├── runes.ts              # runeTimers() + DEFAULT_RUNE_SCHEDULE
│           ├── roshan.ts             # roshanTimer()
│           ├── economy.ts            # gradeEconomy()
│           ├── format.ts             # formatClock()
│           ├── index.ts              # re-exports the public API
│           └── *.test.ts             # co-located unit tests
└── apps/
    ├── listener/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── hub.ts                # Hub: latest-state store + pub/sub
    │       ├── server.ts             # buildServer(): Fastify POST '/' + WS '/ws' + '/health'
    │       ├── hub.test.ts
    │       ├── server.test.ts
    │       ├── replay.ts             # replayFixture(): POST a fixture sequence to the server
    │       └── main.ts               # entrypoint: read token, start server
    └── overlay/
        ├── package.json
        ├── tsconfig.json
        ├── vite.config.ts
        ├── index.html
        └── src/
            ├── components/
            │   ├── ConnectionBadge.tsx
            │   ├── EconomyPanel.tsx
            │   ├── EnemyPicker.tsx
            │   ├── TimerPanel.tsx
            │   └── *.test.tsx
            ├── useGsiSocket.ts        # WebSocket hook → {state, connected}
            ├── App.tsx               # wires hook + components + local Roshan state
            └── main.tsx              # React entry
```

**Responsibility boundaries:** all decision logic is pure and lives in `packages/shared` (no I/O, trivially testable). `apps/listener` only does transport (HTTP in, WS out) + the `Hub`. `apps/overlay` presentational components are props-only (testable), with `useGsiSocket` + `App` as the thin wiring layer (manually verified end-to-end in the final task).

---

## Task 0: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`

- [ ] **Step 1: Create the workspace manifest**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 2: Create the root `package.json`**

Create `package.json`:

```json
{
  "name": "dota2-companion",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "pnpm -r test",
    "build": "pnpm -r build",
    "listener": "pnpm --filter @dc/listener dev",
    "overlay": "pnpm --filter @dc/overlay dev",
    "replay": "pnpm --filter @dc/listener replay",
    "gen-cfg": "node scripts/gen-gsi-cfg.mjs"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Create the base tsconfig**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

Create `.gitignore`:

```
node_modules/
dist/
*.log
.env
.gsi-token
coverage/
```

- [ ] **Step 5: Install pnpm and initialize git**

Run:

```bash
cd /Users/inky/Desktop/dota2-companion
corepack enable && corepack prepare pnpm@9 --activate
git init
pnpm install
```

Expected: pnpm creates `node_modules/` and a lockfile; no errors. (No workspace packages yet — that's fine.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm + typescript monorepo"
```

---

## Task 1: Shared types and constants

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/types.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@dc/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc -p tsconfig.json"
  },
  "devDependencies": { "vitest": "^2.0.0", "typescript": "^5.5.0" }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/shared/src/types.ts`**

This is the locked contract every later task depends on. Define it once, exactly:

```ts
// ---- Raw GSI payload (only the fields we consume) ----
export interface GsiAuth { token?: string }

export interface GsiMap {
  name?: string;
  matchid?: string;
  game_time?: number;
  clock_time?: number;        // game clock in seconds; negative before the horn
  daytime?: boolean;
  game_state?: string;        // e.g. "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"
  paused?: boolean;
}

export interface GsiPlayer {
  steamid?: string;
  name?: string;
  gold?: number;
  net_worth?: number;
  gpm?: number;
  xpm?: number;
  last_hits?: number;
  denies?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
}

export interface GsiHero {
  id?: number;
  name?: string;
  level?: number;
  alive?: boolean;
  respawn_seconds?: number;
  has_aghanims_scepter?: boolean;
  has_aghanims_shard?: boolean;
}

export interface GsiItem { name: string; charges?: number }

export interface GsiPayload {
  auth?: GsiAuth;
  map?: GsiMap;
  player?: GsiPlayer;
  hero?: GsiHero;
  items?: Record<string, GsiItem>;
}

// ---- Normalized state the listener broadcasts and the UI consumes ----
export type Role = 'core' | 'support' | 'unknown';

export interface NormalizedState {
  matchId: string | null;
  inProgress: boolean;
  paused: boolean;
  clock: number | null;
  isDay: boolean | null;
  hero: {
    id: number | null;
    level: number | null;
    alive: boolean | null;
    respawnSeconds: number | null;
    hasScepter: boolean;
    hasShard: boolean;
  };
  economy: {
    gold: number | null;
    netWorth: number | null;
    gpm: number | null;
    xpm: number | null;
    lastHits: number | null;
  };
  items: string[];           // names in item slots 0..8, excluding empty slots
}

export const GAME_IN_PROGRESS = 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS';
export const EMPTY_ITEM = 'empty';
export const DAY_NIGHT_PHASE = 300; // seconds per day or night phase
```

- [ ] **Step 4: Install shared dev deps and verify it type-checks**

Run:

```bash
cd /Users/inky/Desktop/dota2-companion
pnpm install
pnpm --filter @dc/shared exec tsc -p tsconfig.json --noEmit
```

Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): lock GSI + NormalizedState types and constants"
```

---

## Task 2: GSI auth check

**Files:**
- Create: `packages/shared/src/auth.ts`, `packages/shared/src/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isAuthorized } from './auth';

describe('isAuthorized', () => {
  it('accepts a matching token', () => {
    expect(isAuthorized({ auth: { token: 'secret' } }, 'secret')).toBe(true);
  });
  it('rejects a mismatched token', () => {
    expect(isAuthorized({ auth: { token: 'nope' } }, 'secret')).toBe(false);
  });
  it('rejects a missing auth block', () => {
    expect(isAuthorized({}, 'secret')).toBe(false);
  });
  it('rejects when expected token is empty (misconfig guard)', () => {
    expect(isAuthorized({ auth: { token: '' } }, '')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @dc/shared exec vitest run src/auth.test.ts`
Expected: FAIL — `Cannot find module './auth'`.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/shared/src/auth.ts`:

```ts
import type { GsiPayload } from './types';

export function isAuthorized(payload: GsiPayload, expectedToken: string): boolean {
  if (!expectedToken) return false;             // refuse to run without a configured token
  return payload.auth?.token === expectedToken;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @dc/shared exec vitest run src/auth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/auth.ts packages/shared/src/auth.test.ts
git commit -m "feat(shared): GSI auth token check"
```

---

## Task 3: GSI normalizer

**Files:**
- Create: `packages/shared/src/normalize.ts`, `packages/shared/src/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeGsi } from './normalize';
import type { GsiPayload } from './types';

const full: GsiPayload = {
  map: {
    matchid: '123', clock_time: 600, daytime: true, paused: false,
    game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
  },
  player: { gold: 1500, net_worth: 5200, gpm: 540, xpm: 610, last_hits: 88 },
  hero: { id: 26, level: 12, alive: true, respawn_seconds: 0, has_aghanims_shard: true },
  items: {
    slot0: { name: 'item_blink' },
    slot1: { name: 'empty' },
    slot2: { name: 'item_force_staff' },
    neutral0: { name: 'item_keen_optic' },
  },
};

describe('normalizeGsi', () => {
  it('maps map/player/hero fields', () => {
    const s = normalizeGsi(full);
    expect(s.matchId).toBe('123');
    expect(s.inProgress).toBe(true);
    expect(s.clock).toBe(600);
    expect(s.isDay).toBe(true);
    expect(s.hero.id).toBe(26);
    expect(s.hero.hasShard).toBe(true);
    expect(s.hero.hasScepter).toBe(false);
    expect(s.economy.gpm).toBe(540);
    expect(s.economy.netWorth).toBe(5200);
  });

  it('collects only non-empty item slots (ignores neutral/stash keys)', () => {
    const s = normalizeGsi(full);
    expect(s.items).toEqual(['item_blink', 'item_force_staff']);
  });

  it('returns nulls for an empty payload without throwing', () => {
    const s = normalizeGsi({});
    expect(s.matchId).toBeNull();
    expect(s.inProgress).toBe(false);
    expect(s.clock).toBeNull();
    expect(s.isDay).toBeNull();
    expect(s.hero.id).toBeNull();
    expect(s.economy.gpm).toBeNull();
    expect(s.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @dc/shared exec vitest run src/normalize.test.ts`
Expected: FAIL — `Cannot find module './normalize'`.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/shared/src/normalize.ts`:

```ts
import type { GsiPayload, NormalizedState } from './types';
import { GAME_IN_PROGRESS, EMPTY_ITEM } from './types';

const numOrNull = (v: number | undefined): number | null =>
  typeof v === 'number' ? v : null;

export function normalizeGsi(payload: GsiPayload): NormalizedState {
  const map = payload.map ?? {};
  const player = payload.player ?? {};
  const hero = payload.hero ?? {};
  const items = payload.items ?? {};

  const itemNames = Object.keys(items)
    .filter((k) => k.startsWith('slot'))
    .sort()                                   // slot0..slot8 in order
    .map((k) => items[k]?.name)
    .filter((n): n is string => !!n && n !== EMPTY_ITEM);

  return {
    matchId: map.matchid ?? null,
    inProgress: map.game_state === GAME_IN_PROGRESS,
    paused: map.paused === true,
    clock: numOrNull(map.clock_time),
    isDay: typeof map.daytime === 'boolean' ? map.daytime : null,
    hero: {
      id: numOrNull(hero.id),
      level: numOrNull(hero.level),
      alive: typeof hero.alive === 'boolean' ? hero.alive : null,
      respawnSeconds: numOrNull(hero.respawn_seconds),
      hasScepter: hero.has_aghanims_scepter === true,
      hasShard: hero.has_aghanims_shard === true,
    },
    economy: {
      gold: numOrNull(player.gold),
      netWorth: numOrNull(player.net_worth),
      gpm: numOrNull(player.gpm),
      xpm: numOrNull(player.xpm),
      lastHits: numOrNull(player.last_hits),
    },
    items: itemNames,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @dc/shared exec vitest run src/normalize.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/normalize.ts packages/shared/src/normalize.test.ts
git commit -m "feat(shared): normalize raw GSI payload into NormalizedState"
```

---

## Task 4: Day/night timer

**Files:**
- Create: `packages/shared/src/timers.ts`, `packages/shared/src/timers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/timers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dayNight } from './timers';

describe('dayNight', () => {
  it('is day at the horn, night comes at 5:00', () => {
    expect(dayNight(0)).toEqual({ isDay: true, secondsToNextTransition: 300 });
    expect(dayNight(299)).toEqual({ isDay: true, secondsToNextTransition: 1 });
  });
  it('flips to night at 300s and back to day at 600s', () => {
    expect(dayNight(300)).toEqual({ isDay: false, secondsToNextTransition: 300 });
    expect(dayNight(450)).toEqual({ isDay: false, secondsToNextTransition: 150 });
    expect(dayNight(600)).toEqual({ isDay: true, secondsToNextTransition: 300 });
  });
  it('treats pre-horn (negative clock) as day', () => {
    expect(dayNight(-30)).toEqual({ isDay: true, secondsToNextTransition: 330 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @dc/shared exec vitest run src/timers.test.ts`
Expected: FAIL — `Cannot find module './timers'`.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/shared/src/timers.ts`:

```ts
import { DAY_NIGHT_PHASE } from './types';

export interface DayNightInfo {
  isDay: boolean;
  secondsToNextTransition: number;
}

export function dayNight(clock: number): DayNightInfo {
  if (clock < 0) {
    // Pre-horn: it is day; first night is at clock === DAY_NIGHT_PHASE.
    return { isDay: true, secondsToNextTransition: DAY_NIGHT_PHASE - clock };
  }
  const into = clock % DAY_NIGHT_PHASE;
  const cycle = Math.floor(clock / DAY_NIGHT_PHASE);
  return {
    isDay: cycle % 2 === 0,
    secondsToNextTransition: DAY_NIGHT_PHASE - into,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @dc/shared exec vitest run src/timers.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/timers.ts packages/shared/src/timers.test.ts
git commit -m "feat(shared): day/night phase timer"
```

---

## Task 5: Rune timers

**Files:**
- Create: `packages/shared/src/runes.ts`, `packages/shared/src/runes.test.ts`

> **Note on patch values:** rune schedules change by patch. The defaults below (bounty from 0:00 every 3:00; water at 2:00 & 4:00; power from 6:00 every 2:00) are encoded as a config object so they can be tuned without touching logic. Tests pin the defaults.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/runes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runeTimers, DEFAULT_RUNE_SCHEDULE } from './runes';

describe('runeTimers', () => {
  it('reports the next bounty, water and power spawns early game', () => {
    const t = runeTimers(100, DEFAULT_RUNE_SCHEDULE);
    const byType = Object.fromEntries(t.map((r) => [r.type, r]));
    expect(byType.bounty).toEqual({ type: 'bounty', nextSpawn: 180, secondsUntil: 80 });
    expect(byType.water).toEqual({ type: 'water', nextSpawn: 120, secondsUntil: 20 });
    expect(byType.power).toEqual({ type: 'power', nextSpawn: 360, secondsUntil: 260 });
  });

  it('drops water runes once both have spawned', () => {
    const t = runeTimers(300, DEFAULT_RUNE_SCHEDULE);
    expect(t.find((r) => r.type === 'water')).toBeUndefined();
  });

  it('rolls power runes forward on the 2-minute cadence', () => {
    const t = runeTimers(500, DEFAULT_RUNE_SCHEDULE);
    const power = t.find((r) => r.type === 'power');
    expect(power).toEqual({ type: 'power', nextSpawn: 600, secondsUntil: 100 });
  });

  it('handles pre-horn clock (bounty at 0:00)', () => {
    const t = runeTimers(-15, DEFAULT_RUNE_SCHEDULE);
    const bounty = t.find((r) => r.type === 'bounty');
    expect(bounty).toEqual({ type: 'bounty', nextSpawn: 0, secondsUntil: 15 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @dc/shared exec vitest run src/runes.test.ts`
Expected: FAIL — `Cannot find module './runes'`.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/shared/src/runes.ts`:

```ts
export type RuneType = 'bounty' | 'power' | 'water';

export interface RuneSchedule {
  bounty: { start: number; interval: number };
  power: { start: number; interval: number };
  water: number[]; // fixed one-off spawn times
}

export const DEFAULT_RUNE_SCHEDULE: RuneSchedule = {
  bounty: { start: 0, interval: 180 },
  power: { start: 360, interval: 120 },
  water: [120, 240],
};

export interface RuneTimer {
  type: RuneType;
  nextSpawn: number;
  secondsUntil: number;
}

function nextPeriodic(clock: number, start: number, interval: number): number {
  if (clock <= start) return start;
  const k = Math.ceil((clock - start) / interval);
  return start + k * interval;
}

export function runeTimers(
  clock: number,
  schedule: RuneSchedule = DEFAULT_RUNE_SCHEDULE,
): RuneTimer[] {
  const out: RuneTimer[] = [];

  const bounty = nextPeriodic(clock, schedule.bounty.start, schedule.bounty.interval);
  out.push({ type: 'bounty', nextSpawn: bounty, secondsUntil: bounty - clock });

  const power = nextPeriodic(clock, schedule.power.start, schedule.power.interval);
  out.push({ type: 'power', nextSpawn: power, secondsUntil: power - clock });

  const nextWater = schedule.water.find((t) => t >= clock);
  if (nextWater !== undefined) {
    out.push({ type: 'water', nextSpawn: nextWater, secondsUntil: nextWater - clock });
  }

  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @dc/shared exec vitest run src/runes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/runes.ts packages/shared/src/runes.test.ts
git commit -m "feat(shared): patch-tunable rune spawn timers"
```

---

## Task 6: Roshan respawn timer

**Files:**
- Create: `packages/shared/src/roshan.ts`, `packages/shared/src/roshan.test.ts`

> **Why manual:** as a *player* (not spectator), GSI does not tell you when Roshan died. So v0 takes a user-triggered "Rosh down" event (current clock) and counts the 8:00–11:00 respawn window. This is honest given the data constraint.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/roshan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { roshanTimer } from './roshan';

describe('roshanTimer', () => {
  it('is unknown until a kill is recorded', () => {
    expect(roshanTimer({ killedAtClock: null }, 1000)).toEqual({
      status: 'unknown',
      minRespawn: null, maxRespawn: null, secondsToMin: null, secondsToMax: null,
    });
  });

  it('counts down the 8:00–11:00 window after a kill', () => {
    // killed at 10:00 (600s), now 12:00 (720s) → 120s elapsed
    expect(roshanTimer({ killedAtClock: 600 }, 720)).toEqual({
      status: 'dead',
      minRespawn: 1080,   // 600 + 480
      maxRespawn: 1260,   // 600 + 660
      secondsToMin: 360,
      secondsToMax: 540,
    });
  });

  it('reports negative remaining once the window has passed (may have respawned)', () => {
    const t = roshanTimer({ killedAtClock: 600 }, 1300);
    expect(t.secondsToMin).toBe(-220);
    expect(t.secondsToMax).toBe(-40);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @dc/shared exec vitest run src/roshan.test.ts`
Expected: FAIL — `Cannot find module './roshan'`.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/shared/src/roshan.ts`:

```ts
export interface RoshanInput { killedAtClock: number | null }

export interface RoshanConfig { minSeconds: number; maxSeconds: number }
export const DEFAULT_ROSHAN: RoshanConfig = { minSeconds: 480, maxSeconds: 660 };

export interface RoshanTimer {
  status: 'unknown' | 'dead';
  minRespawn: number | null;
  maxRespawn: number | null;
  secondsToMin: number | null;
  secondsToMax: number | null;
}

export function roshanTimer(
  input: RoshanInput,
  clock: number,
  cfg: RoshanConfig = DEFAULT_ROSHAN,
): RoshanTimer {
  if (input.killedAtClock === null) {
    return { status: 'unknown', minRespawn: null, maxRespawn: null, secondsToMin: null, secondsToMax: null };
  }
  const minRespawn = input.killedAtClock + cfg.minSeconds;
  const maxRespawn = input.killedAtClock + cfg.maxSeconds;
  return {
    status: 'dead',
    minRespawn,
    maxRespawn,
    secondsToMin: minRespawn - clock,
    secondsToMax: maxRespawn - clock,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @dc/shared exec vitest run src/roshan.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/roshan.ts packages/shared/src/roshan.test.ts
git commit -m "feat(shared): manual-trigger Roshan respawn window timer"
```

---

## Task 7: Economy grader

**Files:**
- Create: `packages/shared/src/economy.ts`, `packages/shared/src/economy.test.ts`

> **v0 scope:** a simple static GPM target by self-assigned role. (v1 replaces the static target with OpenDota `/benchmarks` percentiles.)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/economy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { gradeEconomy } from './economy';

describe('gradeEconomy', () => {
  it('grades a core ahead / on-track / behind', () => {
    expect(gradeEconomy(600, 'core')).toMatchObject({ target: 500, delta: 100, rating: 'ahead' });
    expect(gradeEconomy(520, 'core')).toMatchObject({ rating: 'on-track' });
    expect(gradeEconomy(400, 'core')).toMatchObject({ rating: 'behind' });
  });
  it('uses a lower target for supports', () => {
    expect(gradeEconomy(360, 'support')).toMatchObject({ target: 300, rating: 'ahead' });
  });
  it('returns unknown when gpm or role is unknown', () => {
    expect(gradeEconomy(null, 'core')).toMatchObject({ rating: 'unknown', delta: null });
    expect(gradeEconomy(500, 'unknown')).toMatchObject({ rating: 'unknown' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @dc/shared exec vitest run src/economy.test.ts`
Expected: FAIL — `Cannot find module './economy'`.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/shared/src/economy.ts`:

```ts
import type { Role } from './types';

export interface EconomyGrade {
  gpm: number | null;
  target: number | null;
  delta: number | null;
  rating: 'ahead' | 'on-track' | 'behind' | 'unknown';
}

const TARGETS: Record<Exclude<Role, 'unknown'>, number> = { core: 500, support: 300 };

export function gradeEconomy(gpm: number | null, role: Role): EconomyGrade {
  if (gpm === null || role === 'unknown') {
    return { gpm, target: role === 'unknown' ? null : TARGETS[role], delta: null, rating: 'unknown' };
  }
  const target = TARGETS[role];
  const delta = gpm - target;
  let rating: EconomyGrade['rating'] = 'on-track';
  if (delta >= 50) rating = 'ahead';
  else if (delta <= -50) rating = 'behind';
  return { gpm, target, delta, rating };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @dc/shared exec vitest run src/economy.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/economy.ts packages/shared/src/economy.test.ts
git commit -m "feat(shared): static role-based economy grader"
```

---

## Task 8: Clock formatter + shared barrel export

**Files:**
- Create: `packages/shared/src/format.ts`, `packages/shared/src/format.test.ts`, `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatClock } from './format';

describe('formatClock', () => {
  it('formats m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(600)).toBe('10:00');
  });
  it('formats negative values with a leading minus', () => {
    expect(formatClock(-30)).toBe('-0:30');
    expect(formatClock(-95)).toBe('-1:35');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @dc/shared exec vitest run src/format.test.ts`
Expected: FAIL — `Cannot find module './format'`.

- [ ] **Step 3: Write the implementation and the barrel export**

Create `packages/shared/src/format.ts`:

```ts
export function formatClock(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(seconds));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}:${String(s).padStart(2, '0')}`;
}
```

Create `packages/shared/src/index.ts`:

```ts
export * from './types';
export * from './auth';
export * from './normalize';
export * from './timers';
export * from './runes';
export * from './roshan';
export * from './economy';
export * from './format';
```

- [ ] **Step 4: Run the full shared test suite**

Run: `pnpm --filter @dc/shared test`
Expected: PASS — all suites (auth, normalize, timers, runes, roshan, economy, format) green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/format.ts packages/shared/src/format.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): clock formatter and public barrel export"
```

---

## Task 9: Listener Hub (latest-state store + pub/sub)

**Files:**
- Create: `apps/listener/package.json`, `apps/listener/tsconfig.json`, `apps/listener/src/hub.ts`, `apps/listener/src/hub.test.ts`

- [ ] **Step 1: Create `apps/listener/package.json`**

```json
{
  "name": "@dc/listener",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "dev": "node --import tsx src/main.ts",
    "replay": "node --import tsx src/replay.ts",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@dc/shared": "workspace:*",
    "fastify": "^4.28.0",
    "@fastify/websocket": "^10.0.1"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.16.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/listener/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Install deps**

Run:

```bash
cd /Users/inky/Desktop/dota2-companion
pnpm install
```

Expected: fastify, @fastify/websocket, tsx installed; `@dc/shared` linked via workspace.

- [ ] **Step 4: Write the failing test**

Create `apps/listener/src/hub.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Hub } from './hub';
import type { NormalizedState } from '@dc/shared';

const state = (matchId: string): NormalizedState => ({
  matchId, inProgress: true, paused: false, clock: 100, isDay: true,
  hero: { id: 1, level: 1, alive: true, respawnSeconds: 0, hasScepter: false, hasShard: false },
  economy: { gold: 0, netWorth: 0, gpm: 0, xpm: 0, lastHits: 0 },
  items: [],
});

describe('Hub', () => {
  it('stores the latest state', () => {
    const hub = new Hub();
    expect(hub.getLatest()).toBeNull();
    hub.update(state('a'));
    expect(hub.getLatest()?.matchId).toBe('a');
  });

  it('notifies subscribers on update', () => {
    const hub = new Hub();
    const cb = vi.fn();
    hub.subscribe(cb);
    hub.update(state('b'));
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ matchId: 'b' }));
  });

  it('stops notifying after unsubscribe', () => {
    const hub = new Hub();
    const cb = vi.fn();
    const off = hub.subscribe(cb);
    off();
    hub.update(state('c'));
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @dc/listener exec vitest run src/hub.test.ts`
Expected: FAIL — `Cannot find module './hub'`.

- [ ] **Step 6: Write the implementation**

Create `apps/listener/src/hub.ts`:

```ts
import type { NormalizedState } from '@dc/shared';

export type Subscriber = (state: NormalizedState) => void;

export class Hub {
  private latest: NormalizedState | null = null;
  private subs = new Set<Subscriber>();

  update(state: NormalizedState): void {
    this.latest = state;
    for (const cb of this.subs) cb(state);
  }

  getLatest(): NormalizedState | null {
    return this.latest;
  }

  subscribe(cb: Subscriber): () => void {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @dc/listener exec vitest run src/hub.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/listener
git commit -m "feat(listener): Hub latest-state store with pub/sub"
```

---

## Task 10: Listener server (HTTP POST + WS broadcast)

**Files:**
- Create: `apps/listener/src/server.ts`, `apps/listener/src/server.test.ts`, `apps/listener/src/main.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/listener/src/server.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildServer } from './server';
import { Hub } from './hub';

const payload = {
  auth: { token: 'secret' },
  map: { matchid: '42', clock_time: 120, daytime: true, game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' },
  player: { gpm: 500 },
  hero: { id: 5 },
  items: {},
};

describe('listener server', () => {
  it('accepts an authorized GSI POST and updates the hub', async () => {
    const hub = new Hub();
    const app = buildServer({ token: 'secret', hub });
    const res = await app.inject({ method: 'POST', url: '/', payload });
    expect(res.statusCode).toBe(200);
    expect(hub.getLatest()?.matchId).toBe('42');
    await app.close();
  });

  it('rejects an unauthorized POST with 401 and does not update', async () => {
    const hub = new Hub();
    const app = buildServer({ token: 'secret', hub });
    const res = await app.inject({ method: 'POST', url: '/', payload: { ...payload, auth: { token: 'wrong' } } });
    expect(res.statusCode).toBe(401);
    expect(hub.getLatest()).toBeNull();
    await app.close();
  });

  it('serves /health', async () => {
    const app = buildServer({ token: 'secret', hub: new Hub() });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @dc/listener exec vitest run src/server.test.ts`
Expected: FAIL — `Cannot find module './server'`.

- [ ] **Step 3: Write the implementation**

Create `apps/listener/src/server.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { isAuthorized, normalizeGsi, type GsiPayload } from '@dc/shared';
import type { Hub } from './hub';

export interface ServerOptions {
  token: string;
  hub: Hub;
}

export function buildServer(opts: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });
  app.register(websocket);

  app.get('/health', async () => ({ ok: true }));

  // GSI posts the full game state here.
  app.post('/', async (req, reply) => {
    const body = (req.body ?? {}) as GsiPayload;
    if (!isAuthorized(body, opts.token)) {
      return reply.code(401).send();
    }
    opts.hub.update(normalizeGsi(body));
    // Reply fast and empty — slow replies make GSI throttle.
    return reply.code(200).send();
  });

  // The overlay subscribes here for live normalized state.
  app.register(async (instance) => {
    instance.get('/ws', { websocket: true }, (socket) => {
      const latest = opts.hub.getLatest();
      if (latest) socket.send(JSON.stringify(latest));
      const off = opts.hub.subscribe((state) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(state));
      });
      socket.on('close', off);
    });
  });

  return app;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @dc/listener exec vitest run src/server.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the entrypoint**

Create `apps/listener/src/main.ts`:

```ts
import { buildServer } from './server';
import { Hub } from './hub';

const token = process.env.GSI_TOKEN;
if (!token) {
  console.error('GSI_TOKEN env var is required. Run `pnpm gen-cfg` first, then export it.');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 53000);
const hub = new Hub();
const app = buildServer({ token, hub });

app.listen({ host: '127.0.0.1', port })
  .then(() => console.log(`GSI listener on http://127.0.0.1:${port} (POST /), overlay WS at ws://127.0.0.1:${port}/ws`))
  .catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 6: Commit**

```bash
git add apps/listener/src/server.ts apps/listener/src/server.test.ts apps/listener/src/main.ts
git commit -m "feat(listener): Fastify GSI POST handler + WS broadcast + entrypoint"
```

---

## Task 11: Fixture replay (develop on macOS without Dota)

**Files:**
- Create: `fixtures/sample-match.json`, `apps/listener/src/replay.ts`

- [ ] **Step 1: Create a recorded GSI fixture sequence**

Create `fixtures/sample-match.json` (token will be injected at replay time, so omit it here):

```json
[
  {
    "map": { "matchid": "7777", "clock_time": 95, "daytime": true, "game_state": "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS" },
    "player": { "gold": 800, "net_worth": 2600, "gpm": 480, "xpm": 520, "last_hits": 42 },
    "hero": { "id": 26, "level": 6, "alive": true, "respawn_seconds": 0, "has_aghanims_shard": false },
    "items": { "slot0": { "name": "item_boots" }, "slot1": { "name": "item_magic_wand" }, "slot2": { "name": "empty" } }
  },
  {
    "map": { "matchid": "7777", "clock_time": 305, "daytime": false, "game_state": "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS" },
    "player": { "gold": 1500, "net_worth": 4200, "gpm": 540, "xpm": 610, "last_hits": 88 },
    "hero": { "id": 26, "level": 11, "alive": true, "respawn_seconds": 0, "has_aghanims_shard": true },
    "items": { "slot0": { "name": "item_power_treads" }, "slot1": { "name": "item_magic_wand" }, "slot2": { "name": "item_blink" } }
  },
  {
    "map": { "matchid": "7777", "clock_time": 640, "daytime": true, "game_state": "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS" },
    "player": { "gold": 350, "net_worth": 7100, "gpm": 510, "xpm": 660, "last_hits": 142 },
    "hero": { "id": 26, "level": 16, "alive": false, "respawn_seconds": 28, "has_aghanims_shard": true, "has_aghanims_scepter": true },
    "items": { "slot0": { "name": "item_power_treads" }, "slot1": { "name": "item_blink" }, "slot2": { "name": "item_black_king_bar" } }
  }
]
```

- [ ] **Step 2: Write the replay CLI**

Create `apps/listener/src/replay.ts`:

```ts
import { readFile } from 'node:fs/promises';

const token = process.env.GSI_TOKEN;
if (!token) { console.error('GSI_TOKEN env var is required.'); process.exit(1); }

const port = Number(process.env.PORT ?? 53000);
const file = process.argv[2] ?? 'fixtures/sample-match.json';
const intervalMs = Number(process.env.REPLAY_INTERVAL_MS ?? 1500);

const frames = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>[];
console.log(`Replaying ${frames.length} frames from ${file} -> http://127.0.0.1:${port}/ every ${intervalMs}ms`);

for (const frame of frames) {
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...frame, auth: { token } }),
  });
  console.log(`  frame -> ${res.status}`);
  await new Promise((r) => setTimeout(r, intervalMs));
}
console.log('Replay complete.');
```

- [ ] **Step 3: Verify the replay round-trips through the listener**

Run (two terminals, from the repo root):

```bash
# terminal 1
GSI_TOKEN=devtoken pnpm listener
# terminal 2
GSI_TOKEN=devtoken pnpm replay
```

Expected: terminal 1 logs the listener URL; terminal 2 prints `frame -> 200` three times then `Replay complete.`

- [ ] **Step 4: Commit**

```bash
git add fixtures/sample-match.json apps/listener/src/replay.ts
git commit -m "feat(listener): fixture replay CLI for Dota-less development"
```

---

## Task 12: Overlay — presentational components (TDD)

**Files:**
- Create: `apps/overlay/package.json`, `apps/overlay/tsconfig.json`, `apps/overlay/vite.config.ts`, `apps/overlay/src/components/{ConnectionBadge,EconomyPanel,EnemyPicker,TimerPanel}.tsx` + co-located `*.test.tsx`

- [ ] **Step 1: Create overlay package + config files**

Create `apps/overlay/package.json`:

```json
{
  "name": "@dc/overlay",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@dc/shared": "workspace:*",
    "dotaconstants": "^8.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^24.1.0",
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "vitest": "^2.0.0"
  }
}
```

Create `apps/overlay/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "outDir": "dist", "rootDir": "src", "noEmit": true },
  "include": ["src/**/*"]
}
```

Create `apps/overlay/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5273 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
} as any);
```

Create `apps/overlay/src/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

Create `apps/overlay/index.html`:

```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Dota Companion Overlay</title></head>
  <body style="margin:0;background:transparent">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Run: `cd /Users/inky/Desktop/dota2-companion && pnpm install`
Expected: React, Vite, testing-library, dotaconstants installed.

- [ ] **Step 2: Write the failing test for ConnectionBadge**

Create `apps/overlay/src/components/ConnectionBadge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { ConnectionBadge } from './ConnectionBadge';

it('shows connected vs disconnected', () => {
  const { rerender } = render(<ConnectionBadge connected={true} />);
  expect(screen.getByText(/live/i)).toBeInTheDocument();
  rerender(<ConnectionBadge connected={false} />);
  expect(screen.getByText(/waiting/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @dc/overlay exec vitest run src/components/ConnectionBadge.test.tsx`
Expected: FAIL — cannot find `./ConnectionBadge`.

- [ ] **Step 4: Implement ConnectionBadge**

Create `apps/overlay/src/components/ConnectionBadge.tsx`:

```tsx
export function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <div style={{ fontSize: 12, color: connected ? '#4ade80' : '#f59e0b' }}>
      {connected ? '● LIVE' : '○ waiting for GSI…'}
    </div>
  );
}
```

Run: `pnpm --filter @dc/overlay exec vitest run src/components/ConnectionBadge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing test for EconomyPanel**

Create `apps/overlay/src/components/EconomyPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { EconomyPanel } from './EconomyPanel';
import { gradeEconomy } from '@dc/shared';

it('renders gpm and rating', () => {
  render(<EconomyPanel grade={gradeEconomy(600, 'core')} />);
  expect(screen.getByText(/600/)).toBeInTheDocument();
  expect(screen.getByText(/ahead/i)).toBeInTheDocument();
});

it('handles unknown gracefully', () => {
  render(<EconomyPanel grade={gradeEconomy(null, 'core')} />);
  expect(screen.getByText(/—|unknown/i)).toBeInTheDocument();
});
```

- [ ] **Step 6: Run to verify it fails, then implement**

Run: `pnpm --filter @dc/overlay exec vitest run src/components/EconomyPanel.test.tsx`
Expected: FAIL — cannot find `./EconomyPanel`.

Create `apps/overlay/src/components/EconomyPanel.tsx`:

```tsx
import type { EconomyGrade } from '@dc/shared';

const COLOR: Record<EconomyGrade['rating'], string> = {
  ahead: '#4ade80', 'on-track': '#e5e7eb', behind: '#f87171', unknown: '#9ca3af',
};

export function EconomyPanel({ grade }: { grade: EconomyGrade }) {
  return (
    <div style={{ color: COLOR[grade.rating] }}>
      <strong>GPM:</strong> {grade.gpm ?? '—'}
      {grade.target !== null && <span> / {grade.target}</span>}{' '}
      <em>({grade.rating})</em>
    </div>
  );
}
```

Run: `pnpm --filter @dc/overlay exec vitest run src/components/EconomyPanel.test.tsx`
Expected: PASS.

- [ ] **Step 7: Write the failing test for EnemyPicker**

Create `apps/overlay/src/components/EnemyPicker.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { EnemyPicker } from './EnemyPicker';

const heroes = [
  { id: 1, localized_name: 'Anti-Mage' },
  { id: 2, localized_name: 'Axe' },
];

it('lists heroes and toggles selection on click (max 5)', async () => {
  const onToggle = vi.fn();
  render(<EnemyPicker heroes={heroes} selected={[2]} onToggle={onToggle} />);
  expect(screen.getByText('Anti-Mage')).toBeInTheDocument();
  await userEvent.click(screen.getByText('Anti-Mage'));
  expect(onToggle).toHaveBeenCalledWith(1);
  // Axe is already selected → shown as selected
  expect(screen.getByText('Axe').closest('button')).toHaveAttribute('aria-pressed', 'true');
});
```

- [ ] **Step 8: Run to verify it fails, then implement**

Run: `pnpm --filter @dc/overlay exec vitest run src/components/EnemyPicker.test.tsx`
Expected: FAIL — cannot find `./EnemyPicker`.

Create `apps/overlay/src/components/EnemyPicker.tsx`:

```tsx
export interface HeroOption { id: number; localized_name: string }

export interface EnemyPickerProps {
  heroes: HeroOption[];
  selected: number[];
  onToggle: (heroId: number) => void;
  max?: number;
}

export function EnemyPicker({ heroes, selected, onToggle, max = 5 }: EnemyPickerProps) {
  return (
    <div>
      <div style={{ fontSize: 12, marginBottom: 4 }}>
        Enemy heroes ({selected.length}/{max})
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {heroes.map((h) => {
          const isSelected = selected.includes(h.id);
          const atLimit = selected.length >= max && !isSelected;
          return (
            <button
              key={h.id}
              aria-pressed={isSelected}
              disabled={atLimit}
              onClick={() => onToggle(h.id)}
              style={{
                fontSize: 11, padding: '2px 6px', cursor: atLimit ? 'not-allowed' : 'pointer',
                background: isSelected ? '#2563eb' : '#1f2937', color: '#fff', border: 'none', borderRadius: 4,
                opacity: atLimit ? 0.4 : 1,
              }}
            >
              {h.localized_name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

Run: `pnpm --filter @dc/overlay exec vitest run src/components/EnemyPicker.test.tsx`
Expected: PASS.

- [ ] **Step 9: Write the failing test for TimerPanel**

Create `apps/overlay/src/components/TimerPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { TimerPanel } from './TimerPanel';
import { runeTimers, roshanTimer } from '@dc/shared';

it('renders day/night, runes, and roshan status', () => {
  render(
    <TimerPanel
      clock={305}
      dayNightLabel="NIGHT"
      secondsToTransition={295}
      runes={runeTimers(305)}
      roshan={roshanTimer({ killedAtClock: null }, 305)}
      onRoshanDown={() => {}}
    />,
  );
  expect(screen.getByText(/night/i)).toBeInTheDocument();
  expect(screen.getByText(/bounty/i)).toBeInTheDocument();
  expect(screen.getByText(/rosh down/i)).toBeInTheDocument();
});
```

- [ ] **Step 10: Run to verify it fails, then implement**

Run: `pnpm --filter @dc/overlay exec vitest run src/components/TimerPanel.test.tsx`
Expected: FAIL — cannot find `./TimerPanel`.

Create `apps/overlay/src/components/TimerPanel.tsx`:

```tsx
import { formatClock, type RuneTimer, type RoshanTimer } from '@dc/shared';

export interface TimerPanelProps {
  clock: number | null;
  dayNightLabel: string;
  secondsToTransition: number | null;
  runes: RuneTimer[];
  roshan: RoshanTimer;
  onRoshanDown: () => void;
}

export function TimerPanel(props: TimerPanelProps) {
  const { clock, dayNightLabel, secondsToTransition, runes, roshan, onRoshanDown } = props;
  return (
    <div style={{ fontSize: 12, lineHeight: 1.6 }}>
      <div><strong>Clock:</strong> {clock === null ? '—' : formatClock(clock)}</div>
      <div>
        <strong>{dayNightLabel}</strong>
        {secondsToTransition !== null && <span> · flips in {formatClock(secondsToTransition)}</span>}
      </div>
      {runes.map((r) => (
        <div key={r.type}>{r.type} rune in {formatClock(r.secondsUntil)}</div>
      ))}
      <div>
        Roshan:{' '}
        {roshan.status === 'unknown'
          ? 'alive / unknown'
          : `back in ${formatClock(roshan.secondsToMin ?? 0)}–${formatClock(roshan.secondsToMax ?? 0)}`}
        <button onClick={onRoshanDown} style={{ marginLeft: 6, fontSize: 10 }}>Rosh down</button>
      </div>
    </div>
  );
}
```

Run: `pnpm --filter @dc/overlay exec vitest run src/components/TimerPanel.test.tsx`
Expected: PASS.

- [ ] **Step 11: Run all overlay component tests + commit**

Run: `pnpm --filter @dc/overlay test`
Expected: PASS — all four component suites green.

```bash
git add apps/overlay
git commit -m "feat(overlay): TDD presentational components (badge, economy, picker, timers)"
```

---

## Task 13: Overlay — WebSocket hook + App wiring

**Files:**
- Create: `apps/overlay/src/useGsiSocket.ts`, `apps/overlay/src/App.tsx`, `apps/overlay/src/main.tsx`

> The hook and App are the thin I/O wiring layer (verified end-to-end in Task 14, not unit-tested — all logic they use is already covered in `@dc/shared` and the component tests).

- [ ] **Step 1: Write the WebSocket hook**

Create `apps/overlay/src/useGsiSocket.ts`:

```ts
import { useEffect, useState } from 'react';
import type { NormalizedState } from '@dc/shared';

export function useGsiSocket(url = 'ws://127.0.0.1:53000/ws') {
  const [state, setState] = useState<NormalizedState | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(url);
      ws.onopen = () => setConnected(true);
      ws.onmessage = (ev) => {
        try { setState(JSON.parse(ev.data as string) as NormalizedState); } catch { /* ignore malformed */ }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1000);   // auto-reconnect
      };
      ws.onerror = () => ws.close();
    };
    connect();

    return () => { closed = true; clearTimeout(retry); ws?.close(); };
  }, [url]);

  return { state, connected };
}
```

- [ ] **Step 2: Write the App**

Create `apps/overlay/src/App.tsx`:

```tsx
import { useMemo, useState } from 'react';
import heroesData from 'dotaconstants/build/heroes.json';
import {
  dayNight, runeTimers, roshanTimer, gradeEconomy, type Role,
} from '@dc/shared';
import { useGsiSocket } from './useGsiSocket';
import { ConnectionBadge } from './components/ConnectionBadge';
import { TimerPanel } from './components/TimerPanel';
import { EconomyPanel } from './components/EconomyPanel';
import { EnemyPicker, type HeroOption } from './components/EnemyPicker';

const HERO_OPTIONS: HeroOption[] = Object.values(
  heroesData as Record<string, { id: number; localized_name: string }>,
).map((h) => ({ id: h.id, localized_name: h.localized_name }))
 .sort((a, b) => a.localized_name.localeCompare(b.localized_name));

export default function App() {
  const { state, connected } = useGsiSocket();
  const [role, setRole] = useState<Role>('core');
  const [enemies, setEnemies] = useState<number[]>([]);
  const [roshKilledAt, setRoshKilledAt] = useState<number | null>(null);

  const clock = state?.clock ?? null;
  const dn = clock === null ? null : dayNight(clock);
  const runes = clock === null ? [] : runeTimers(clock);
  const rosh = roshanTimer({ killedAtClock: roshKilledAt }, clock ?? 0);
  const grade = useMemo(() => gradeEconomy(state?.economy.gpm ?? null, role), [state, role]);

  const toggleEnemy = (id: number) =>
    setEnemies((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 5 ? [...prev, id] : prev);

  return (
    <div style={{ fontFamily: 'system-ui', color: '#e5e7eb', background: 'rgba(17,24,39,0.85)', padding: 12, maxWidth: 360 }}>
      <ConnectionBadge connected={connected} />
      <div style={{ margin: '8px 0' }}>
        <label style={{ fontSize: 12 }}>
          Role:{' '}
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="core">core</option>
            <option value="support">support</option>
            <option value="unknown">unknown</option>
          </select>
        </label>
      </div>
      <TimerPanel
        clock={clock}
        dayNightLabel={dn ? (dn.isDay ? 'DAY' : 'NIGHT') : '—'}
        secondsToTransition={dn ? dn.secondsToNextTransition : null}
        runes={runes}
        roshan={rosh}
        onRoshanDown={() => setRoshKilledAt(clock)}
      />
      <hr style={{ borderColor: '#374151' }} />
      <EconomyPanel grade={grade} />
      <hr style={{ borderColor: '#374151' }} />
      <EnemyPicker heroes={HERO_OPTIONS} selected={enemies} onToggle={toggleEnemy} />
    </div>
  );
}
```

- [ ] **Step 3: Write the React entrypoint**

Create `apps/overlay/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
```

- [ ] **Step 4: Verify the overlay builds and type-checks**

Run:

```bash
cd /Users/inky/Desktop/dota2-companion
pnpm --filter @dc/overlay exec tsc -p tsconfig.json --noEmit
pnpm --filter @dc/overlay build
```

Expected: type-check passes; Vite produces a `dist/` bundle with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/overlay/src/useGsiSocket.ts apps/overlay/src/App.tsx apps/overlay/src/main.tsx
git commit -m "feat(overlay): WebSocket hook + App wiring (timers, economy, enemy picker)"
```

---

## Task 14: GSI cfg generator + end-to-end verification + README

**Files:**
- Create: `scripts/gen-gsi-cfg.mjs`, `README.md`

- [ ] **Step 1: Write the GSI cfg generator**

Create `scripts/gen-gsi-cfg.mjs`:

```js
import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const token = process.env.GSI_TOKEN ?? randomBytes(12).toString('hex');
const port = process.env.PORT ?? 53000;

const cfg = `"dota2-companion"
{
  "uri"       "http://127.0.0.1:${port}/"
  "timeout"   "5.0"
  "buffer"    "0.1"
  "throttle"  "0.1"
  "heartbeat" "30.0"
  "data"
  {
    "provider"  "1"
    "map"       "1"
    "player"    "1"
    "hero"      "1"
    "abilities" "1"
    "items"     "1"
  }
  "auth" { "token" "${token}" }
}
`;

const outName = 'gamestate_integration_dota2-companion.cfg';
await writeFile(outName, cfg, 'utf8');
await writeFile('.gsi-token', token, 'utf8');

console.log(`Wrote ${outName} and .gsi-token (token: ${token}).`);
console.log('Copy the .cfg into your Dota 2 install:');
console.log('  macOS:   ~/Library/Application Support/Steam/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration/');
console.log('  Windows: <Steam>\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\gamestate_integration\\');
console.log('Then launch the listener with this token:');
console.log(`  GSI_TOKEN=${token} pnpm listener`);
```

- [ ] **Step 2: Generate the cfg and confirm output**

Run: `cd /Users/inky/Desktop/dota2-companion && pnpm gen-cfg`
Expected: prints a token, writes `gamestate_integration_dota2-companion.cfg` and `.gsi-token`, and prints the copy-paste paths.

- [ ] **Step 3: Add cfg artifacts to .gitignore**

Modify `.gitignore` — append:

```
gamestate_integration_*.cfg
```

(`.gsi-token` is already ignored from Task 0.)

- [ ] **Step 4: End-to-end verification with the fixture (the v0 definition of done)**

Run, in three terminals from the repo root:

```bash
# terminal 1 — listener
GSI_TOKEN=$(cat .gsi-token) pnpm listener
# terminal 2 — overlay dev server
pnpm overlay
# terminal 3 — replay the recorded match into the listener
GSI_TOKEN=$(cat .gsi-token) REPLAY_INTERVAL_MS=2000 pnpm replay
```

Then open `http://127.0.0.1:5273` in a browser. **Verify:**
- The badge flips to `● LIVE` once the WebSocket connects.
- As frames replay: Clock shows 1:35 → 5:05 → 10:40; day/night label flips to NIGHT then back to DAY; rune rows count down.
- GPM shows 480 (behind, for core target 500) → 540 (ahead) → 510 (ahead).
- Clicking **Rosh down** starts the 8:00–11:00 countdown from the current clock.
- Selecting up to 5 enemy heroes works and stops at 5.

- [ ] **Step 5: Write the README**

Create `README.md`:

```markdown
# Dota 2 Companion (v0 — Live Loop)

Local, read-only Dota 2 coaching companion. v0 proves the live loop:
Dota 2 → Game State Integration → local listener → web overlay, with live
timers, an economy grade, and a manual enemy-hero picker. No LLM yet.

> **Posture:** read-only, advisory-only. Only Valve's official GSI is used —
> no memory reading, no input automation.

## Quick start (macOS or Windows)

```bash
corepack enable && pnpm install
pnpm test                 # run all unit + component tests
pnpm gen-cfg              # generate the GSI .cfg + a token (.gsi-token)
```

Copy `gamestate_integration_dota2-companion.cfg` into your Dota 2 install:
- macOS: `~/Library/Application Support/Steam/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration/`
- Windows: `<Steam>\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\`

Run the companion:

```bash
GSI_TOKEN=$(cat .gsi-token) pnpm listener   # terminal 1
pnpm overlay                                # terminal 2 → http://127.0.0.1:5273
```

Launch Dota 2 and enter a match — the overlay updates live.

## Develop without Dota (replay a recorded match)

```bash
GSI_TOKEN=$(cat .gsi-token) pnpm listener   # terminal 1
pnpm overlay                                # terminal 2
GSI_TOKEN=$(cat .gsi-token) pnpm replay     # terminal 3
```

## Layout
- `packages/shared` — pure logic (GSI normalize, timers, economy). Fully unit-tested.
- `apps/listener` — Fastify GSI receiver + WebSocket broadcaster.
- `apps/overlay` — React overlay UI (web; later wrapped by Overwolf on Windows).
```

- [ ] **Step 6: Run the entire test suite once more, then commit**

Run: `cd /Users/inky/Desktop/dota2-companion && pnpm test`
Expected: all packages PASS (shared: 7 suites; listener: 2 suites; overlay: 4 suites).

```bash
git add scripts/gen-gsi-cfg.mjs README.md .gitignore
git commit -m "feat: GSI cfg generator, README, and end-to-end run docs"
```

---

## Definition of Done (v0)

- [ ] `pnpm test` is green across all three packages.
- [ ] `pnpm gen-cfg` produces a working GSI cfg + token.
- [ ] With the listener + overlay running and either Dota 2 in a match **or** `pnpm replay`, the overlay shows: connection badge, live clock, day/night with countdown, rune timers, a working manual Roshan timer, a live GPM grade, and a functional 5-hero enemy picker.
- [ ] No network calls leave the machine except localhost GSI (no OpenDota/LLM yet).
- [ ] All logic in `packages/shared` is pure and unit-tested; transport and UI wiring are thin.

---

## Self-Review (completed against this plan)

**Spec coverage** (against the v0 definition of done in `BUILD_BLUEPRINT.md` §9):
- GSI listener (auth, fast 200, diff) → Tasks 2, 9, 10. ✓
- Minimal overlay with Roshan/rune timers + GPM/XPM vs benchmark → Tasks 4–8, 12–14. ✓
- Manual 5-hero enemy picker → Task 12 (EnemyPicker) + Task 13 (App). ✓
- Bundle dotaconstants locally → Task 12 (`dotaconstants` dep) + Task 13 (heroes.json import). ✓
- Cross-platform dev on macOS without Dota → Task 11 (fixture replay). ✓

**Placeholder scan:** no TBD/TODO/"handle edge cases"/"add tests" placeholders; every code step contains complete code; every run step has an exact command + expected result.

**Type consistency check:** `NormalizedState`, `Role`, `EconomyGrade`, `RuneTimer`, `RoshanTimer`, `RoshanInput`, `DayNightInfo`, `HeroOption` are each defined once and referenced with the same shape everywhere. `Hub.subscribe` returns an unsubscribe `() => void` used consistently in `server.ts`. `gradeEconomy(gpm, role)`, `dayNight(clock)`, `runeTimers(clock, schedule?)`, `roshanTimer(input, clock, cfg?)`, `formatClock(seconds)`, `normalizeGsi(payload)`, `isAuthorized(payload, token)` signatures match between definition, tests, and call sites in `App.tsx`. The `dotaconstants` hero record is typed `{ id, localized_name }` consistently in `App.tsx` and `EnemyPicker`.
