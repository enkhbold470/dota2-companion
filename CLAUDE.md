# Dota 2 Companion

Local, read-only Dota 2 coaching companion: Dota 2 → Valve Game State
Integration (GSI) → local Fastify listener → React web overlay. Deterministic
rules engines give counter-item advice, skill damage readouts, and coach tips;
an optional `/coach` endpoint answers free-form questions via OpenAI gpt-4o.

**Posture (non-negotiable):** read-only, advisory-only. Only Valve's official
GSI — no memory reading, no input automation, no screen OCR, no render-hook
injection. Enemy heroes are hand-picked in the overlay because live GSI only
exposes the player's own data.

## Commands

```bash
pnpm install              # workspace install (pnpm monorepo, Node >= 20)
pnpm test                 # all unit + component tests (vitest, all packages)
pnpm build                # tsc for shared/listener, vite build for overlay
pnpm gen-cfg              # write GSI .cfg + .gsi-token + .env (GSI_TOKEN line)
pnpm gen-data             # regenerate pruned static data from dotaconstants
pnpm listener             # Fastify GSI receiver on 127.0.0.1:53000 (reads .env)
pnpm overlay              # vite dev server → http://127.0.0.1:5273
pnpm replay               # replay fixtures/sample-match.json into the listener
```

Single-package runs: `pnpm --filter @dc/shared test`,
`pnpm --filter @dc/shared exec vitest run src/items.test.ts`,
`pnpm --filter @dc/listener exec tsc --noEmit -p tsconfig.json`.

## Configuration

- `.env` at the repo root (gitignored), loaded by the listener/replay at boot:
  `GSI_TOKEN=...` (written by `pnpm gen-cfg`) and optional
  `OPENAI_API_KEY=sk-...` for Ask Coach. Real env vars override the file.
- Dota needs the generated `.cfg` copied into
  `.../dota 2 beta/game/dota/cfg/gamestate_integration/` **and**
  `-gamestateintegration` in its Steam launch options.

## Layout & architecture

- `packages/shared` (`@dc/shared`) — all pure logic, fully unit-tested:
  - `normalize.ts` GSI payload → `NormalizedState` (incl. abilities, hasTp)
  - `threats.ts` enemy hero ids → `ThreatReport` (classifies abilities by
    dmg type, BKB pierce, dispellability, disables/invis/evasion/etc.)
  - `items.ts` threat + gold/clock/role → ranked `ItemRecommendation[]`
    with human reasons ("Blocks Lion's Hex...")
  - `skills.ts` GSI abilities + data → `SkillReadout[]` (damage @ level)
  - `coach.ts` phase-aware `CoachTip[]` (TP, gold, CS benchmarks, night...)
  - `coaching-types.ts` — the pinned interfaces; `data.ts` — typed access to
    `src/data/*.json`
  - timers/runes/roshan/economy/format — v0 modules
- `apps/listener` (`@dc/listener`) — Fastify: GSI POST (token-authed),
  `/ws` broadcast, optional `/coach` (gpt-4o, CORS locked to overlay origin)
- `apps/overlay` (`@dc/overlay`) — React + vite; presentational panels in
  `src/components/`, wiring in `App.tsx`
- `scripts/gen-coach-data.mjs` — prunes dotaconstants (~2.5 MB) to ~265 KB of
  checked-in JSON in `packages/shared/src/data/`. Includes facet abilities and
  top-level `dmg`; keeps `dmgType`/`bkbPierce`/`dispellable`/`targetTeam`.

## Conventions

- TypeScript strict + `noUncheckedIndexedAccess` (indexing returns
  `T | undefined` — handle it). 2-space indent, single quotes, semicolons.
- Tests colocated (`foo.ts` + `foo.test.ts`), vitest, TDD-ish; component tests
  use @testing-library. Engines take data maps as arguments (pure functions);
  tests assert against both synthetic maps and the real generated data.
- No new npm dependencies without a strong reason — low RAM is a product goal
  (deterministic hot loop, LLM only on explicit Ask).
- Domain correctness matters: BKB advice must exclude `bkbPierce: 'Yes'`
  abilities, ally-targeted saves are not threats, Slark's Shadow Dance is not
  detectable. When touching threat/item rules, add a real-data regression test.

## Patch-day update

```bash
pnpm up dotaconstants && pnpm gen-data && pnpm test
```

Regenerated JSON is checked in; review the diff for surprises (renamed ability
keys, new facets).
