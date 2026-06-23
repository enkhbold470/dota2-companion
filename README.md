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
