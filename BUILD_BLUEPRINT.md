# Dota 2 Agentic Companion - Build Blueprint

> **One-line thesis.** Build a read-only, advisory-only Dota 2 coaching companion whose killer feature is a **live, explained Counter-Item Engine** — it reasons over *your* live game state (via Valve GSI) plus *which heroes* you're up against, and tells you exactly what to buy right now, why, with win-rate evidence. Everything else (timers, draft help, agentic post-game review, optional EEG focus layer) orbits that core.
>
> **The user's #1 pain, restated:** *"I'm mid-match, the enemy lineup is wrecking me, and I don't know what to buy right now with the gold I have."* This document is organized to answer that question first and best.
>
> **Posture, non-negotiable:** read-only, advisory-only. No memory reading, no injection, no input automation. Every live signal is Valve's official Game State Integration (GSI); every analytic is OpenDota; every static fact is dotaconstants.

---

## 1. The opportunity & what's genuinely new in 2026

The Dota 2 companion space has three established layers, and a clear gap an agentic + biometric build can own.

**The incumbents:**
- **Valve Dota Plus** (~$4/mo, in-client): the only tool with privileged live enemy-aware draft + build suggestions, sourced from millions of bracketed games. It is a *silent rules engine* — it tells you *what*, never *why*. This is the bar.
- **Stats sites** (Dotabuff/Dotabuff Plus, Stratz, OpenDota): post-game analysis, hero/item meta, APIs. Not live, not conversational.
- **Overwolf overlays** (DotaPlus by Overwolf, Dota Coach): live GSI overlays with static guides, counters, timers. No reasoning, no natural-language Q&A.
- **GOSU.AI** (the 2017-era "AI coach"): pioneered async "send replay, get advice in seconds." Acquired by Sber 2021, now **defunct** — and it predated practical LLMs. Its canned-report model is exactly what agentic review now supersedes.

**What is genuinely new in 2026 (LLM + MCP + multimodal + voice):**
1. **Reasoning over fused state.** An LLM can fuse live GSI self-state + static Valve mechanics + historical win-rates into one prioritized, *explained* recommendation. No incumbent explains *why*.
2. **Free-form Q&A, live and post-game.** "Why not BKB here?" / "Why did I lose lane?" — answered conversationally.
3. **Natural-language → SQL over your own history** via OpenDota `/explorer`. No fixed overlay can do open-ended personal analytics.
4. **Low-latency voice** so advice lands without tabbing out (sub-second speech stacks exist: Moshi ~200ms, OpenAI Realtime ~320ms, Gemini 3.1 Flash Live native audio — though real pipelines with tool-calls land toward the higher end of an ~800ms–few-second budget).
5. **Multimodal vision** to recover the one thing GSI withholds (enemy draft) by OCR-ing your own draft screen — *technically* possible, ToS-gray (see §8), never the default.
6. **An MCP server** that turns the whole system into "any agent + a Dota toolbelt."

**The market already validates the live-coach category:** GankAI (36 GSI-driven coaching engines, marketed VAC-safe), LaneMind (live overlay + agentic post-game review, bring-your-own LLM key), HyperX × Neurable (CES 2026 brain-tracking gaming headset with focus/fatigue overlay + anti-tilt framing), and the open-source BrightGir/dota-ai-coach (Go, GSI → localhost:6000, RAG over a curated knowledge base, F10 ask-coach). The open lane: **conversational, explained, fresh coaching — plus an optional focus/tilt loop — that no incumbent offers.**

**The single fact that shapes the entire product** (verified three independent ways): *as an active player, Valve GSI exposes only YOUR own data; the live enemy draft, enemy items, and all-player positions are spectator-only.* So we cannot replicate Dota Plus's live enemy-aware draft intel. We pivot to what is buildable and defensible: **enemy-HERO-conditioned counter advice** (you do know which heroes you face, once picks lock), **your-own-build optimization** off your live economy, **macro timers**, and **agentic post-game review**.

---

## 2. Architecture at a glance

