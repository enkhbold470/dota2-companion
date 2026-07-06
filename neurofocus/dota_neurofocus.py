#!/usr/bin/env python3
"""dota_neurofocus.py — local, read-only NeuroSky x Dota 2 focus logger.

A single, zero-dependency (stdlib only) background script that, while you play:

  1. receives Dota 2 Game State Integration (GSI) POSTs on a local port,
  2. reads a NeuroSky headset via the ThinkGear Connector socket (eSense
     Attention / Meditation 0-100 + signal quality),
  3. fuses the two by time into a baseline-relative focus state model, and
  4. saves a time-aligned JSONL timeline + a post-session summary to disk.

It honors the companion's posture (see NEUROFOCUS_BIOMETRIC_LAYER.md):
read-only, advisory-only, ON-DEVICE (nothing is uploaded), honest "proxy"
framing, baseline-relative thresholds, GSI fusion to disambiguate the signal,
and downtime-only nudges. NeuroSky is the simplest/weakest EEG option — a
single forehead electrode heavily contaminated by jaw/blink/frown EMG, i.e.
exactly the movements that spike in fights. Treat every number as a coarse,
noisy, per-user proxy, never ground truth.

Usage:
    python3 dota_neurofocus.py gen-cfg          # write the GSI .cfg + token
    python3 dota_neurofocus.py run              # run the logger (real headset)
    python3 dota_neurofocus.py run --mock       # simulate EEG (no headset)
    python3 dota_neurofocus.py run --mock --mock-gsi   # fully offline demo
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import secrets
import socket
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional

HERE = Path(__file__).resolve().parent

# ---- Defaults (override via flags / env) ------------------------------------
DEFAULT_GSI_PORT = 53100          # coexists with the Node listener on 53000
DEFAULT_TGC_HOST = "127.0.0.1"    # NeuroSky ThinkGear Connector
DEFAULT_TGC_PORT = 13854
TOKEN_FILE = HERE / ".neurofocus-token"
CFG_NAME = "gamestate_integration_neurofocus.cfg"

GAME_IN_PROGRESS = "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"

# ---- State-model tuning (seconds / sample counts; all baseline-relative) -----
BASELINE_SECS = 60.0     # clean-contact calibration before any z-scores fire
BASELINE_MIN_SAMPLES = 20
ROLLING_SECS = 300.0     # 5-min rolling baseline window
DIP_Z = -1.0             # focus_z below this = dip candidate
DIP_ENTER = 5            # consecutive dip samples to enter FOCUS_DIP (hysteresis)
DIP_EXIT_Z = -0.5
DIP_EXIT = 5
DEATH_WINDOW = 60.0      # a death is "recent" for this long
NUDGE_COOLDOWN = 180.0   # min seconds between nudges of the same category


def now() -> float:
    return time.time()


# =============================================================================
# EEG sources — an abstract stream of (attention, meditation, quality) samples
# =============================================================================
@dataclass
class EegSample:
    t: float
    attention: Optional[int]   # eSense 0..100
    meditation: Optional[int]  # eSense 0..100
    poor_signal: int           # NeuroSky 0 (clean) .. 200 (off head)

    @property
    def quality(self) -> int:
        """Map NeuroSky poorSignalLevel to a 0..3 quality flag (3 = clean)."""
        p = self.poor_signal
        if p <= 0:
            return 3
        if p <= 25:
            return 2
        if p <= 80:
            return 1
        return 0


class ThinkGearSource:
    """Reads newline-delimited JSON from the NeuroSky ThinkGear Connector.

    TGC is the small helper app NeuroSky ships that bridges the headset to a
    local TCP socket (default 127.0.0.1:13854) and streams JSON like:
        {"poorSignalLevel":0,"eSense":{"attention":57,"meditation":43},...}
    Reconnects with backoff if the socket drops.
    """

    def __init__(self, host: str, port: int) -> None:
        self.host = host
        self.port = port
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def stream(self, on_sample):
        backoff = 1.0
        while not self._stop.is_set():
            try:
                with socket.create_connection((self.host, self.port), timeout=5) as sock:
                    sock.sendall(b'{"enableRawOutput": false, "format": "Json"}\r\n')
                    backoff = 1.0
                    buf = b""
                    sock.settimeout(1.0)
                    while not self._stop.is_set():
                        try:
                            chunk = sock.recv(4096)
                        except socket.timeout:
                            continue
                        if not chunk:
                            break
                        buf += chunk
                        # TGC terminates objects with \r; tolerate \n too.
                        while True:
                            i = min((j for j in (buf.find(b"\r"), buf.find(b"\n")) if j != -1), default=-1)
                            if i == -1:
                                break
                            line, buf = buf[:i], buf[i + 1:]
                            self._emit(line, on_sample)
            except OSError as e:
                if self._stop.is_set():
                    break
                print(f"[tgc] not connected ({e}); retrying in {backoff:.0f}s. "
                      f"Is the ThinkGear Connector running on {self.host}:{self.port}?",
                      file=sys.stderr)
                self._stop.wait(backoff)
                backoff = min(backoff * 2, 16.0)

    @staticmethod
    def _emit(line: bytes, on_sample) -> None:
        line = line.strip()
        if not line:
            return
        try:
            obj = json.loads(line.decode("utf-8", "ignore"))
        except (ValueError, UnicodeDecodeError):
            return
        if not isinstance(obj, dict):
            return
        # Only act on packets that carry eSense or a signal-quality reading.
        esense = obj.get("eSense")
        poor = obj.get("poorSignalLevel")
        if esense is None and poor is None:
            return
        esense = esense if isinstance(esense, dict) else {}
        on_sample(EegSample(
            t=now(),
            attention=esense.get("attention"),
            meditation=esense.get("meditation"),
            poor_signal=int(poor) if isinstance(poor, (int, float)) else 0,
        ))


class MockSource:
    """Synthetic ~1 Hz EEG so the whole loop is testable without hardware."""

    def __init__(self) -> None:
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def stream(self, on_sample):
        t0 = now()
        while not self._stop.is_set():
            elapsed = now() - t0
            # slow drift + noise + a focus dip around the 90-150s mark
            base = 60 + 12 * math.sin(elapsed / 40.0)
            if 90 < elapsed < 150:
                base -= 25
            attention = int(max(0, min(100, base + random.gauss(0, 6))))
            meditation = int(max(0, min(100, 50 + 15 * math.sin(elapsed / 55.0) + random.gauss(0, 6))))
            poor = 0 if random.random() > 0.05 else random.choice([26, 51, 200])
            on_sample(EegSample(now(), attention, meditation, poor))
            self._stop.wait(1.0)


# =============================================================================
# GSI — minimal local receiver for Dota's own game state (your data only)
# =============================================================================
@dataclass
class GameState:
    t: float = 0.0
    match_id: Optional[str] = None
    clock: Optional[int] = None
    game_state: Optional[str] = None
    alive: Optional[bool] = None
    deaths: Optional[int] = None
    kills: Optional[int] = None
    last_hits: Optional[int] = None
    gpm: Optional[int] = None

    @property
    def in_progress(self) -> bool:
        return self.game_state == GAME_IN_PROGRESS

    @property
    def downtime(self) -> bool:
        """A safe moment for a nudge: dead, or not actively in a live game."""
        return self.alive is False or not self.in_progress


def parse_gsi(payload: dict) -> GameState:
    m = payload.get("map") or {}
    p = payload.get("player") or {}
    h = payload.get("hero") or {}
    return GameState(
        t=now(),
        match_id=m.get("matchid"),
        clock=m.get("clock_time"),
        game_state=m.get("game_state"),
        alive=h.get("alive") if isinstance(h.get("alive"), bool) else None,
        deaths=p.get("deaths"),
        kills=p.get("kills"),
        last_hits=p.get("last_hits"),
        gpm=p.get("gpm"),
    )


# =============================================================================
# Session — fuses EEG + GSI, runs the state model, logs, and nudges
# =============================================================================
class Session:
    def __init__(self, out_path: Path, token: Optional[str]) -> None:
        self.out_path = out_path
        self.token = token
        self.lock = threading.Lock()

        self.game = GameState()
        self.last_death_t = 0.0
        self._known_deaths: Optional[int] = None

        # rolling baseline of attention while contact is usable
        self._roll: deque[tuple[float, int]] = deque()
        self._first_good_t: Optional[float] = None
        self.baseline_ready = False

        self._dip_in = 0
        self._dip_out = 0
        self.state = "STARTING"
        self._last_nudge: dict[str, float] = {}
        self._last_print = 0.0

        # session aggregates for the summary
        self._att_samples: list[int] = []
        self._dip_seconds = 0.0
        self._prev_sample_t: Optional[float] = None
        self.session_start = now()

        self._fh = out_path.open("a", encoding="utf-8")

    # ---- GSI ingest ---------------------------------------------------------
    def on_gsi(self, payload: dict) -> bool:
        if self.token is not None:
            got = (payload.get("auth") or {}).get("token")
            if got != self.token:
                return False
        g = parse_gsi(payload)
        with self.lock:
            # detect a fresh death (deaths counter increments)
            if g.deaths is not None:
                if self._known_deaths is not None and g.deaths > self._known_deaths:
                    self.last_death_t = now()
                self._known_deaths = g.deaths
            self.game = g
        return True

    # ---- EEG ingest (drives logging at the EEG cadence, ~1 Hz) --------------
    def on_eeg(self, s: EegSample) -> None:
        with self.lock:
            focus_z = self._update_baseline(s)
            state = self._classify(s, focus_z)
            self._accumulate(s, state)
            self.state = state
            row = self._row(s, focus_z, state)
            self._write(row)
            self._maybe_nudge(state, s)
            self._maybe_print(row)

    # ---- baseline + z-score -------------------------------------------------
    def _update_baseline(self, s: EegSample) -> Optional[float]:
        if s.quality < 2 or s.attention is None:
            return None
        t = s.t
        self._roll.append((t, s.attention))
        cutoff = t - ROLLING_SECS
        while self._roll and self._roll[0][0] < cutoff:
            self._roll.popleft()
        if self._first_good_t is None:
            self._first_good_t = t
        if (not self.baseline_ready
                and t - self._first_good_t >= BASELINE_SECS
                and len(self._roll) >= BASELINE_MIN_SAMPLES):
            self.baseline_ready = True
        if not self.baseline_ready:
            return None
        vals = [v for _, v in self._roll]
        mean = sum(vals) / len(vals)
        var = sum((v - mean) ** 2 for v in vals) / len(vals)
        sd = max(math.sqrt(var), 5.0)   # floor SD: consumer EEG is noisy
        return (s.attention - mean) / sd

    # ---- state machine (debounced, baseline-relative, GSI-fused) ------------
    def _classify(self, s: EegSample, focus_z: Optional[float]) -> str:
        if s.quality < 2:
            self._dip_in = self._dip_out = 0
            return "UNKNOWN"          # poor contact -> never fabricate a state
        if not self.baseline_ready or focus_z is None:
            return "CALIBRATING"

        recent_death = (now() - self.last_death_t) <= DEATH_WINDOW

        # focus-dip with enter/exit hysteresis
        if focus_z <= DIP_Z:
            self._dip_in += 1
            self._dip_out = 0
        else:
            self._dip_out += 1
            if focus_z > DIP_EXIT_Z and self._dip_out >= DIP_EXIT:
                self._dip_in = 0

        in_dip = self._dip_in >= DIP_ENTER

        # NeuroSky only gives Attention + Meditation. We DON'T claim "tilt":
        # low meditation right after a death is a weak agitation hint, clearly
        # labeled, fused with the GSI death event (never EEG alone).
        low_med = s.meditation is not None and s.meditation < 35
        if recent_death and low_med:
            return "AGITATED?"        # honest: a hint, not a diagnosis
        if in_dip:
            return "FOCUS_DIP"
        return "FOCUSED"

    def _accumulate(self, s: EegSample, state: str) -> None:
        if s.quality >= 2 and s.attention is not None:
            self._att_samples.append(s.attention)
        if self._prev_sample_t is not None and state == "FOCUS_DIP":
            self._dip_seconds += s.t - self._prev_sample_t
        self._prev_sample_t = s.t

    # ---- output -------------------------------------------------------------
    def _row(self, s: EegSample, focus_z: Optional[float], state: str) -> dict:
        g = self.game
        return {
            "t": round(s.t, 3),
            "clock": g.clock,
            "game_state": g.game_state,
            "alive": g.alive,
            "deaths": g.deaths,
            "kills": g.kills,
            "last_hits": g.last_hits,
            "gpm": g.gpm,
            "attention": s.attention,
            "meditation": s.meditation,
            "poor_signal": s.poor_signal,
            "quality": s.quality,
            "focus_z": round(focus_z, 3) if focus_z is not None else None,
            "state": state,
        }

    def _write(self, row: dict) -> None:
        self._fh.write(json.dumps(row, separators=(",", ":")) + "\n")
        self._fh.flush()

    def _maybe_nudge(self, state: str, s: EegSample) -> None:
        # Deferred, downtime-only, rate-limited. Never mid-fight. Advisory only.
        if not self.game.downtime:
            return
        cue = None
        if state == "FOCUS_DIP":
            cue = ("focus", "Focus dipped below your session norm — quick reset before the next wave.")
        elif state == "AGITATED?":
            cue = ("tilt", "Rough spot and you're wound up — one breath, reset target priority.")
        if cue is None:
            return
        cat, msg = cue
        if now() - self._last_nudge.get(cat, 0.0) >= NUDGE_COOLDOWN:
            self._last_nudge[cat] = now()
            print(f"\n  >> coach: {msg}\n")

    def _maybe_print(self, row: dict) -> None:
        if row["t"] - self._last_print < 1.0:
            return
        self._last_print = row["t"]
        clock = row["clock"]
        clk = "--:--" if clock is None else f"{'-' if clock < 0 else '+'}{abs(int(clock))//60:02d}:{abs(int(clock))%60:02d}"
        alive = "" if row["alive"] is None else ("alive" if row["alive"] else "DEAD ")
        att = row["attention"]
        z = row["focus_z"]
        zs = "" if z is None else f" z{z:+.1f}"
        print(f"[{clk}] {alive:5} ATT {att if att is not None else '--':>3}{zs}  "
              f"MED {row['meditation'] if row['meditation'] is not None else '--':>3}  "
              f"q{row['quality']}  {row['state']}")

    # ---- summary ------------------------------------------------------------
    def summary(self) -> dict:
        dur = now() - self.session_start
        atts = self._att_samples
        out: dict = {
            "session_seconds": round(dur, 1),
            "usable_samples": len(atts),
            "deaths": self.game.deaths,
            "last_match_id": self.game.match_id,
            "focus_dip_seconds": round(self._dip_seconds, 1),
            "focus_dip_pct": round(100 * self._dip_seconds / dur, 1) if dur > 0 else 0,
        }
        if atts:
            mean = sum(atts) / len(atts)
            var = sum((a - mean) ** 2 for a in atts) / len(atts)
            out.update(
                attention_mean=round(mean, 1),
                attention_sd=round(math.sqrt(var), 1),
                attention_min=min(atts),
                attention_max=max(atts),
            )
        return out

    def close(self) -> None:
        self._fh.close()


# =============================================================================
# HTTP handler for GSI POSTs
# =============================================================================
def make_handler(session: Session):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):  # silence default access logging
            pass

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(length) if length else b""
            try:
                payload = json.loads(body or b"{}")
            except ValueError:
                self.send_response(400)
                self.end_headers()
                return
            ok = session.on_gsi(payload) if isinstance(payload, dict) else False
            self.send_response(200 if ok else 401)
            self.end_headers()

        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')

    return Handler


# =============================================================================
# Commands
# =============================================================================
def cmd_gen_cfg(args) -> int:
    token = os.environ.get("NEUROFOCUS_TOKEN") or secrets.token_hex(12)
    port = args.gsi_port
    cfg = f'''"dota2-companion-neurofocus"
{{
  "uri"       "http://127.0.0.1:{port}/"
  "timeout"   "5.0"
  "buffer"    "0.1"
  "throttle"  "0.1"
  "heartbeat" "30.0"
  "data"
  {{
    "provider"  "1"
    "map"       "1"
    "player"    "1"
    "hero"      "1"
  }}
  "auth" {{ "token" "{token}" }}
}}
'''
    cfg_path = HERE / CFG_NAME
    cfg_path.write_text(cfg, encoding="utf-8")
    TOKEN_FILE.write_text(token, encoding="utf-8")
    print(f"Wrote {cfg_path} and {TOKEN_FILE} (token: {token}).")
    print("Copy the .cfg into your Dota 2 install (alongside any existing one):")
    print("  macOS:   ~/Library/Application Support/Steam/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration/")
    print("  Windows: <Steam>\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\gamestate_integration\\")
    print(f"Then start the logger:  python3 {Path(__file__).name} run")
    return 0


def resolve_token(args) -> Optional[str]:
    if args.no_auth:
        return None
    if args.token:
        return args.token
    if os.environ.get("NEUROFOCUS_TOKEN"):
        return os.environ["NEUROFOCUS_TOKEN"]
    if TOKEN_FILE.exists():
        return TOKEN_FILE.read_text(encoding="utf-8").strip()
    return None


def cmd_run(args) -> int:
    token = resolve_token(args)
    out_path = Path(args.out) if args.out else HERE / f"session-{int(now())}.jsonl"
    session = Session(out_path, token)

    if token is None:
        print("[auth] no token configured — accepting all local GSI POSTs. "
              "Run `gen-cfg` to enable token auth.", file=sys.stderr)
    print(f"[out] writing timeline -> {out_path}")

    # EEG source
    if args.mock:
        eeg: object = MockSource()
        print("[eeg] MOCK source (no headset).")
    else:
        eeg = ThinkGearSource(args.tgc_host, args.tgc_port)
        print(f"[eeg] ThinkGear Connector {args.tgc_host}:{args.tgc_port} "
              "(start NeuroSky's ThinkGear Connector first).")

    threads: list[threading.Thread] = []

    # GSI receiver (HTTP) — or a mock game clock for fully-offline demos
    httpd = None
    if args.mock_gsi:
        threads.append(threading.Thread(target=_mock_gsi_loop, args=(session,), daemon=True))
        print("[gsi] MOCK game state (no Dota).")
    else:
        httpd = ThreadingHTTPServer(("127.0.0.1", args.gsi_port), make_handler(session))
        threads.append(threading.Thread(target=httpd.serve_forever, daemon=True))
        print(f"[gsi] listening on http://127.0.0.1:{args.gsi_port}/ (POST from Dota)")

    eeg_thread = threading.Thread(target=eeg.stream, args=(session.on_eeg,), daemon=True)
    threads.append(eeg_thread)
    for t in threads:
        t.start()

    print("[ready] Ctrl-C to stop and write the session summary.\n")
    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n[stop] finishing up...")
    finally:
        eeg.stop()  # type: ignore[attr-defined]
        if httpd is not None:
            httpd.shutdown()
        summary = session.summary()
        session.close()
        summary_path = out_path.with_name(out_path.stem + "-summary.json")
        summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print("\n=== session summary ===")
        print(json.dumps(summary, indent=2))
        print(f"\nSaved: {out_path}\n       {summary_path}")
    return 0


def _mock_gsi_loop(session: Session) -> None:
    """Simulate a Dota match clock + occasional deaths for offline testing."""
    clock = -90
    deaths = 0
    while True:
        clock += 1
        if clock > 0 and random.random() < 0.01:
            deaths += 1
        session.on_gsi({
            "auth": {"token": session.token} if session.token else {},
            "map": {"clock_time": clock, "game_state": GAME_IN_PROGRESS, "matchid": "mock"},
            "hero": {"alive": random.random() > 0.05},
            "player": {"deaths": deaths, "kills": clock // 120, "last_hits": max(0, clock // 6), "gpm": 520},
        })
        time.sleep(1.0)


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description="NeuroSky x Dota 2 local focus logger.")
    sub = p.add_subparsers(dest="cmd")

    g = sub.add_parser("gen-cfg", help="write the GSI .cfg + token")
    g.add_argument("--gsi-port", type=int, default=DEFAULT_GSI_PORT)
    g.set_defaults(func=cmd_gen_cfg)

    r = sub.add_parser("run", help="run the background logger")
    r.add_argument("--gsi-port", type=int, default=DEFAULT_GSI_PORT)
    r.add_argument("--tgc-host", default=DEFAULT_TGC_HOST)
    r.add_argument("--tgc-port", type=int, default=DEFAULT_TGC_PORT)
    r.add_argument("--out", help="output JSONL path (default: session-<ts>.jsonl)")
    r.add_argument("--token", help="GSI auth token (default: .neurofocus-token / env)")
    r.add_argument("--no-auth", action="store_true", help="accept all local POSTs")
    r.add_argument("--mock", action="store_true", help="simulate EEG (no headset)")
    r.add_argument("--mock-gsi", action="store_true", help="simulate game state (no Dota)")
    r.set_defaults(func=cmd_run)

    args = p.parse_args(argv)
    if not getattr(args, "cmd", None):
        p.print_help()
        return 1
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
