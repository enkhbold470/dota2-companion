# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm** with a workspace (`packages/*`, `apps/*`). Requires Node ≥ 20.

```bash
pnpm install                # bootstrap workspace
pnpm test                   # run vitest across every workspace (recursive)
pnpm build                  # tsc across every workspace
pnpm --filter @dc/shared test         # tests for one package
pnpm --filter @dc/shared test skills  # single test file (vitest name-substring filter)

pnpm gen-cfg                # emits gamestate_integration_dota2-companion.cfg + .gsi-token
pnpm gen-data               # regenerates packages/shared/src/data/*.json from dotaconstants
pnpm start                  # PROD: builds overlay, then one process serves UI+API+WS on :53000
pnpm listener               # apps/listener dev (needs GSI_TOKEN)
pnpm overlay                # apps/overlay dev (Vite on :5273)
pnpm replay                 # apps/listener replay fixtures/sample-match.json
```

`pnpm start` is the shippable single-process entry: the listener serves the built overlay (`apps/overlay/dist`) via `@fastify/static`, so UI, WebSocket, and API share one origin on `:53000` (no CORS in prod). `apps/overlay/src/config.ts` picks endpoints — `:53000` in dev (`import.meta.env.DEV`), same-origin when packaged. CI (`.github/workflows/ci.yml`) runs `pnpm test` + `pnpm build` on push/PR.

The hot-reload dev loop uses **three terminals**: `pnpm listener`, `pnpm overlay`, and (for dev without Dota) `pnpm replay`. The listener needs `GSI_TOKEN` and (for Ask Coach) `OPENAI_API_KEY`. Put both in a repo-root `.env` (gitignored; see `.env.example`) — `apps/listener/src/load-env.ts` loads it **with override** at process start, so a globally-exported `OPENAI_API_KEY` (e.g. a `~/.bashrc` export pointing at another provider) can't shadow the project key. Without `OPENAI_API_KEY` the `/coach` endpoint returns `501 no-key` and the rest of the app is unaffected. `load-env.ts` is imported first in `main.ts`/`replay.ts`; don't rely on `node --env-file` here — its precedence is the opposite (real env wins over the file).

## Architecture

Three workspaces, one direction of data flow:

```
Dota 2 client ──HTTP POST──▶ apps/listener ──WebSocket──▶ apps/overlay
                            (Fastify :53000)             (React/Vite :5273)
                                    │
                                    │ optional: browser POST /coach ──▶ OpenAI gpt-4o
```

- **`packages/shared`** — all pure logic. Every module (`normalize`, `timers`, `runes`, `roshan`, `economy`, `threats`, `items`, `skills`, `coach`, `format`, `auth`) is a pure function tree with static data passed in as an argument. The overlay and listener both depend on it; static data lives inside it as pre-pruned JSON. No I/O, no framework imports.
- **`apps/listener`** — Fastify HTTP server. `POST /` receives raw GSI, authenticates via `auth.token` from the payload against `GSI_TOKEN`, calls `normalizeGsi`, and pushes the `NormalizedState` into `Hub` (a tiny latest-value pub/sub). `GET /ws` is the fan-out WebSocket (sends the latest snapshot on connect, then every update). `POST /coach` proxies to OpenAI, gated by `OPENAI_API_KEY`, with CORS restricted to the overlay origin (`http://127.0.0.1:5273` by default; override with `COACH_ALLOW_ORIGIN`) so a random tab can't spend the key. Recording persistence also lives here (the overlay can't write files): `POST /recording` (EEG session JSON), `POST /video/start|chunk|finish` (chunked screen-capture webm), and `GET /recordings` + `GET /recordings/file` (listing via head-parse + Range-capable playback) — all against the local recordings folder.
- **`apps/overlay`** — React (Vite). `useGsiSocket` maintains a resilient WS to `ws://127.0.0.1:53000/ws` with a 1s reconnect loop. `App.tsx` is the composition root: it derives every panel (timers, economy grade, threat report, item recs, skill readout, coach tips, ask coach) from the incoming `NormalizedState` plus the user-picked enemy heroes and role. Everything below `App.tsx` is a dumb presentational component.
- **`apps/desktop`** — Electron wrapper (product name **"Dota 2 NeuroSync"**, by NeuroFocus). Deliberately **excluded from the pnpm workspace** (`!apps/desktop` in `pnpm-workspace.yaml`); it gets its own `npm install` so Electron never enters the main lockfile. See "Desktop packaging & releases" below.

