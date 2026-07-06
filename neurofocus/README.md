# NeuroFocus logger (NeuroSky × Dota 2)

A single, **zero-dependency Python 3** background script that runs while you play and:

1. **receives** Dota 2 Game State Integration (GSI) — your own clock / deaths / alive / last hits,
2. **reads** a NeuroSky headset (eSense **Attention** / **Meditation** 0–100 + signal quality),
3. **fuses** the two by time into a baseline-relative focus state model, and
4. **saves** a time-aligned `JSONL` timeline + a post-session `summary.json` to disk.

It is the runnable, stdlib-only prototype of the design in
[`../NEUROFOCUS_BIOMETRIC_LAYER.md`](../NEUROFOCUS_BIOMETRIC_LAYER.md) — read that for the full
rationale. **Posture: local, read-only, advisory-only, on-device. Nothing is uploaded.**

> **Reality check (NeuroSky is the simplest *and weakest* EEG option).** One dry forehead
> electrode (Fp1). eSense Attention/Meditation are coarse, noisy, **per-user** proxies — *not*
> mind-reading. The single electrode is heavily contaminated by **jaw clench / blink / frown EMG**,
> i.e. exactly the movements that spike during fights. Effective cognitive-metric latency is
> **seconds**, not milliseconds. So: baseline-relative thresholds, rolling windows, hysteresis,
> GSI fusion, and **downtime-only** nudges — never fight-by-fight reactions. Every number shown is
> "relative to *your* session norm," never ground truth.

## Try it now — no headset, no Dota

```bash
cd neurofocus
python3 dota_neurofocus.py run --mock --mock-gsi --no-auth
```

You'll see a live status line (`ATT`, `MED`, `focus_z`, `quality`, `state`), a coach nudge when a
focus dip is detected during downtime, and on **Ctrl-C** a session summary. A
`session-<ts>.jsonl` timeline and `session-<ts>-summary.json` are written next to the script.

## Real setup

### 1. Wire up Dota GSI (one-time)

```bash
python3 dota_neurofocus.py gen-cfg          # writes the .cfg + .neurofocus-token
```

Copy `gamestate_integration_neurofocus.cfg` into your Dota 2 install's
`game/dota/cfg/gamestate_integration/` folder. It uses port **53100**, so it **coexists** with the
existing Node listener (port 53000) — Dota POSTs to every `.cfg` in that folder, so you can run
both at once.

- macOS: `~/Library/Application Support/Steam/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration/`
- Windows: `<Steam>\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\`

### 2. Connect the NeuroSky headset

This script talks to the **ThinkGear Connector (TGC)** — the small bridge app NeuroSky ships that
exposes the headset on a local TCP socket (`127.0.0.1:13854`) as newline-delimited JSON. Pair the
headset, start TGC, then:

```bash
python3 dota_neurofocus.py run             # real headset + real Dota
```

Other connection styles (override with flags):

```bash
python3 dota_neurofocus.py run --tgc-host 127.0.0.1 --tgc-port 13854
python3 dota_neurofocus.py run --mock       # real Dota, simulated EEG (e.g. while pairing)
```

> No ThinkGear Connector? A direct **serial / Bluetooth-SPP** adapter (the raw ThinkGear protocol,
> e.g. via the `NeuroPy` library) is the natural next adapter to add — it would slot in beside
> `ThinkGearSource`/`MockSource` behind the same interface. TGC is recommended because it's the
> least fiddly and needs no extra Python packages.

## What it computes

A small, explainable, **baseline-relative** state machine (see the design doc, §3):

| State | When | Behavior |
|---|---|---|
| `CALIBRATING` | first ~60 s of clean contact | building your session baseline; no claims |
| `UNKNOWN` | poor contact (`quality < 2`) | never fabricates a state |
| `FOCUSED` | attention near/above your norm | normal |
| `FOCUS_DIP` | `focus_z < -1` sustained (hysteresis) | gentle refocus cue **at the next safe moment** |
| `AGITATED?` | fresh death (GSI) **and** low meditation | honest *hint* (not "tilt"); soft reset cue |

- **GSI fusion** disambiguates the EEG: a death event comes from the game, never from the noisy
  single channel alone. Nudges fire **only in downtime** (dead, or not in a live game) and are
  **rate-limited** — never mid-fight, always dismissible.
- `focus_z` is a z-score vs a 5-minute rolling baseline, with the SD floored (consumer EEG is noisy).

## Output

`session-<ts>.jsonl` — one row per EEG sample (~1 Hz), each line:

```json
{"t":1782382483.2,"clock":-89,"game_state":"...IN_PROGRESS","alive":true,"deaths":0,
 "kills":0,"last_hits":0,"gpm":520,"attention":69,"meditation":55,"poor_signal":0,
 "quality":3,"focus_z":null,"state":"CALIBRATING"}
```

`session-<ts>-summary.json` — mean/SD/min/max attention, focus-dip seconds & %, deaths, match id.

## "Send it somewhere" / pro-level analysis

Saving is **local by design**. Neural-derived data is legally sensitive (CA SB 1223, CO, CT, etc.;
see the design doc §8), so this prototype writes only the derived scalars to disk and **does not
upload anything**. The natural extensions, all opt-in:

- **Post-game "mental game" report** — join this EEG timeline to a **parsed** OpenDota match
  (`POST /request/{id}` → `GET /matches/{id}`) and annotate stress/focus around deaths, teamfights,
  and item timings (design doc §4.5).
- **Focus ↔ performance correlation** across sessions/MMR via OpenDota (§4.4) — *as correlation,
  never causation*.
- **Upload / team dashboard** — only behind explicit, granular, revocable consent (§8.2). The
  `Session` class is the single place an uploader would hook in.

## Flags

`run`: `--gsi-port 53100` · `--tgc-host` · `--tgc-port` · `--out PATH` · `--token` /
`--no-auth` · `--mock` (sim EEG) · `--mock-gsi` (sim game). `gen-cfg`: `--gsi-port`.