```
                         ┌──────────────────────── DOTA 2 CLIENT (user's PC) ─────────────────────────┐
                         │  game/dota/cfg/gamestate_integration/gamestate_integration_companion.cfg     │
                         │    uri http://127.0.0.1:53000/  throttle 0.1  buffer 0.1  heartbeat 30       │
                         │    auth.token <secret>   data{ provider map player hero abilities items      │
                         │                                buildings draft wearables }                    │
                         └────────────────────────────────┬───────────────────────────────────────────┘
                                                           │ HTTP POST JSON (≤10 Hz, OWN-PLAYER ONLY)
                                                           ▼
 ┌──────────────────────── LOCAL COMPANION PROCESS (Overwolf / ow-electron app) ──────────────────────────┐
 │                                                                                                          │
 │  ┌────────────┐  GameState   ┌───────────────────┐  triggers  ┌──────────────────────────────────┐    │
 │  │ GSI        │ ───────────► │ NORMALIZER +       │ ─────────► │ AGENT ORCHESTRATOR (hot loop)    │    │
 │  │ LISTENER   │  (auth, diff,│ EVENT DETECTOR     │ (debounced)│  - rules pre-filter (candidates) │    │
 │  │ :53000     │   ~10 Hz)    │ FSM: DRAFT/LANE/   │            │  - fast LLM (rank + explain)     │    │
 │  │ replies 200│              │ MID/LATE/DEAD      │            │  - COUNTER-ITEM ENGINE (§3)      │    │
 │  └────────────┘              └─────────┬─────────┘            └──────────────┬───────────────────┘    │
 │                                        │ reads                                │ tool calls (MCP)       │
 │                                        ▼                                      ▼                        │
 │                         ┌──────────────────────────┐        ┌──────────────────────────────────┐      │
 │                         │ LOCAL CONTEXT STORE       │◄───────│ MCP SERVER (stdio + HTTP)        │      │
 │                         │  - live self snapshot     │ cached │   gsi.*  opendota.*  constants.* │      │
 │                         │  - enemy hero IDs (picks) │        │   explorer.read_cache  counter.* │      │
 │                         │  - prefetched meta cache  │        └───────────┬──────────────────────┘      │
 │                         └──────────────┬───────────┘                     │ HTTPS (cached only)         │
 │   ┌──────────────────────┐            │ surfaced advice                  ▼                             │
 │   │ NEUROFOCUS STREAM     │            ▼                    ┌────────────────────────────┐             │
 │   │ (optional, on-device) │   ┌──────────────────────────┐ │ BACKEND / CACHE TIER        │             │
 │   │ EEG SDK → focus/tilt  │──►│ OVERLAY (transparent,     │ │ local SQLite + (opt) remote │             │
 │   │ state model (1–10 Hz) │   │ click-through)            │ │  - constants (by patch)     │             │
 │   │ joined by SESSION CLK │   │  cards · timers · Ask-    │ │  - matchups/itemPopularity  │             │
 │   └──────────────────────┘   │  Coach hotkey · voice TTS │ │  - precomputed COUNTER ETL  │             │
 │                              └──────────────────────────┘ └───────────┬─────────────────┘             │
 └──────────────────────────────────────────────────────────────────────│───────────────────────────────┘
                                                                          │ HTTPS (rate-limited, keyed)
                                                                          ▼
                                        ┌───────────────────────────────────────────────────────┐
                                        │ OpenDota API  api.opendota.com/api  (POST-GAME/AGGREGATE)│
                                        │  /constants /heroStats /benchmarks /heroes/{id}/matchups │
                                        │  /heroes/{id}/itemPopularity /scenarios/itemTimings      │
                                        │  /matches/{id} /explorer(SQL,BATCH ONLY) /players/{id}    │
                                        └───────────────────────────────────────────────────────┘

 POST-GAME (async):  match ends → POST /request/{id} (cost 10) → poll GET /request/{jobId} → null
                     → GET /matches/{id} (parsed) → agentic review (purchase_log, gold_t, wards, benchmarks)
```

**Three planes, joined only where legitimate:**
- **Live plane = GSI only** (own-player). The hot loop reads GSI + local cache; **never** calls OpenDota synchronously.
- **Analytics plane = OpenDota** (post-game/aggregate), pre-fetched and cached. `/explorer` SQL is a **nightly-ETL batch tool**, never runtime.
- **Biometric plane = EEG** (optional, on-device), joined to the others **only by a session clock** — never co-mingled (see §5, §8).

---

## 3. The Counter-Item Engine (the killer feature)

This is the heart of the product. It answers *"what do I buy right now, and why?"* in ~1–2s.

### 3.1 The two facts that collapse the design space

1. **Enemy-HERO-conditioned, not enemy-ITEM-conditioned.** GSI won't give you live enemy builds while you play, but the enemy *hero identities* are public once picks lock (scoreboard). So we recommend *your* counter items keyed off *which heroes* oppose you + *your own* live gold/role/items/timing (which GSI gives in full). This is exactly where counter decisions actually live.
2. **`/explorer` is a build-time tool, not a runtime one.** It has a hard 15s statement timeout, only 2 site-wide connections, and times out on any non-trivial `player_matches`/`public_matches` scan (verified: `Error: Query read timeout` at ~15.15s). **All enemy-conditioned analytics are precomputed offline** into our own cache.

### 3.2 Inputs

**Live (GSI, ~1–10 Hz):** your `hero.id/level/has_aghanims_*`, `player.gold/net_worth/gpm/xpm/last_hits`, `items.slot0..8` (+stash/neutral, names+charges), `map.clock_time/game_state/roshan_state`, your team draft, and **enemy hero IDs** (the conditioning key, from scoreboard post-lock; manual 5-hero picker is the v1 guarantee; vision-OCR is the ToS-gray accelerator).

**Static (bundled, cached by patch, ~0 cost)** — from `/constants/{resource}` or `raw.githubusercontent.com/odota/dotaconstants/master/build/*.json` (no key needed):
- `abilities.json` — the threat-classification gold: **`dmg_type`** (Magical/Physical/Pure), **`bkbpierce`** (Yes/No), **`dispellable`** (Yes / No / "Strong Dispels Only"). These three are **authoritative** — extracted directly from Valve's `npc_abilities.txt` KV (`AbilityUnitDamageType`, `SpellImmunityType`, `SpellDispellableType`).
- `items.json` (counter semantics live in `abilities[].description` prose), `item_ids.json` (numeric↔string-key map), `hero_abilities.json`, `heroes.json` (base stats for EHP math), `aghs_desc.json`, `skillshots.json`.

**Precomputed analytics (nightly ETL → our DB):** `/heroes/{id}/itemPopularity` (pro builds by phase), `/scenarios/itemTimings?item=` (win-rate by timing per hero), `/heroes/{id}/matchups` (hero counters), `/benchmarks?hero_id` (percentile curves), and the flagship `/explorer` enemy-conditioned builds (§3.5).

### 3.3 Threat model

For each enemy hero, join `hero_abilities.json` → `abilities.json` and read the three structured fields. Verified decision table (exact values):