### The hot loop is deterministic on purpose

The coaching engines (`threats.ts`, `items.ts`, `skills.ts`, `coach.ts`) are a rules engine over the pruned static data — no LLM in the tick path. LLM calls (`gpt-4o`) live in listener routes and are only fired on explicit/debounced user actions, never per GSI tick: `coach-route.ts` (Ask Coach + Quick read) and `item-route.ts` (`POST /item-build`, JSON-mode hero-tuned item builds). The overlay's `AiItemPanel` is the primary item advice (auto-refreshes on draft/hero/role change, plus a manual refresh); the deterministic `items.ts` engine is kept as the **no-key fallback**. When adding coaching logic that must run every tick, keep it inside `packages/shared` and unit-testable; do **not** reach for network calls in the live path.

### Static data pipeline

`packages/shared/src/data/{hero-data,ability-data,item-data,data-meta}.json` are **generated artifacts checked in to the repo**. Source is `scripts/gen-coach-data.mjs`, which prunes ~2.5 MB of `dotaconstants` down to ~250 KB by filtering damage/duration attribs, normalizing `bkbPierce`/`dispellable`/`targetTeam` enums, and merging facet-gated abilities into each hero's list (we can't tell which facet the player picked, so all appear). On patch day: `pnpm up dotaconstants && pnpm gen-data`, then commit the diff. Do not hand-edit these JSON files.

### Desktop packaging & releases

`apps/desktop` bundles the listener + built overlay into installers via electron-builder (`npm run dist` inside `apps/desktop`). Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds Windows NSIS + macOS dmg/zip, attaches them plus the `latest*.yml` auto-update feeds to the GitHub release, and uses `docs/INSTALL.md` as the release body (that file is the user-facing installation page — keep it current). Hard-won constraints, all commented in `apps/desktop/electron-builder.yml`:

- **`appId` (`com.enkhbold470.dota2companion`) is identity, not branding** — it keys the NSIS uninstall entry and the userData dir (GSI token, OpenAI key, recordings). Product renames must never change it.
- **macOS must be ad-hoc signed** even without an Apple cert: electron-builder edits Info.plist after packing, which invalidates the prebuilt Electron's ad-hoc seal, and Apple Silicon then refuses the quarantined app as *"damaged"* (no Gatekeeper bypass). The `afterPack` hook `build/mac-adhoc-sign.cjs` re-signs with `codesign --force --deep --sign -`, downgrading it to the normal warning that `xattr -dr com.apple.quarantine` / "Open Anyway" clears. Real fix (Developer ID + notarization) is still TODO before charging users.
- **Never override `CFBundleName` via `extendInfo`** (e.g. to shorten the menu-bar name): Electron locates its helpers as `<CFBundleName> Helper.app`, and electron-builder names them from `productName` — a mismatch crashes at launch with "Unable to find helper app".
- **macOS auto-update cannot go through Squirrel.Mac** (Electron's built-in `autoUpdater` install path): ShipIt validates the downloaded app against the *running* app's designated requirement, and an ad-hoc signature's DR is a per-build cdhash — so every update is rejected with "Code signature … did not pass validation". `apps/desktop/src/mac-update.ts` replaces the install step: download the release zip itself, sha512-verify it against `latest-mac.yml`, swap the .app bundle backup-first, relaunch. Never call `autoUpdater.downloadUpdate()` on darwin (checking is fine — that only reads the feed). Side benefit: self-downloaded updates carry no quarantine flag, so no repeat `xattr` after updating.
- **Artifact names must be space-free** (`Dota2-NeuroSync-…`): GitHub converts spaces in asset names to dots but `latest.yml` keeps hyphens → auto-update 404s.
- Don't set `nsis.publisherName` — electron-updater would then require Authenticode-signed updates, which an unsigned build fails.

### Normalization invariants worth knowing

- `normalizeGsi` filters cosmetic and talent pseudo-abilities via a regex (`special_bonus`, `plus_`, `seasonal_`, `abyssal_underlord_portal_warp`); real ability lists in `NormalizedState.abilities` are already clean.
- `hasTp` reads only slot `teleport0` — not the backpack or inventory slots.
- `noUncheckedIndexedAccess: true` is set in `tsconfig.base.json`, so `arr[i]` is `T | undefined`. New code must handle that.
- Recorded EEG sessions (`neurofocus_ble_eeg_v2`) carry two timebases: `t` is the GSI game clock (seconds, negative pre-horn), `tMs` is wall clock (epoch ms). `packages/shared/src/session.ts` builds the bidirectional map between them — that's how the review UI seeks the screen recording to a focus dip. The session writer keeps scalars + `video` before the big arrays (samples last) so `GET /recordings` can head-parse metadata via `parseSessionHead` without reading megabytes.
- **EEG sample rate is 175 SPS, hardcoded as `EEG_FS` in `packages/shared/src/dsp.ts`** — the ADS1220 runs DR_LVL_3 (verify: `../neurofocus/firmware/v4/src/ads1220_driver.cpp`), NOT the 600 the firmware docs mention. Never measure fs from BLE arrival timing; jitter would corrupt the frequency axis. `dsp.ts` is the pure DSP (detrend → software mains notch → 1–45 Hz band-pass → Welch PSD → band powers); `eeg.ts` consumes it. The overlay talks to the board via the `EEGSource` interface (`apps/overlay/src/eeg/eegSource.ts`, `WebBluetoothEEGSource` + `StubEEGSource`); transport/frame-decode is `neurofocusSource.ts`.
- **GSI exposes only the LOCAL player while playing** — no enemy/ally hero data (server-side fog of war; all ten players only when spectating). `normalizeGsi` surfaces `gameState`/`phase` (via `gamePhase()`) and `team` (from `player.team_name`). Enemy+ally auto-detection therefore reads our own screen: `useAutoDraft` grabs one frame at draft (`ScreenRecorder.grabFrame` on the armed capture stream) → `POST /vision {mode:'draft'}` (returns `{radiant,dire}`) → `splitDraftByTeam(team, …)` in shared → enemies drive threats/items, allies are display-only. Falls back to the manual `EnemyPicker`/`HeroAnalyzer` when capture isn't armed or there's no OpenAI key. The vision scan is event-triggered once per draft — never in the per-tick path.

### Posture (non-negotiable)

Read-only, advisory-only. **Only Valve GSI** is consumed — no memory reading, no input automation. The listener binds `127.0.0.1` only. The overlay is a browser page, not an injected overlay. Don't add features that violate this posture (see `BUILD_BLUEPRINT.md` §8 for the ToS discussion).

## Testing conventions

- Vitest across the whole tree. `packages/shared` and `apps/listener` are pure Node vitest; `apps/overlay` uses `jsdom` + `@testing-library/react` (setup in `src/test-setup.ts`).
- Tests colocate with source: `foo.ts` ↔ `foo.test.ts`.
- `packages/shared/src/__repro_verify__.test.ts` is a **debug harness**, not an assertion suite — it logs threat/item outputs for hand-picked enemy compositions so you can `pnpm --filter @dc/shared test __repro_verify__` and read the console. Don't turn it into real assertions; it's meant to be edited.
