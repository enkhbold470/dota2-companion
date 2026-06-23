# NeuroFocus Biometric Layer

Brain-sensing integration for the Dota 2 companion. This layer turns a consumer EEG signal
into a slow-loop, opt-in mental-game coaching system: focus-dip alerts, tilt/break prompts,
cognitive-load-adaptive coaching verbosity, focus↔performance correlation, and a post-game
"mental game" report that fuses an EEG timeline with match events.

> **Reality banner (read first).** Consumer EEG gives a *coarse, noisy, individually-calibrated
> proxy* for focus/stress, updated every **1–10 seconds** with **seconds-to-tens-of-seconds of
> effective latency** — **not** millisecond mind-reading. `neurofocus.dev` itself is a pre-product
> student startup (waitlist/pre-order, **no public SDK, no docs, no shipping hardware**), and its
> headline "0.005 s data latency" is a raw transport/sample number, **not** the latency of a focus
> score. Everything in this layer is designed around that constraint. See
> [§9 Real vs Aspirational](#9-real-vs-aspirational) for the explicit split.

---

## 1. Where this layer sits in the companion

The companion has three architecturally separate data planes. **Keep the biometric plane separate
from the match-data plane.** They are joined only by time (a session clock), never co-mingled.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  LIVE MATCH PLANE (your own game)                                              │
│  Valve GSI (local HTTP listener) → your hero/items/clock/score/game_state      │
│  NOTE: GSI exposes ONLY your own data while playing; no live enemy draft/items. │
└──────────────────────────────────────────────────────────────────────────────┘
              │  (time-aligned, event triggers)
              ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  BIOMETRIC PLANE  ★ THIS DOCUMENT ★                                            │
│  EEG device SDK → raw EEG → feature pipeline → focus/tilt/stress STATE MODEL    │
│  On-device processing preferred; minimize + consent-gate everything.           │
└──────────────────────────────────────────────────────────────────────────────┘
              │  (post-game, time-aligned by match start_time)
              ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  ANALYTICS PLANE (post-game / aggregate)                                       │
│  OpenDota REST: /players/{id}/ratings, /recentMatches, /matches/{id},          │
│  /benchmarks, /explorer SQL. Deep fields require a PARSED replay.              │
└──────────────────────────────────────────────────────────────────────────────┘
```

Two hard facts that shape the whole design:

- **Live in-match focus overlay** must be driven by **Valve GSI locally** (the only source of your
  own live game state). There is **no OpenDota endpoint** for your currently-live match — `/live`
  returns only top public/pro games.
- **Focus↔performance correlation** runs on **OpenDota post-game** data, and the deep per-match
  fields (purchase_log, gold_t/xp_t, lane, teamfights) exist **only if the replay was PARSED**
  (`POST /request/{match_id}`, then `GET /matches/{match_id}`).

---

## 2. Ingest

### 2.1 Device abstraction (DO NOT couple to neurofocus.dev)

`neurofocus.dev` has no SDK today. **Build against an abstract `EEGSource` interface** and ship
adapters for real, available platforms. The companion treats every device as: *a stream of band
powers / a derived focus-stress vector + a contact-quality signal.*

```ts
interface EEGSource {
  connect(): Promise<void>;
  // Emitted at the device's native metric cadence (see table below)
  onMetric(cb: (m: MetricSample) => void): void;     // focus/stress/engagement (0..1 normalized)
  onBandPower(cb: (b: BandPowerSample) => void): void; // delta..gamma per channel (optional)
  onContactQuality(cb: (q: ContactQuality) => void): void; // per-electrode fit/impedance
  disconnect(): Promise<void>;
  capabilities(): { hasNativeMetrics: boolean; channels: number; sampleRateHz: number; sites: string[] };
}

interface MetricSample { t: number; focus?: number; stress?: number; engagement?: number;
                         excitement?: number; relaxation?: number; source: 'native'|'derived';
                         quality: 0|1|2|3; }  // 0 = unusable, 3 = clean
```

### 2.2 Concrete adapters (real platforms, verified specs)

| Platform | Transport / SDK | Channels & sites | Raw rate | Native metric cadence | Notes / gotchas |
|---|---|---|---|---|---|
| **Emotiv Cortex** *(most companion-ready)* | JSON-RPC over WebSocket `wss://localhost:6868`; auth = clientId/secret → Cortex token → session | Insight 5ch (~AF3,AF4,T7,T8,Pz); EPOC X 14ch; 128/256 Hz | 128/256 Hz | **`met` perf metrics: 2 Hz with paid `pm` license scope (activate session before subscribe); else 0.1 Hz (1 sample/10 s)** | Native 0–100 **Engagement, Excitement(Arousal), Stress(Frustration), Relaxation, Interest, Attention/Focus**. Raw `eeg` stream needs paid `eeg` scope. Streams: `met`,`pow`(8 Hz),`eeg`,`mot`,`dev`(contact/battery),`fac`. Cleanest path to tilt + load. |
| **Muse** *(best-value dev HW)* | Official SDK + community `muse-lsl` over Lab Streaming Layer (LSL) | 4ch **TP9, AF7, AF8, TP10** (frontal + temporal) | 256 Hz | Band powers ~10 Hz, each a 1–2 s FFT window | **No native 0–100 focus** — you compute your own index (e.g. `beta/(alpha+theta)`). AF7/AF8 frontal coverage is *better* for attention than an earcup-only insert. Headband, not earcup. |
| **NeuroSky** *(simplest, weakest)* | ThinkGear chip | 1ch dry **Fp1** | — | eSense **Attention / Meditation** 0–100 + raw + bands | Single forehead electrode heavily contaminated by **jaw/blink/frown EMG** — exactly the movements that spike in fights. Easiest to prototype, weakest science. |
| **OpenBCI + BrainFlow** *(open, custom)* | BrainFlow uniform API (Py/C++/Java/C#/Julia/Matlab) | Cyton 8ch@250 Hz (ADS1299, 24-bit), Ganglion 4ch@256 Hz | 250/256 Hz | No native focus; `get_band_powers`; built-in `MINDFULNESS`/`RESTFULNESS` ML metrics (DEFAULT/DYN_LIB/ONNX) | The credible substrate for a "24-bit dry insert." **There is NO BrainFlow metric literally named `focus` or `stress`** — the OpenBCI GUI "Focus widget" relabels MINDFULNESS/RELAXATION and has no peer-reviewed validation. |
| **neurofocus.dev** *(aspirational adapter — stub only)* | None published | Earcup inserts → temporal sites (~TP9/TP10) | claimed 24-bit | claimed "0.005 s" = transport, not metric | **Stub adapter behind a feature flag.** No SDK/docs/hardware. Treat ALL specs as unverified marketing. Earcup placement is suboptimal for the frontal-midline theta / parietal alpha that focus indices rely on. |

> A **direct category competitor** (HyperX × Neurable, CES 2026) puts EEG in the **earpads** and ships
> exactly this feature set — "cognitive speed"/focus, a draining "brain health" bar that prompts
> breaks, an anti-tilt pitch, and a stream overlay. This validates the *use cases*; their accuracy
> numbers are vendor-reported.

### 2.3 Signals we actually consume

- **Primary:** a normalized **focus** and **stress** scalar per `MetricSample`, plus **engagement**
  (our cognitive-load proxy). Native where available (Emotiv); otherwise derived from band powers.
- **Derived index (Muse/OpenBCI):** engagement/attention `≈ beta / (alpha + theta)`; tilt/arousal
  rises with beta + frontal alpha asymmetry while alpha falls. **Stress and focus both raise beta**,
  so they are *not cleanly separable* — we never present "focus" as ground truth (see §4.4).
- **Always required:** **contact quality** (`dev` stream / impedance / fit). This gates everything —
  no quality, no metric (§7).

### 2.4 Latency budget (be honest)

| Stage | Realistic latency |
|---|---|
| Raw sample → host | ~5 ms (link) to ~125–200 ms (API) |
| Band-power window (frequency resolution = 1/window) | **2–6 s window**, often 50% overlap |
| Smoothing for a *trustworthy* focus/stress value | + a few seconds |
| Emotiv native metric export cadence | 2 Hz (paid) → **0.1 Hz (free, 1 sample/10 s)** |
| **Effective cognitive-metric latency** | **~2–10 s after smoothing** |

Design rule: **no fight-by-fight, sub-second brain reactions.** Triggers fire on **rolling windows
and trends**, and interventions are delivered in **calm/downtime moments** (dead, shopping, between
waves), never mid-teamfight.

---

## 3. State model

A small, explainable state machine over smoothed signals. All thresholds are **relative to the
player's own per-session baseline** (a 60–90 s calibration after a clean-contact handshake), never
absolute, because consumer EEG metrics are proprietary, weakly cross-validated, and not
interchangeable across vendors/people.

### 3.1 Inputs (rolling, baseline-relative)

- `focus_z` = z-score of focus index vs session baseline (5-min rolling mean & SD).
- `stress_z` = z-score of stress/arousal index vs baseline.
- `engagement` (cognitive-load proxy), normalized 0..1.
- `fatigue_slope` = slow downward drift of focus over the session (linear fit, tens of minutes).
- `quality` ∈ {0,1,2,3}; everything is suppressed at `quality ≤ 1`.
- **Context from GSI** (not EEG): `game_state`, `clock_time`, recent deaths/kills, in-fight flag.

### 3.2 States

```
            ┌─────────────────────────────────────────────────────────────┐
            │                         (quality≤1)                          │
            │                            ▼                                 │
            │                      ╔═══════════╗                           │
            │           ┌──────────║  UNKNOWN  ║◄───────────┐             │
            │           │          ╚═══════════╝             │             │
            │  quality≥2 + baselined                  signal lost/noisy    │
            │           ▼                                     │             │
   ╔════════╧═══╗  focus_z↓ sustained   ╔═══════════╗        │             │
   ║  FOCUSED   ║──────────────────────►║ FOCUS_DIP ║────────┤             │
   ║ (in flow)  ║◄──────────────────────╚═══════════╝        │             │
   ╚════╤═══════╝   focus recovers                            │             │
        │  stress_z↑ + recent deaths (GSI)                    │             │
        ▼                                                     │             │
   ╔════════════╗   stress stays high across multiple deaths  │             │
   ║  STRESSED  ║─────────────────────────────────────────►╔═╧═════════╗   │
   ╚════╤═══════╝                                           ║  TILTED   ║   │
        │  fatigue_slope strongly negative + long session   ╚═══════════╝   │
        ▼                                                                   │
   ╔════════════╗                                                           │
   ║  FATIGUED  ║───────────────────────────────────────────────────────────┘
   ╚════════════╝
```

| State | Entry condition (all baseline-relative, smoothed) | Companion behavior |
|---|---|---|
| **UNKNOWN** | `quality ≤ 1`, or not yet baselined | No biometric claims. Graceful degradation (§7). |
| **FOCUSED** | `focus_z ≥ -0.5`, `stress_z < +1`, good quality | Normal coaching; can deliver verbose tips in downtime. |
| **FOCUS_DIP** | `focus_z < -1` sustained for ≥ a rolling 5-min window | Gentle refocus cue at next safe moment (§5.1). |
| **STRESSED** | `stress_z > +1` for 30–60 s AND ≥1 recent death (GSI) | Calmer tone, simpler callouts; pre-tilt watch. |
| **TILTED** | `stress_z > +1.5` sustained across **multiple** deaths | Tilt/break prompt at next downtime (§5.2). |
| **FATIGUED** | strongly negative `fatigue_slope` + long session (+ loss streak from `/players/{id}/wl`) | Break/stop-after-this-game recommendation (§5.2). |

**Transitions are debounced** (hysteresis: enter on N consecutive windows, exit on M) to avoid
flicker from the inherently noisy signal. No state is ever entered from a single sample.

### 3.3 Fusion with GSI (not OpenDota)

The state model reads **GSI game context locally** to disambiguate EEG (e.g. high beta during a
teamfight is engagement, not tilt; high beta while dead after a feed is likely tilt). GSI provides
`game_state`, kills/deaths, and clock — never enemy data while you play. This fusion is what makes
"tilt vs focus" usable despite the two sharing a beta signature.

---

## 4. Concrete features

### 4.1 Focus-dip alerts

- **Detect:** `FOCUS_DIP` state — `focus_z < -1` sustained over a rolling 5-min window vs session
  baseline.
- **Deliver:** a *subtle* cue (visual pulse / short audio), **scheduled into downtime** using GSI
  game state — e.g. just before creeps spawn, while dead, or during a lull — **never mid-fight**.
  Cadence: at most one nudge per few minutes; suppress entirely if `quality ≤ 1`.
- **Copy example:** "Focus has dipped below your session norm — quick reset before the next wave."
- **Honesty:** framed as "below *your* session norm," not "you are unfocused."

### 4.2 Tilt / break prompts

- **Detect:** `TILTED` (sustained stress across multiple deaths) or `FATIGUED` (focus drift + long
  session). Cross-reference **loss streak** via `GET /players/{account_id}/wl` and session duration.
- **Deliver:** at a safe boundary (death screen, post-game, or queue screen). Escalation ladder:
  1. *Soft* (STRESSED): "Take a breath — reset target priority for the next fight."
  2. *Break* (TILTED): "Two rough fights and stress is staying high. Consider a short break."
  3. *Stop* (FATIGUED + N losses + low focus): "N losses, focus trending down for ~M min.
     Recommend stopping after this game." (Mirrors the validated HyperX/Neurable + neurofocus.dev
     anti-tilt pattern.)
- **Never** block queueing or auto-act. Strictly advisory. (Any automation = VAC/ToS ban risk.)

### 4.3 Cognitive-load-adaptive coaching verbosity

The companion already emits Dota coaching (item/timing/macro). The biometric layer **gates the
volume and complexity** of that coaching by cognitive load:

```
load = f(engagement, in_fight_flag(GSI), game_state(GSI))

if load HIGH  (active teamfight / high engagement):  SUPPRESS + QUEUE tips; only 1-word critical callouts
if load MED   (laning, rotations):                   concise tips only (one line)
if load LOW   (dead, shopping, between waves):        deliver verbose / queued coaching, explanations
```

- Drive primarily off **GSI game state** (reliable, real-time) and use **engagement** as a secondary
  modifier. This avoids over-trusting the slow EEG signal for a real-time decision.
- The classic failure mode here is **"generic garbage" / chatty distraction** (confirmed by the
  open-source `dota-ai-coach` author). Load-gating is the antidote: silence during high load is a
  feature.

### 4.4 Focus ↔ performance correlation (over a session and across MMR)

**Within a session:**
- Persist a time-aligned biometric track (focus/stress/engagement at native cadence) keyed to the
  GSI match clock.
- After the game is parsed, join to per-minute match series and per-match outcomes.

**Across sessions / across MMR (OpenDota, verified):**

| Need | Endpoint | Use |
|---|---|---|
| Match list + timestamps | `GET /players/{account_id}/recentMatches`, `/matches` | tag each match's `start_time` to its EEG session window |
| Rank/MMR history over time | `GET /players/{account_id}/ratings` | overlay MMR trend on session focus aggregates |
| Win/loss (for streak/fatigue) | `GET /players/{account_id}/wl` | break logic + correlation grouping |
| Per-match performance | `GET /matches/{match_id}` (KDA, GPM/XPM, lane, duration) | regress performance on focus state — **deep fields PARSED-only** |
| Percentile grading | `GET /benchmarks?hero_id` | grade GPM/XPM/LH as percentile for context |
| Custom joins | `GET /explorer?sql=` (+ `/schema`) | bespoke "high-focus vs low-focus" splits |

- **Method:** tag each match with its mean/variance focus, mean stress, fatigue slope; then regress
  outcome (win, GPM percentile, KDA) on focus state. Group by MMR bracket (`rank_tier`) to ask "do my
  high-focus sessions correlate with rating gains in my bracket?"
- **`/explorer` caveat:** precompute **offline/batch** only — it has a hard **15 s statement timeout**
  and **2 site-wide connections**; never a runtime per-request call. Free tier is **3,000 calls/day +
  60/min** (the "50,000/month" figure is stale). Parse jobs cost **10 units** each.
- **Framing is mandatory:** present **correlation, not causation**. Confounds (opponent skill, hero,
  hero difficulty, time of day, sleep) dominate. The UI says "associated with," never "caused by,"
  and shows sample size / confidence. Causal "higher focus → higher MMR" claims are scientifically
  and ethically off-limits.

### 4.5 Post-game "mental game" report (EEG timeline ⊕ match events)

The flagship deliverable. A timestamped narrative fusing the smoothed EEG track with parsed match
events.

**Pipeline:**
1. After the game, ensure parse: `POST /request/{match_id}` → poll `GET /request/{jobId}` (null when
   done; ~3 min typical via `/health.parseDelay`). Then `GET /matches/{match_id}`.
2. Pull match events: per-minute `gold_t`/`xp_t`, `objectives[]`, `teamfights[]`, `kills_log`,
   `purchase_log`, deaths.
3. Align the smoothed EEG track to the match clock (single time axis).
4. Annotate: overlay stress spikes / focus dips onto deaths, lost fights, GPM/XPM dips; mark fatigue
   slope across the game.

**Report sections:**
- **Session summary:** mean focus, focus variance, peak stress, fatigue slope; vs your own history.
- **Timeline:** focus/stress lines over the match, with markers for deaths, teamfights, Roshan,
  big item timings (from `purchase_log`).
- **Correlated moments (descriptive, hedged):** "Your stress was elevated for ~40 s around the
  18:30 lost fight and your last hits dipped over the next 2 min." (No causal verb.)
- **Trend:** focus-vs-result across recent sessions; focus-vs-MMR (with confidence + N).
- **Self-insight prompts:** "Your strongest-focus quartile of games this week were wins X of Y" —
  framed for reflection, not as a rule.

> This is the modern, conversational successor to GOSU.AI's canned async reports — and it sidesteps
> the live-data limitation entirely because it's post-game.

---

## 5. Delivery rules (cross-cutting)

- **Timing:** all in-game biometric interventions are deferred to GSI-detected safe moments. Never
  interrupt a fight.
- **Frequency:** hard rate-limit nudges (e.g. ≤1 per few minutes per category); escalate, don't spam.
- **Tone:** baseline-relative, non-judgmental, advisory. Always reversible/dismissible.
- **Modality:** prefer subtle visual; audio only for break/stop-level prompts so it isn't a constant
  distraction.

---

## 6. Signal-quality realism

- **Cognitive-metric latency is seconds, not milliseconds.** Band power needs 2–6 s windows; Emotiv
  exports at 2 Hz (paid) or 0.1 Hz (free). The "0.005 s" marketing number is the raw sample interval.
- **Placement matters.** Earcup/temporal inserts (neurofocus.dev, Neurable earpads) sit near
  TP9/TP10 — poor for the frontal-midline theta and parietal alpha that focus/engagement indices rely
  on. Muse's AF7/AF8 frontal contacts are *better* positioned for attention.
- **EMG/motion artifacts dominate exactly when "tilt" spikes.** Jaw clench, fast eye/head movement,
  blinking, leaning in a fight contaminate dry-electrode EEG — a "frustration" reading can be EMG, not
  EEG. Single-channel (NeuroSky) is worst; all dry systems are affected.
- **Stress and focus are not cleanly separable** on consumer EEG (both raise beta). Any displayed
  "focus" value is a coarse, noisy, **individually-calibrated proxy** — never ground truth.
- **Metrics are not cross-vendor comparable** and are weakly externally validated. Best published
  single-channel moment-to-moment attention accuracy is ~73% / F1 0.77 **under minimal-movement, per-
  user-calibrated lab conditions** — which the authors explicitly say does *not* transfer to dynamic,
  high-movement play like a MOBA. **Per-user baselining is mandatory.**

**Implications baked into the design:** rolling windows + smoothing + hysteresis; baseline-relative
thresholds; GSI fusion to disambiguate beta; downtime-only delivery; honest "proxy" framing
everywhere.

---

## 7. Graceful degradation (noisy / absent signal)

The companion is **fully functional with zero EEG.** The biometric layer is strictly additive.

| Condition | Detection | Behavior |
|---|---|---|
| **No device / not opted in** | no `EEGSource` connected | Biometric features hidden. All Dota coaching + post-game review work normally. |
| **Device connected, poor contact** (`quality ≤ 1`) | `dev`/impedance/fit stream | State = **UNKNOWN**. Suppress all alerts/states. Show a one-time, unobtrusive "adjust headset for fit" hint; never repeatedly nag. |
| **Intermittent dropout / motion artifact** | quality flaps, or implausible spikes (EMG) | Hold last *stable* state, mark samples low-confidence, **decay to UNKNOWN** if it persists. Exclude artifact windows from correlation and the post-game report. |
| **Not yet baselined** | < 60–90 s clean contact | No z-scores → no FOCUS_DIP/TILT firing. Show "calibrating." |
| **Partial channels** (e.g. one earcup off) | `capabilities()` + per-channel quality | Degrade to whatever index the good channels support; widen thresholds; lower confidence. |
| **Free-tier Emotiv (0.1 Hz)** | `capabilities().hasNativeMetrics` cadence | Coarser states, longer windows; disable any feature needing >0.1 Hz responsiveness; surface "low-resolution mode." |

**Core principles:**
- **Never fabricate a state from bad signal.** Absence/uncertainty → UNKNOWN, not a guess.
- **Confidence is first-class.** Every metric carries a `quality` flag; low-confidence samples are
  excluded from analytics and reports, and labeled in any UI.
- **Fail open, fail quiet.** Degradation reduces biometric features silently; it never blocks
  gameplay, queueing, or the rest of the companion.

---

## 8. Consent, privacy, ethics

Neural data is **legally sensitive** in a fast-moving 2024–2026 US regime. Treat EEG-derived data as
the most sensitive category in the app.

### 8.1 Legal landscape (as of mid-2026)

- **California SB 1223** (in force Jan 1 2025): extends CCPA to **"neural data"** (info from measuring
  central/peripheral nervous-system activity).
- **Colorado HB 24-1058**: amends the Colorado Privacy Act to make neural data **sensitive** →
  opt-in consent + heightened obligations.
- **Connecticut SB 1295** (June 2025): explicitly covers CNS activity / EEG headsets.
- **Montana SB 163** (Oct 2025): amends Genetic Information Privacy Act; warrant for law-enforcement
  access.
- **More in flight:** VA, NY, IL, VT, MA, MN bills; a second CA workplace-surveillance measure;
  proposed federal **MIND Act**.
- A Neurorights Foundation audit found **29 of 30** neurotech firms had broad brain-data access with
  no meaningful limits — the exact failure mode to avoid.

### 8.2 Required controls

- **Explicit, granular, opt-in consent** before any EEG capture, with plain-language purpose
  statements per use (live alerts / correlation / report / any sharing). Separate toggle for each.
- **Data minimization.** Default to deriving and storing only the **focus/stress/engagement scalars +
  quality**, not raw EEG. Raw EEG capture is a distinct, off-by-default opt-in.
- **On-device / local processing preferred.** Compute metrics client-side; don't ship raw EEG to a
  server. (neurofocus.dev's own repo asserts local processing "to protect gamer data" — match that.)
- **Purpose limitation.** Biometric data used only for the consented coaching purposes. No ad/profile
  use, no model training without separate explicit consent.
- **Deletion & export controls.** One-click delete of all biometric data; export on request;
  retention limits with auto-purge.
- **Third-party sharing is a regulated transfer, gate it hard.** A "coach alerts" / team-dashboard
  feature that sends an identifiable player's neural-derived metrics to anyone else is a sensitive-
  data disclosure requiring its own explicit consent — and is especially fraught for **minors or
  employees** (workplace-surveillance laws). Default OFF; per-recipient, revocable consent.
- **Architectural separation.** Keep the biometric store separate from match data; join only by time,
  at query time, under consent. This makes deletion and minimization enforceable.

### 8.3 Ethical guardrails

- **No causal/clinical claims.** It's a coaching proxy, not a diagnosis. No "this caused your loss,"
  no mental-health inferences.
- **Honesty about reliability.** Surface that the signal is coarse and noisy; show confidence.
- **No dark patterns.** Break/stop prompts are advisory and dismissible; never engagement-maximizing,
  never gating play.
- **Stream-overlay mode** (focus speedometer / fatigue bar) is opt-in with a viewer-facing
  disclaimer.

---

## 9. Real vs Aspirational

### Real / buildable today
- **Device ingest** via Emotiv Cortex (`wss://localhost:6868`, native focus/stress/engagement at
  2 Hz paid / 0.1 Hz free), Muse (`muse-lsl`/LSL, derive `beta/(alpha+theta)`), NeuroSky (eSense), or
  OpenBCI/BrainFlow (custom + MINDFULNESS/RESTFULNESS).
- **The slow-loop state model** (focus/tilt/stress/fatigue) with baseline-relative thresholds,
  hysteresis, and GSI fusion.
- **Focus-dip alerts, tilt/break prompts, load-adaptive verbosity** — all at seconds-scale, downtime-
  delivered.
- **Focus↔performance correlation** via OpenDota `/players/{id}/ratings`, `/recentMatches`,
  `/matches/{id}`, `/benchmarks`, `/explorer` (offline batch), grouped by MMR — **as correlation**.
- **Post-game "mental game" report** fusing the EEG timeline with PARSED match events (after
  `POST /request/{match_id}`).
- **Graceful degradation** to a fully working no-EEG companion.
- **Consent/privacy/on-device/deletion** controls.

### Aspirational / unverified — do NOT depend on
- **neurofocus.dev itself:** no SDK, no docs, no shipping hardware, waitlist/pre-order only. Ship only
  a **feature-flagged stub adapter**. Its "0.005 s latency," "24-bit," and T1/Founders Inc.
  partnership claims are **unverified marketing**; the "0.005 s" is transport, not metric latency.
  Earcup placement is suboptimal for attention/focus sites.
- **Millisecond, fight-by-fight brain reactions:** physically impossible with band-power features
  (need 2–6 s windows).
- **Reliable in-game focus measurement during intense play:** not validated; high-movement MOBA play
  is the worst case for dry EEG.
- **Causal "focus → MMR" claims:** correlational at best; confounded.
- **Vendor accuracy/partnership claims** (neurofocus.dev T1/Founders Inc.; Neurable reaction-time
  gains): self-reported, unverified.

### Hard limits inherited from the platform
- **No live enemy data** (GSI exposes only your own data while playing; no live enemy draft anywhere).
- **No OpenDota endpoint for your own live match** (`/live` = top public games only) — live focus
  overlay must come from **GSI**.
- **Deep match fields require a PARSED replay**; parsing is async (~3 min) and costs 10 rate units.
- **OpenDota free tier: 3,000 calls/day + 60/min** (not 50k/month); `/explorer` has a 15 s timeout
  and 2 connections — batch/precompute only.
