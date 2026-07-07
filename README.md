# NeuroFocus — Dota 2 NeuroSync

**Sync your brain with your game.** An EEG-powered Dota 2 coaching companion:
live game-state coaching while you play, and a full mental-game debrief when
you're done — your **FlowState** (focus & stress from a NeuroFocus EEG headset)
overlaid on every kill, death and fight, with an AI coach that tells you *where*
and *why* you lost focus.

[![CI](https://github.com/enkhbold470/dota2-companion/actions/workflows/ci.yml/badge.svg)](https://github.com/enkhbold470/dota2-companion/actions/workflows/ci.yml)

Dota 2 → Game State Integration → local listener → web overlay. Read-only,
advisory-only, local-first.

**Keywords:** Dota 2 coach · game state integration (GSI) · EEG neurofeedback ·
BCI gaming · esports performance · focus tracking · tilt detection · OpenDota
stats · AI item builds · gpt-5.4

## What it does

### While you play (Live)
- **Auto draft detect** — one screen grab of the top hero bar and gpt-5.4
  vision reads **all ten heroes**, splits Radiant/Dire, and maps allies vs
  enemies using your GSI side. Cropped full-resolution capture + alias-aware
  name matching + automatic retries. Falls back to a manual picker.
- **NeuroFocus Intelligence · item build** — hero-tuned, enemy-aware buy order
  with a **Meta ⇄ Fun 🎉** toggle. *Fun* draws from a curated per-hero spicy
  pool (`hero-builds.json`, generated offline by an LLM and checked in — no more
  Dagon-on-every-hero); *Meta* weighs the deterministic counter-item engine's
  picks. Priced against live gold with a **BUY NOW** flag.
- **NeuroFocus Intelligence · ask coach** — free-form questions answered with
  your full live context: hero, economy, threat flags, engine advice, tips.
- **FlowState strip** — live focus/stress score from the headset, with
  **TiltGuard** warnings when you're spiraling.
- **Skill damage readout, coach tips, rune/Roshan/day-night timers, GPM grade**
  — a deterministic rules engine over pruned static data, no LLM in the tick path.

### Between games (NeuroFocus Studio)
- **Full-screen dashboard** appears automatically when you're not in a match.
- **Last-match stat sheet** — win/loss, K/D/A, last hits/denies, GPM/XPM, hero
  & tower damage, healing, net worth, final items — via OpenDota (cached locally).
- **Recent-match history** — click any row to load its stat sheet.
- **TraceLog session review** — recorded EEG sessions paired with a screen
  recording; click the focus timeline to seek the video to the moment focus dropped.
- **NeuroFocus Intelligence · deep analysis** — one click sends the session's
  FlowState buckets + match events (+ the OpenDota gold curve) to the AI coach,
  which returns the moments you lost focus, your tilt pattern, and **one
  trainable habit** for next session. Each moment seeks the video.

> **Posture:** read-only, advisory-only. Only Valve's official GSI is consumed —
> no memory reading, no input automation. The listener binds `127.0.0.1`;
> neural data and recordings never leave your machine.

> **Lightweight by design:** the hot loop is a deterministic rules engine over
> ~250 KB of pruned static data. LLM calls (gpt-5.4 via the OpenAI Responses
> API) fire only on explicit/debounced user actions — never per GSI tick — and
> are off unless you provide a key.

## Quick start (macOS or Windows)

```bash
corepack enable && pnpm install
pnpm test                 # run all unit + component tests
pnpm gen-cfg              # generate the GSI .cfg + a token (.gsi-token)
```

Copy `gamestate_integration_dota2-companion.cfg` into your Dota 2 install:
- macOS: `~/Library/Application Support/Steam/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration/`
- Windows: `<Steam>\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\`

Run the companion as **one process** (builds the UI, then serves UI + API + WebSocket on a single port):

```bash
pnpm start        # → open http://127.0.0.1:53000
```

`pnpm start` reads `GSI_TOKEN` (and optional `OPENAI_API_KEY`) from `.env` — see
`.env.example`. Launch Dota 2 and enter a match; the overlay updates live and
auto-detects both teams at draft (arm screen capture when prompted).

> **`.env` loads with override.** `apps/listener/src/load-env.ts` runs first and
> forces the project `.env` to win over any globally-exported `OPENAI_API_KEY`
> (e.g. a `~/.bashrc` export pointing at another provider). Don't rely on
> `node --env-file` here — its precedence is the opposite.

## Windows app (installable .exe)

A one-click desktop build lives in `apps/desktop` (Electron). It bundles the
listener + overlay into a single window, generates the GSI token on first run,
and auto-installs the `.cfg` into Dota if it can find your Steam folder.

- **Get it:** download the setup `.exe` from the latest GitHub release (built by
  `.github/workflows/release.yml` on a Windows runner), or build locally on
  Windows: `pnpm install && pnpm --filter @dc/overlay build`, then
  `cd apps/desktop && npm install && npm run dist` → `apps/desktop/release/`.
- **AI features:** paste your key in Settings (⚙, stored listener-side and
  hot-swapped), put it in `openai-key.txt` inside the app's user-data folder,
  or set `OPENAI_API_KEY`.

The desktop app is intentionally isolated from the pnpm workspace (see
`pnpm-workspace.yaml`'s `!apps/desktop`) — Electron/electron-builder are
installed with `npm` and the esbuild-bundled main process lives in
`apps/desktop/dist/main.cjs`.

### Two-terminal dev loop (hot reload)

```bash
GSI_TOKEN=$(cat .gsi-token) pnpm listener   # terminal 1 (API/WS on :53000)
pnpm overlay                                # terminal 2 → http://127.0.0.1:5273
```

## Develop without Dota (replay a recorded match)

```bash
GSI_TOKEN=$(cat .gsi-token) pnpm listener   # terminal 1
pnpm overlay                                # terminal 2
GSI_TOKEN=$(cat .gsi-token) pnpm replay     # terminal 3
```

## Updating static data on patch day

```bash
pnpm up dotaconstants && pnpm gen-data   # prune dotaconstants → checked-in JSON
pnpm gen-hero-builds                     # regenerate the per-hero fun pools (needs OPENAI_API_KEY)
```

`scripts/gen-coach-data.mjs` prunes dotaconstants (~2.5 MB) down to the ~250 KB
the engines actually need (damage type, BKB pierce, dispellability, per-level
damage/cooldown/mana, item costs, OpenDota item-id map).
`scripts/gen-hero-builds.mjs` asks gpt-5.4 for a fun-but-castable item pool per
hero, validates every name against the item data, and writes
`hero-builds.json`. Both outputs are checked in; Settings shows which game
patch the data was built from and flags when the live patch is newer.

## Layout

- `packages/shared` — pure logic (GSI normalize, timers, economy, threat
  classification, counter-item engine, skill readout, coach tips, hero/item
  name matching, EEG DSP + FlowState scoring, session format, deep-analysis
  context builder, Dota-art asset URLs). Fully unit-tested; static data
  injected as arguments.
- `apps/listener` — Fastify GSI receiver + WebSocket broadcaster, plus the
  optional gpt-5.4 routes (`/coach`, `/item-build`, `/vision`, `/analysis`),
  the `/opendota` caching proxy, and local recording persistence. In prod it
  also serves the built overlay via `@fastify/static` (single process).
- `apps/overlay` — React/Vite UI (a browser page, not an injected overlay):
  the live coaching column + the NeuroFocus Studio dashboard, with Dota CDN
  art for heroes/items/abilities.
- `apps/desktop` — Electron wrapper that produces the one-click Windows
  installer (NSIS via electron-builder).

## CI/CD

- `.github/workflows/ci.yml` — runs `pnpm test` + `pnpm build` on push/PR.
- `.github/workflows/release.yml` — on a `v*` tag, builds the Windows installer
  on a `windows-latest` runner and attaches it to the GitHub release.
