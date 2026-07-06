# Dota 2 Companion (v0.2.0 — Live Coach)

Local, read-only Dota 2 coaching companion built to help you climb:
Dota 2 → Game State Integration → local listener → web overlay, with

- **AI item build** — hero-tuned, enemy-aware buy order from **gpt-4o**, with a
  **Meta ⇄ Fun 🎉** toggle: *Meta* gives the optimal winning build, *Fun* leans
  into spicy high-impact picks (Dagon, Ethereal Blade, Refresher, Daedalus…)
  that are still castable on your hero. Priced against live gold with a
  **BUY NOW** flag; auto-refreshes on draft/hero/role change. Falls back to a
  deterministic rule-based counter-item engine when no key is set.
- **Hero analyzer (vision)** — paste or upload a screenshot of the draft and
  gpt-4o detects the **enemy** heroes (your own hero and allies filtered out),
  so you don't have to type them in.
- **Skill damage readout** — every skill's damage at its current level, what
  the next point buys, a **LEVEL UP** hint for the next skill point, damage
  type, cooldown and mana — live from GSI, with ability icons.
- **Coach tips** — "what should I do right now": unspent-gold warnings, TP
  discipline, CS benchmarks at 5:00/10:00, night-time warnings, ult-online
  windows, detection reminders vs invisible heroes.
- **Timers & economy** — rune/Roshan/day-night timers and a GPM grade.
- **Ask Coach (optional)** — free-form questions ("why not BKB here?")
  answered by OpenAI **gpt-4o** with your live game state as context.

> **Posture:** read-only, advisory-only. Only Valve's official GSI is used —
> no memory reading, no input automation.

> **Lightweight by design:** the hot loop is a deterministic rules engine over
> ~250 KB of pruned static data — no LLM, no heavy runtime. LLM calls (gpt-4o)
> fire only on explicit/debounced user actions (item build, hero vision, Ask
> Coach) — never per GSI tick — and are off unless you provide a key.

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
`.env.example`. Launch Dota 2 and enter a match; the overlay updates live. Pick
the enemy heroes (search, or paste a screenshot into the hero analyzer) to
unlock counter-item advice and the AI item build.

> **`.env` loads with override.** `apps/listener/src/load-env.ts` runs first and
> forces the project `.env` to win over any globally-exported `OPENAI_API_KEY`
> (e.g. a `~/.bashrc` export pointing at another provider). Don't rely on
> `node --env-file` here — its precedence is the opposite.

## Windows app (installable .exe)

A one-click desktop build lives in `apps/desktop` (Electron). It bundles the
listener + overlay into a single window, generates the GSI token on first run,
and auto-installs the `.cfg` into Dota if it can find your Steam folder.

- **Get it:** download `Dota 2 Companion Setup *.exe` from the latest GitHub
  release (built by `.github/workflows/release.yml` on a Windows runner), or
  build locally on Windows: `pnpm install && pnpm --filter @dc/overlay build`,
  then `cd apps/desktop && npm install && npm run dist` → `apps/desktop/release/`.
- **AI features:** put your key in `openai-key.txt` inside the app's user-data
  folder (the first-run dialog shows the path), or set `OPENAI_API_KEY`.

The desktop app is intentionally isolated from the pnpm workspace (see
`pnpm-workspace.yaml`'s `!apps/desktop`) — Electron/electron-builder are
installed with `npm` and the esbuild-bundled main process lives in
`apps/desktop/dist/main.cjs`.

### Two-terminal dev loop (hot reload)

```bash
GSI_TOKEN=$(cat .gsi-token) pnpm listener   # terminal 1 (API/WS on :53000)
pnpm overlay                                # terminal 2 → http://127.0.0.1:5273
```

### Enable Ask Coach (optional, needs an OpenAI key)

```bash
OPENAI_API_KEY=sk-... GSI_TOKEN=$(cat .gsi-token) pnpm listener
```

Without a key everything else works; the Ask panel just shows a setup hint.

## Develop without Dota (replay a recorded match)

```bash
GSI_TOKEN=$(cat .gsi-token) pnpm listener   # terminal 1
pnpm overlay                                # terminal 2
GSI_TOKEN=$(cat .gsi-token) pnpm replay     # terminal 3
```

## Updating static data on patch day

```bash
pnpm up dotaconstants && pnpm gen-data
```

`scripts/gen-coach-data.mjs` prunes dotaconstants (~2.5 MB) down to the
~250 KB the engines actually need (damage type, BKB pierce, dispellability,
per-level damage/cooldown/mana, item costs). The output is checked in.

## Layout

- `packages/shared` — pure logic (GSI normalize, timers, economy, threat
  classification, counter-item engine, skill readout, coach tips, hero/item
  name matching, Dota-art asset URLs). Fully unit-tested; static data injected
  as arguments.
- `apps/listener` — Fastify GSI receiver + WebSocket broadcaster, plus the
  optional gpt-4o routes: `/coach` (Ask Coach + quick read), `/item-build`
  (JSON-mode Meta/Fun item builds), `/vision` (screenshot → enemy heroes). In
  prod it also serves the built overlay via `@fastify/static` (single process).
- `apps/overlay` — React/Vite overlay UI (a browser page, not an injected
  overlay), with Dota CDN art for heroes/items/abilities.
- `apps/desktop` — Electron wrapper that produces the one-click Windows
  installer (NSIS via electron-builder).

## CI/CD

- `.github/workflows/ci.yml` — runs `pnpm test` + `pnpm build` on push/PR.
- `.github/workflows/release.yml` — on a `v*` tag, builds the Windows installer
  on a `windows-latest` runner and attaches it to the GitHub release.