| Enemy ability | dmg_type | bkbpierce | dispellable | Counter logic |
|---|---|---|---|---|
| Lion Hex | Magical | **No** | Strong Dispels Only | BKB blocks it; only strong dispel cleanses |
| Bane Fiend's Grip | Pure | **Yes** | Strong Dispels Only | **BKB does NOT save you** — pierces; need Linken's/Lotus/Aeon |
| Global Silence | — | **Yes** | Yes | BKB no help; any basic dispel (Lotus/Manta/Eul's) breaks it |
| Axe Berserker's Call | — | **Yes** | **No** | BKB no help, undispellable — outrange/position/kill Axe |
| CM Frostbite | Magical | **No** | Yes | BKB stops it; Lotus/Manta dispel |
| LC Duel | — | **Yes** | No | BKB no help, undispellable |

**Critical caveats (stated plainly, not overclaimed):**
- These three fields cover only ~19–21% of *all* 3084 ability rows (the file includes talents/stubs); coverage on real targeted hero abilities is far higher. Handle nulls gracefully.
- **CC type (stun/silence/root/slow/hex/sleep) has NO enum** and is only weakly inferable from `attrib[]` keys (~33% hit rate; roots/silences/hexes usually have none — e.g. Frostbite is a root but its attribs contain no "root" key). **→ Maintain a small hand-curated `ability_overrides` table** for CC type + missing fields. This is stable Dota domain knowledge.

We aggregate the enemy kit into a ranked `ThreatVector`: `{magic_burst_single, magic_aoe, physical_dps, silences, hard_disables, illusions, summons, evasion, healing_sustain, blink_mobility, invisibility, bkb_piercing_disables, break, pure_damage}`, each scored `presence × phase_scaling × your_vulnerability` (vulnerability from `heroes.json` base HP/armor/MR).

### 3.4 The hybrid rule + data + LLM algorithm

**Layer A — Rule/Knowledge (threat → candidate items).** A hand-authored `threat→item` map (~25 items × ~14 categories), the stable core of counter theory, with each candidate *gated by the structured fields* so we never give wrong advice:

| Threat (with field gate) | Counter items |
|---|---|
| Magic burst, `bkbpierce=No` | **BKB**, Pipe, Glimmer, Hood/Shroud |
| Magic burst, `bkbpierce=Yes` (Bane/AA/Silencer) | Linken's, Lotus, Manta-dispel, Aeon — **NOT BKB** |
| Single-target disable, `dispellable=Yes` | Lotus (reflect+dispel), Eul's, Manta, Guardian Greaves |
| Single-target disable, `Strong Dispels Only` | Manta, BKB, Aeon (basic dispel won't cleanse) |
| Physical right-click carry | Armor (Assault/Shiva/Crimson/Solar), Ghost/Ethereal, **Halberd** (disarm), Force/Pike kite, Blade Mail |
| Illusions / summons | Cleave/AoE (Battlefury, Mjollnir, Radiance, Shiva), Crimson, Pipe |
| Evasion | **MKB**, Bloodthorn (true strike) |
| Healing / lifesteal / regen | **Spirit Vessel**, Shiva (−heal aura), Skadi (heal-reduce on hit) |
| Invisibility | **Sentry + Dust + Gem**, Bloodthorn (silence) |
| Blink initiation | Lotus/Linken's (absorb), Eul's/Force (reposition), Atos/Sheepstick (lock) |
| Break (Silver Edge/Doom) | status resist (Sange line), repositioning |

Item *semantics* (what BKB/Lotus/Manta actually do) are read from `items.json` prose **once** and frozen into a structured `item_capability` table (`provides_basic_dispel`, `reflects_targeted`, `magic_barrier`, `grants_spell_immunity`, …) keyed off the ~20 relevant items.

**Layer B — Data (rank/justify with evidence).** Three precomputed signals attach to each candidate: (1) pro build-rate (`itemPopularity`), (2) timing win-rate (`scenarios/itemTimings` — a per-hero curve, **not** enemy-conditioned), (3) the flagship **enemy-conditioned build-rate + win-rate-delta** from the nightly `/explorer` ETL.

**Layer C — LLM Reasoning (the final ranked, gold/role/timing-aware list).** A *fast* model on the hot path receives a compact, pre-assembled JSON context (NOT raw API) and **ranks the pre-vetted candidate set** — it does not invent items. Its job: affordability gate (within current gold, or "save N more"), role-appropriateness (pos5 ≠ carry), phase/timing priority (the threat live *now*), dedupe vs owned + ally items, and a one-line *why* per item with cited evidence. System prompt: *"Recommend only from `candidates`. Cite the evidence field. If gold is short, say buy-now + save-toward. One sentence per item."*

### 3.5 The actual `/explorer` SQL (run nightly, NOT live)

**Query 1 — what winning {yourHero} players build vs enemy {enemyHero} (final inventory):** *(verified live; AM vs PA → bfury, manta, power_treads)*

```sql
SELECT unnest(ARRAY[pm.item_0,pm.item_1,pm.item_2,
                    pm.item_3,pm.item_4,pm.item_5]) AS item_id, count(*) AS n
FROM player_matches pm
JOIN matches m            ON m.match_id = pm.match_id
JOIN player_matches enemy ON enemy.match_id = pm.match_id
WHERE pm.hero_id = :your_hero
  AND ((pm.player_slot < 128) = m.radiant_win)              -- winners only
  AND enemy.hero_id = :enemy_hero
  AND (enemy.player_slot < 128) <> (pm.player_slot < 128)   -- opposite team
GROUP BY item_id
HAVING count(*) >= 20                                       -- min-sample guard
ORDER BY n DESC;   -- filter item_id 0 (empty slot)
```

**Query 2 — median item *timings* vs that enemy, winners only:** *(verified: winning AM vs PA → bfury 859s ≈ 14:20, manta 1239s, BKB 2052s)*

```sql
WITH plog AS (
  SELECT m.radiant_win,
         json_array_elements(array_to_json(pm.purchase_log)::json) AS p
  FROM player_matches pm
  JOIN matches m ON m.match_id = pm.match_id
  JOIN player_matches enemy
    ON enemy.match_id = pm.match_id
   AND (enemy.player_slot < 128) <> (pm.player_slot < 128)
   AND enemy.hero_id = :enemy_hero
  WHERE pm.hero_id = :your_hero
    AND ((pm.player_slot < 128) = m.radiant_win))
SELECT (p->>'key') AS item, count(*) AS n,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY (p->>'time')::int) AS median_t
FROM plog
WHERE p->>'key' IN ('black_king_bar','manta','monkey_king_bar',
                    'spirit_vessel','lotus_orb','nullifier')
GROUP BY item HAVING count(*) >= 20 ORDER BY median_t;
```

**Query 3 — win-rate uplift of a *fast* counter-item vs that enemy:** *(verified: fast BKB vs PA = 76.7% WR but n=30 — illustrates exactly why confidence must be surfaced)*

```sql
SELECT (EXISTS (SELECT 1 FROM unnest(pm.purchase_log) pl
                WHERE (pl->>'key')='black_king_bar'
                  AND (pl->>'time')::int < 1080)) AS fast_bkb,        -- before 18:00
       count(*) AS games,
       avg(((pm.player_slot<128)=m.radiant_win)::int) AS winrate
FROM player_matches pm
JOIN matches m ON m.match_id = pm.match_id
JOIN player_matches enemy
  ON enemy.match_id = pm.match_id
 AND (enemy.player_slot<128)<>(pm.player_slot<128) AND enemy.hero_id = :enemy_hero
WHERE pm.hero_id = :your_hero
GROUP BY fast_bkb;
```

**ETL discipline (non-negotiable):**
- `HAVING count(*) >= 20` everywhere; **surface confidence (n)** in the UI. The explorer corpus is **pro/notable matches only (~250k matches, ~2.5M player rows, ~1,600 in last 30 days)** — *not* the public ladder, and low-N for rare pairs. A "76.7% WR (n=30)" must never look authoritative.
- `purchase_log` keys are **string names**; `item_0..5` are **numeric ids** — reconcile through `item_ids.json`.
- **Never** JOIN `public_player_matches` (does not exist — `/schema` misleadingly lists it) or `scenarios` (SELECT-denied via SQL; use the endpoint).
- Bound every query, never self-join unbounded `public_matches` (~173M rows). Run off-peak; cache JSON keyed `(hero, enemy, patch)`.

### 3.6 Worked example

> **Enemy:** Phantom Assassin, Riki, Lina, Tidehunter, Underlord
> **You:** Lion (pos5), 1850 gold, 21:40, items: Arcane Boots, Wind Lace, TP

```
COUNTER PRIORITIES — buy now (you have 1850g):

1. Glimmer Cape (1850g)  ✅ affordable now
   → vs PA + Lina burst: magic barrier + active invis to escape PA's crit
     window. Pro pos5-Lion build-rate 66%; +4.1% WR by 20:00.

2. Sentry + Dust (175g)  ✅ buy alongside (cheap, urgent)
   → Riki is invisible and snowballing. Vision wins this matchup more than
     any 4k item. Highest-leverage gold you'll spend.

NEXT (save toward):
3. Force Staff (+350g → 2200g)
   → reposition out of PA Phantom Strike / Tide Ravage chains.

⚠ Not BKB for you (pos5): Tide Ravage PIERCES BKB (bkbpierce=Yes), and your
  gold is better as Glimmer+Sentry+Force. For your cores, prioritize
  positioning + Lotus over BKB vs Ravage.
```

Note the engine correctly (a) **gated BKB out** because Ravage pierces, (b) prioritized the *cheap* invis answer by leverage not cost, (c) respected pos5 role + current gold — the exact reasoning a static guide and a silent Dota Plus cannot show.

### 3.7 Why agentic beats a static guide / Dota Plus

| Dimension | Static guide | Dota Plus | **This engine** |
|---|---|---|---|
| Enemy-conditioned | No | Yes (privileged live data) | **Yes** (hero-conditioned via ETL) |
| Gold/role/timing aware *now* | No | Partial (canned 3 builds) | **Yes** (live GSI gold + owned items) |
| Explains **WHY** | No | **No** (silent) | **Yes** (field gate + WR evidence) |
| Conversational ("why not BKB?") | No | No | **Yes** |
| Field-correct gating (pierce/dispel) | author's memory | opaque | **Yes** (Valve fields) |
| Stays fresh without human rewrites | No | n/a | **Yes** (nightly ETL) |

The leap is **fusing three siloed sources into one reasoned, justified, gold-aware recommendation with a natural-language "why."** Dota Plus has the data moat; we win on reasoning + explanation + freshness, accepting we can't see live enemy *builds*.

---

## 4. Live data: GSI vs OpenDota vs Stratz — what comes from where

Be precise: **enemy live draft = GSI (and only the hero IDs, public post-lock); history/analytics = OpenDota.** There is no single source for everything; correctly routing each signal is the core architecture.

| Signal you need | Source | Reality (verified) |
|---|---|---|
| **Your** live hero/gold/items/abilities/cooldowns | **GSI** | Full, ~1–10 Hz, own-player only |
| Clock / day-night / Roshan timer / rune-stack windows / your buyback | **GSI** `map.*`, `hero.buyback_*` | Global state, fully available while playing |
| Your team's buildings | **GSI** `buildings` | Your team reliably; enemy only as your client sees |
| **Enemy hero IDENTITIES** (the draft) | **GSI** (post-lock scoreboard) / manual picker / vision-OCR | Picks are public to your client once locked. GSI's `draft` block reflects only what your client legitimately sees. **Pre-lock enemy scouting is impossible** — Valve hid player profiles until STRATEGY_TIME (Feb 2023 patch). |
| **Live enemy items / gold / positions / cooldowns** | ❌ **Nowhere (as a player)** | GSI all-player data is **spectator-only** (anti-cheat). This cannot be obtained legitimately while playing. |
| Your currently-live match state from a web API | ❌ **Nowhere** | OpenDota `/live` returns only top ~100 featured/high-MMR games, *not your match*. |
| Hero counters (W/L vs every hero) | **OpenDota** `/heroes/{id}/matchups` | Aggregate, cheap, no parse |
| Pro item builds by phase | **OpenDota** `/heroes/{id}/itemPopularity` | Pro games, bucketed start/early/mid/late |
| Item win-rate by timing | **OpenDota** `/scenarios/itemTimings?item=` | Items ≥1400g, per-hero, **not enemy-conditioned** |
| Performance benchmarks (GPM/XPM/LH percentiles) | **OpenDota** `/benchmarks?hero_id` | For grading your live pace |
| Meta pick/win/ban by bracket | **OpenDota** `/heroStats` | Per-rank-bracket + pro |
| Your profile / history / MMR trend | **OpenDota** `/players/{id}` (+`/wl`,`/recentMatches`,`/ratings`) | rank_tier + computed_mmr (solo MMR is gone) |
| Deep post-game (purchase_log, gold_t, wards, lanes, teamfights) | **OpenDota** `/matches/{id}` | **Only if PARSED** — `POST /request/{id}` (cost 10) → poll `GET /request/{jobId}` → re-GET. ~3 min parse lag (`/health.parseDelay`). |
| Custom analytics (enemy-conditioned builds, ward heatmaps) | **OpenDota** `/explorer` SQL | **Batch/ETL only** — 15s timeout, 2 connections, times out on big scans |
| Richer derived metrics (win-prob, IMP impact, field-efficient queries) | **Stratz** GraphQL (optional secondary) | Bearer-token; ~20/s, 250/min, 10k–20k/day; request exactly the fields you need |

**Bottom line:** GSI is the *only* live-self source; OpenDota is the post-game/aggregate backbone (pre-fetch + cache); Stratz is an optional richer analytics fallback. The hot loop touches **only GSI + local cache**.

---

## 5. NeuroFocus biometric layer — realistic features + honest caveats

**Reality banner (read first).** Consumer EEG gives a *coarse, noisy, individually-calibrated proxy* for focus/stress, updated every **1–10 s** with **seconds-to-tens-of-seconds of effective latency** — **not** millisecond mind-reading. `neurofocus.dev` itself is a pre-product student startup (Foothill College incubator; $199 "Early Adopter" / $299 "Pro" dry-electrode earcup inserts; **waitlist/pre-order only, no public SDK, no docs, no shipping hardware**). Its headline **"0.005 s data latency" is a raw transport/sample number, NOT the latency of a focus score** (by the site's own label it is the "telemetry link"). Its "T1 Esports / Founders Inc." validation partners are unverified marketing. **Do not build against neurofocus.dev** — build against an abstract `EEGSource` interface and ship feature-flagged.

**Realistic device layer (what you'd actually integrate today):**
- **Emotiv Cortex** — cleanest path. Local WebSocket JSON-RPC (`wss://localhost:6868`); native `met` performance metrics (Engagement, Excitement, Stress, Relaxation, Interest, Focus, 0–100) at **2 Hz with the paid `pm` scope, else 0.1 Hz** (one sample / 10s). Raw EEG needs the paid `eeg` scope.
- **Muse** — best-value dev hardware; 256 Hz raw over TP9/AF7/AF8/TP10 (good frontal coverage), `muse-lsl`/LSL; **you compute** an engagement index like `beta/(alpha+theta)` (no native "focus" metric).
- **NeuroSky** — dead-simple 0–100 Attention/Meditation, single Fp1 electrode, **most EMG-contaminated** (worst for intense play).
- **OpenBCI + BrainFlow** — open 24-bit (ADS1299) path; BrainFlow exposes `MINDFULNESS`/`RESTFULNESS` (note: **no built-in metric literally named "focus"**). NB: presenting this as neurofocus.dev's internals is unsupported — their repo is a marketing site, labeled proprietary/closed-source.

**Realistically buildable, opt-in, slow-loop features:**
1. **Pre-queue readiness check** — 60–90s baseline; warn/gate ranked queue when focus is low / stress elevated (combine with loss-streak from `/players/{id}/wl`).
2. **Focus-dip alerts** — rolling engagement index >1 SD below the player's session baseline → a subtle "refocus" cue, delivered *during downtime* (dead/shopping/between waves), never mid-fight.
3. **Tilt / break / stop escalation** — sustained high stress across multiple deaths (cross-referenced to GSI K/D events) → calm-down nudge → "stop after N losses + sustained low focus."
4. **Cognitive-load-adaptive coaching verbosity** — gate advice volume **primarily by GSI game-state** (suppress in active teamfight, expand in downtime), with EEG load as a secondary modifier.
5. **Post-game "mental game" report** — overlay the EEG focus/stress timeline against parsed match events (`/matches/{id}` deaths, lost fights, GPM dips), framed strictly as **correlation, not causation**.
6. **Focus↔MMR longitudinal self-insight** — join session EEG aggregates to `/players/{id}/ratings` + `/benchmarks` percentiles. ("Your win rate in high-focus sessions is higher" — never a causal claim.)

**Honest caveats (state plainly, never overclaim):**
- **Latency is seconds, not milliseconds.** Band power needs 2–6s windows; Emotiv exports at 0.1–2 Hz. No fight-by-fight brain reactions.
- **Earcup/temporal placement is suboptimal** for the frontal-midline theta / parietal alpha that focus indices rely on — expect more noise than a Muse AF7/AF8.
- **EMG dominates during fights** — jaw clench, head/eye movement, blinking contaminate dry EEG exactly when "tilt" would spike, so a "frustration" reading may be muscle, not brain.
- **Focus and stress aren't cleanly separable** (both raise beta) — a single "focus" number confounds them; always label it a coarse proxy and disambiguate with GSI context.
- **Best-case lab accuracy ~73%** under minimal-movement, per-user-calibrated conditions — and authors explicitly warn it does **not** transfer to dynamic/multitasking (i.e. MOBA) play.
- **Graceful degradation is mandatory:** full no-EEG functionality; show `UNKNOWN` on poor contact; never fabricate a state; treat confidence as first-class; fail open/quiet.
- **Neural data is legally sensitive** (CA SB 1223, CO HB 24-1058, CT SB 1295, MT SB 163; federal MIND Act proposed). Opt-in granular consent, data minimization, **on-device processing by default**, deletion/export, and **hard-gate any third-party "coach alerts"** (sharing a player's neural-derived metrics is regulated). See §8.

---

## 6. Full feature catalog by phase

Difficulty: **S** small / **M** medium / **L** large. ⭐ = killer-v1 subset.

| # | Feature | Phase | Sources | Diff | ⭐ |
|---|---|---|---|---|---|
| P1 | Hero/role advisor (meta-fit by bracket) | Pre-game | `/heroStats`, `/players/{id}`, constants | S | |
| P2 | Enemy player scouting (manual account IDs) | Pre-game | `/players/{id}` +subresources, `/refresh` | M | |
| P3 | Meta/patch briefing | Pre-game | `/heroStats`, `/proMatches`, `/explorer`(picks_bans), `/constants/patch` | M | |
| P4 | Personal readiness check | Pre-game | `/players/{id}/wl`,`/recentMatches`,`/ratings` (+EEG baseline) | M | |
| D1 | Counter-pick suggestions (vs known enemy comp) | Draft | `/heroes/{id}/matchups`, `/heroStats` | M | |
| D2 | Team pick/synergy advice | Draft | GSI `draft`, `/matchups`, `/explorer`(hero-pair WR) | M | |
| D3 | Ban advice | Draft | `/heroStats`, `/explorer`(picks_bans `ord`) | M | |
| D4 | Draft enemy-pick recovery (vision/OCR) | Draft | multimodal vision → enemy IDs → D1 | L | |
| D5 | Lane assignment planner | Draft | GSI `draft`, `/scenarios/laneRoles`, constants | M | |
| L1 | Matchup tips (your hero vs enemy laner) | Laning | `/heroes/{id}/matchups`, constants(abilities) | M | ⭐ |
| L2 | Item start recommendation | Laning | `/heroes/{id}/itemPopularity` (start bucket) | S | ⭐ |
| L3 | Live lane execution check | Laning | GSI position/LH/DN, `/scenarios/laneRoles` | M | |
| L4 | Live laning benchmark (pace vs percentile) | Laning | GSI econ + `/benchmarks` | M | |
| **M1** | **Counter-Item Engine** | **Mid/Late** | **constants(abilities/items) + curated map + GSI items; §3** | **L** | **⭐** |
| M2 | Counter-item evidence overlay | Mid/Late | `/scenarios/itemTimings` + precomputed `/explorer` corpus | L | ⭐ |
| M3 | Power-spike timing alerts | Mid/Late | GSI level/items/clock, `itemPopularity`, `itemTimings` | M | |
| M4 | Objective / Roshan / rune timers | Mid/Late | GSI `map.*`, `hero.buyback_*` | S | ⭐ |
| M5 | Ward suggestions | Mid/Late | `/explorer`(ward heatmaps), `/players/{id}/wardmap`, GSI | M | |
| M6 | Live macro coach (NL Q&A + voice) | Mid/Late | GSI full self-state + cached meta; Ask-Coach hotkey | L | |
| G1 | Agentic match review (narrated, timestamped) | Post-game | `POST /request`→poll→`/matches/{id}`, `/benchmarks` | L | ⭐ |
| G2 | Mistake detection (rule-checkable errors) | Post-game | `/matches/{id}`, `/benchmarks`, constants | M | |
| G3 | What-if / counterfactual analysis | Post-game | parsed match + `itemTimings` + `/explorer` corpus | L | |
| G4 | NL-to-SQL personal analytics | Post-game | `/explorer` + `/schema` + `/players/{id}/matches` | L | ⭐ |
| G5 | Focus-vs-performance review (EEG) | Post-game | `/players/{id}/ratings`,`/matches/{id}`,`/benchmarks` + EEG | L | |

**The ⭐ killer-v1 subset** (tight, shippable, defensible): **M1 Counter-Item Engine** (the #1 pain), **M4 timers** (pure GSI, instant value), **L1+L2 matchup tips + item start** (cheap aggregates, no parse), **G1 agentic review** (the GOSU.AI successor, async so parse-lag is fine), **G4 NL-to-SQL** (genuinely novel). **Deferred from v1:** D4 vision-OCR (ToS-gray), M6 voice macro (latency-critical), all EEG (hardware-gated, opt-in later).

---

## 7. Tech stack & MCP server design

| Layer | Pick | Why |
|---|---|---|
| GSI listener | **Node/TS (fastify)** or **Go (net/http)** | tiny, fast 200-reply (slow replies throttle GSI); Go proven by dota-ai-coach |
| In-game overlay | **Overwolf** (or **ow-electron** for React DX) | the only Valve-*tolerated* overlay path; solves z-order/passthrough/fullscreen that raw Electron fails (Electron alwaysOnTop unreliable over OpenGL/Vulkan/fullscreen — issues #8530/#10078/#11830) |
| Companion/review UI | **React + TS** (web for post-game/settings) | shared with overlay; web cannot be the *live* overlay |
| Local store | **SQLite** (constants by patch, meta TTL, history) | zero-ops, fast hot-path reads |
| Backend (multi-tenant, optional) | **Node/Go + Postgres + Redis** | holds one premium key, request coalescing, ETL cache |
| Static data | **dotaconstants** vendored from GitHub raw, by patch | no API cost; authoritative `dmg_type`/`bkbpierce`/`dispellable` |
| Analytics | **OpenDota** (+ **Stratz** GraphQL optional) | breadth + `/explorer`; Stratz for IMP/win-prob/field-efficiency |
| MCP server | **TS MCP SDK**, stdio + HTTP | drive from Claude or own orchestrator |
| Agent / LLM | **Local-first BYOK**, fast model hot path + strong model cold path | latency + privacy (esp. EEG on-device); matches LaneMind/dota-ai-coach |
| Voice (optional) | streaming TTS + low-latency speech model, **gated by game_state** | no-tab-out coaching during downtime |
| ETL/scheduler | **cron** running bounded `/explorer` + Tier-1 prefetch nightly | respects 15s / 2-conn / 3000-day limits |

**MCP server — "any agent + a Dota toolbelt":**
- `gsi.*` (live, local-only, read-only): `get_live_state`, `get_self_economy`, `get_cooldowns`, `get_timers`, `get_known_heroes` (own team + locked public enemy IDs — **not** enemy items), `subscribe_events`.
- `opendota.*` (cached/rate-limited, never bypasses cache on hot path): `get_hero_matchups`, `get_item_popularity`, `get_benchmarks`, `get_hero_stats`, `get_item_timings`, `get_player`, `get_player_recent`, `get_player_wl`, `get_match`, `request_parse` / `poll_parse`.
- `constants.*` (static, local): `resolve_item`, `resolve_ability`, `get_hero_kit`, `get_ability_counter_fields` → `{dmg_type, bkbpierce, dispellable}`, `classify_cc` (curated map).
- `counter.analyze_threats(enemy_hero_ids)` (composed): builds the threat vector + ranked, gated, evidence-backed counter items (§3).
- `explorer.read_cache(query_id, params)` serves **precomputed** ETL JSON; an admin-only `explorer.run(sql)` exists for the offline ETL job only (never live).

**Caching tiers (cost model: free = 3,000/day + 60/min; premium = $0.0001/call, 3,000/min):** Tier 0 static constants (≈free, by patch) · Tier 1 aggregate meta (nightly, ~few-hundred calls, fits free tier) · Tier 2 `/explorer` ETL (batch only) · Tier 3 per-user dynamic (small, short TTL). Hot path = GSI + local cache only; **per-recommendation OpenDota calls = 0**. Always read `X-Rate-Limit-Remaining-Minute/-Day` headers; `POST /request` costs **10** units.

---

## 8. Risks (with the verified corrections folded in)

**Rate limits.** OpenDota free tier is **3,000 calls/DAY + 60/min** — **NOT** the widely-repeated "50,000/month" (that's a stale 2018 figure; the current pricing page and `odota/core` config both confirm the daily cap). Premium = **$0.0001/call ($0.01 per 100), 3,000/min, unlimited daily**, requires a linked card; 404/429/500 not billed. The 60/min + 3,000/day caps are **per-IP** and exhaust fast if many users share one server IP → for any real traffic, use a premium key behind a shared cache. Stratz: ~20/s, 250/min, 10k–20k/day.

**Parsed-match coverage.** Deep fields exist *only* for parsed replays; the `/explorer` corpus is **pro/notable only (~250k matches), not the public ladder**, and skews old/low-N for specific hero pairs. `public_matches` (~173M rows) has team hero-ID arrays + win, but **no item columns**; `public_player_matches` **does not exist** (despite `/schema` listing it). So there is **no path to ladder-wide per-player item builds** — enemy-conditioned item stats are inherently pro-meta and need `HAVING count() >= N` + visible confidence. Replays also expire (~2 weeks).

**Valve ToS / VAC.** Core posture: **read-only, advisory-only; no memory reading, no injection, no input automation.** GSI is first-party and sanctioned. Valve actively defends against scouting (Feb 2023 patch disabled the `record` command + matchmaking console introspection and hid player profiles until STRATEGY_TIME; banned ~40k accounts running tools that "read data from the Dota client … not visible during normal gameplay"; banned overlay clones like OverPlus). **Memory reading for enemy draft is a ban risk and unnecessary** — design around the GSI limitation. Overwolf is *tolerated, not blessed* — keep the overlay strictly advisory and never surface hidden info. **Own-screen vision/OCR is gray** (reads only rendered pixels, technically distinct from memory reading, but Valve's ban language is broad and there's no explicit allowance) — flag the risk, never market it as enemy scouting, default to manual hero input. Don't trust "undetected/anti-VAC" marketing — that phrasing signals cheating tools.

**EEG signal quality.** Seconds-not-milliseconds latency; suboptimal earcup placement; EMG dominates during fights; focus/stress not separable; ~73% best-case lab accuracy that doesn't transfer to MOBA play; vendor accuracy claims unverified. Treat every focus number as a coarse, individually-calibrated proxy with first-class confidence.

**Privacy.** Keep live self-state and all EEG data **on-device** by default; if a server-side agent is used, send a redacted snapshot. Neural data is legally sensitive in CA/CO/CT/MT (more states + federal MIND Act pending) → explicit opt-in consent, data minimization, deletion/export controls, and a hard gate on any third-party (coach/teammate) sharing of identifiable neural-derived metrics.

---

## 9. Phased roadmap

### v0 — Weekend MVP
**Goal:** prove the live loop end-to-end on one machine.
- GSI cfg + localhost listener (auth, fast 200, diff).
- Minimal overlay (Overwolf or windowed): live timers (Roshan, day/night, runes) + your GPM/XPM/net-worth vs a static benchmark.
- Manual 5-hero enemy picker.
- Bundle dotaconstants locally.
- **Definition of done:** launch Dota, the overlay shows your live economy + working Roshan/rune timers driven by GSI, and you can enter the enemy 5 heroes. No LLM yet.

### v1 — The Killer (Counter-Item Engine)
**Goal:** nail the #1 pain with explanation.
- **M1 Counter-Item Engine:** Layer A (rule map + `abilities.json` field gating + `ability_overrides`) + Layer B signals #1–#2 (`itemPopularity`, `itemTimings`) + Layer C fast-LLM ranking with gold/role/timing + one-line *why*. **No `/explorer` ETL yet.**
- L1 matchup tips, L2 item start, M4 timers.
- G1 agentic post-game review (parse → narrate) + G4 NL-to-SQL.
- MCP server (stdio) wrapping `gsi.*` + `opendota.*` + `constants.*` + `counter.*`.
- Registered OpenDota key + nightly Tier-1 prefetch + caching.
- **Definition of done:** mid-match, with enemy heroes entered and live GSI gold, the engine returns a ranked, affordable, **field-correct** (never recommends BKB vs a piercing disable), one-line-justified shopping list in <2s; post-game produces a timestamped narrated review; you can ask a plain-English history question and get a correct SQL-backed answer.

### v2 — Rich
**Goal:** depth + automation of inputs.
- Full nightly `/explorer` ETL: enemy-conditioned build-rate + WR-delta matrix (Queries 1–3) with confidence display → M2.
- GSI scoreboard auto-detection of enemy heroes (drop the manual picker for most cases); D4 vision-OCR as accelerator (with ToS caveat).
- M6 conversational live macro coach + low-latency voice gated by game_state.
- M3 power-spike alerts, M5 ward suggestions, G2 mistake detection, G3 counterfactuals.
- EHP/burst math from `heroes.json`; D1/D2/D3/D5 draft suite; P2/P3 scouting + briefing.
- Optional Stratz GraphQL secondary source.
- **Definition of done:** the companion auto-knows the enemy lineup in most games, the counter engine cites enemy-conditioned win-rate evidence with sample sizes, and live advice can be spoken during downtime without tabbing out.

### v3 — Biometric + fully agentic
**Goal:** the mental-game loop + agent autonomy.
- NeuroFocus layer behind an abstract `EEGSource` (Emotiv/Muse/OpenBCI adapters), feature-flagged, on-device.
- P4 readiness check, focus-dip alerts, tilt/break/stop escalation, cognitive-load-adaptive verbosity, G5 focus↔performance + post-game "mental game" report.
- Full consent/privacy flow (opt-in, minimization, deletion/export, third-party-sharing gate).
- MCP HTTP transport so any external agent can drive the toolbelt; strong-model cold path for deep multi-step review.
- **Definition of done:** with a supported EEG device opted-in, the companion delivers a pre-queue readiness check and a post-game mental-game report correlating a (clearly-confidence-labeled) focus timeline with match events — and the entire system runs gracefully and fully without any EEG device.

---

## 10. Open questions for the user to decide

1. **Overlay platform:** Overwolf (Valve-tolerated, solves overlay hard parts, ties you to their SDK/ToS) vs ow-electron (React DX) vs raw Electron windowed/second-screen (weaker but unconstrained)? Recommendation: Overwolf/ow-electron for in-game, web for post-game.
2. **Single-user local-first vs hosted multi-tenant?** Local-first BYOK is cheaper, more private, lower-latency, and matches the market — but no shared cache means each user needs their own OpenDota key/quota. Hosted gives a shared premium key + ETL cache but adds server cost + privacy surface. Recommendation: ship local-first; add an optional hosted cache only when scaling.
3. **LLM provider & BYOK?** Bring-your-own-key (Anthropic/OpenAI/Google/xAI) vs hosted credits? Which fast model on the hot path vs strong model on the cold path?
4. **Enemy-lineup input for v1:** ship manual picker only (safe), or also build vision-OCR now (faster UX, ToS-gray)? Recommendation: manual picker for v1; vision in v2 with explicit risk disclosure.
5. **Voice in scope, and when?** Adds latency/complexity; high "no-tab-out" value. Defer to v2?
6. **EEG seriousness & device target.** Is the biometric layer a real priority or a "nice to have"? If real, target Emotiv Cortex first (cleanest SDK) — accept the hardware adoption barrier and the consumer-EEG accuracy reality. neurofocus.dev cannot be built against today.
7. **`/explorer` ETL scope:** how wide a (yourHero × enemyHero) matrix is worth precomputing given the pro-only, low-N corpus? Which ~30 situational items to cover first?
8. **Stratz as a secondary source?** Worth the second integration for win-prob/IMP, or is OpenDota sufficient for v1–v2?
9. **Premium OpenDota key timing:** start free (3,000/day) for solo dev, upgrade at what user/traffic threshold?
10. **Distribution & monetization:** free/open-source (community trust, dota-ai-coach model) vs paid (LaneMind/GankAI model)? This affects the hosted-vs-local and BYOK decisions above.

---

*Key reference file: `/Users/inky/Desktop/dota2-companion/opendota-api.json` (OpenDota v31.1.0, 55 endpoints — `/explorer`, `/heroes/{id}/matchups`, `/heroes/{id}/itemPopularity`, `/scenarios/itemTimings`, `/benchmarks`, `/constants/{resource}`, `/matches/{id}`, `POST /request/{match_id}` all confirmed present). Companion design docs: `NEUROFOCUS_BIOMETRIC_LAYER.md`.*
