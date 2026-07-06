# Dota 2 Companion (v1 — Live Coach)

Local, read-only Dota 2 coaching companion built to help you climb:
Dota 2 → Game State Integration → local listener → web overlay, with

- **Counter-item advice** — pick the 5 enemy heroes and the engine tells you
  *what to buy right now and why* ("BKB — blocks Lion's Hex and Lina's Laguna
  Blade"), priced against your live gold, phase-aware, role-aware.
- **Skill damage readout** — every skill's damage at its current level, what
  the next point buys, damage type, cooldown and mana — live from GSI.
- **Coach tips** — "what should I do right now": unspent-gold warnings, TP
  discipline, CS benchmarks at 5:00/10:00, night-time warnings, ult-online
  windows, detection reminders vs invisible heroes.
- **Timers & economy** — rune/Roshan/day-night timers and a GPM grade.
- **Ask Coach (optional)** — free-form questions ("why not BKB here?")
  answered by OpenAI **gpt-4o** with your live game state as context.

> **Posture:** read-only, advisory-only. Only Valve's official GSI is used —
> no memory reading, no input automation.

> **Lightweight by design:** the hot loop is a deterministic rules engine over
> ~250 KB of pruned static data — no LLM, no heavy runtime. The LLM (gpt-4o)
> is called only when you press *Ask* and is off unless you provide a key.

## Quick start (macOS or Windows)

```bash
corepack enable && pnpm install
pnpm test                 # run all unit + component tests
pnpm gen-cfg              # generate the GSI .cfg + a token (.gsi-token)
```

Copy `gamestate_integration_dota2-companion.cfg` into your Dota 2 install
(create the `gamestate_integration` folder if it doesn't exist):
- macOS: `~/Library/Application Support/Steam/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration/`
- Windows: `<Steam>\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\`

Then add `-gamestateintegration` to Dota 2's launch options
(Steam → Library → right-click Dota 2 → Properties → Launch Options).
**Without this launch option Dota never sends data and the overlay stays empty.**

Run the companion:

```bash
GSI_TOKEN=$(cat .gsi-token) pnpm listener   # terminal 1
pnpm overlay                                # terminal 2 → http://127.0.0.1:5273
```

On Windows PowerShell, set the env var like this instead:

```powershell
$env:GSI_TOKEN = Get-Content .gsi-token; pnpm listener   # terminal 1
pnpm overlay                                             # terminal 2
```

Launch Dota 2 and enter a match (a bot lobby works for testing) — the overlay
updates live. Pick the enemy heroes in the overlay once the draft locks to
unlock counter-item advice, and set your role (core/support) at the top.

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
  classification, counter-item engine, skill readout, coach tips). Fully
  unit-tested; static data injected as arguments.
- `apps/listener` — Fastify GSI receiver + WebSocket broadcaster + optional
  `/coach` endpoint (gpt-4o).
- `apps/overlay` — React overlay UI (web; later wrapped by Overwolf on Windows).
