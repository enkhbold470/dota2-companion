import { VIDEO_START_URL, VIDEO_CHUNK_URL, VIDEO_FINISH_URL } from '../config';
import { streamToDataUrl, DRAFT_BAR_OPTIONS } from './frame';

/**
 * Screen capture for the focus review: records gameplay while an EEG session
 * records, so the review timeline can seek the video to the moment focus dropped.
 *
 * Browsers only grant getDisplayMedia from a user gesture, so capture is a
 * two-step act: `arm()` (one click — in the desktop app the Dota window is
 * auto-picked, in a plain browser the user picks a screen) acquires the stream
 * and keeps it alive; `start()`/`stop()` then run MediaRecorder per recording
 * with no further gestures, which is what lets auto-record start at the horn.
 *
 * The overlay can't write files, so chunks stream to the listener as they're
 * cut (POST /video/chunk, ~4 s apart) — a crash mid-match loses at most the
 * tail, not the whole recording. Uploads are chained on one promise so chunks
 * append in order.
 */

const MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
const CHUNK_MS = 4000;
const BITS_PER_SEC = 2_500_000; // ~720p30 review quality; ~19 MB/min

export interface ActiveVideo {
  filename: string;
  startedAtMs: number;
  mimeType: string;
}

export class ScreenRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private active: ActiveVideo | null = null;
  private dir: string | undefined;
  private uploads: Promise<unknown> = Promise.resolve();
  /** Fires on any armed/recording flip so a hook can mirror state into React. */
  onChange: (() => void) | null = null;

  get armed(): boolean { return this.stream !== null; }
  get recording(): boolean { return this.recorder !== null; }

  /**
   * Grab one still JPEG data-URL from the armed capture (for the auto draft scan).
   * `'draftBar'` crops to the top hero-bar band at full resolution so the vision
   * model sees readable portraits. Returns null when not armed — capture must be
   * armed via a user gesture first.
   */
  async grabFrame(mode: 'full' | 'draftBar' = 'full'): Promise<string | null> {
    if (!this.stream) return null;
    return streamToDataUrl(this.stream, mode === 'draftBar' ? DRAFT_BAR_OPTIONS : undefined);
  }

  async arm(): Promise<void> {
    if (this.stream) return;
    const stream = await navigator.mediaDevices.getDisplayMedia({
      // 1080p so the draft-bar crop keeps hero portraits legible; the recorder's
      // bitrate cap (below) keeps review-video disk use unchanged.
      video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    // The user can end sharing from the browser/OS chrome at any time.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      this.stream = null;
      if (this.recorder) void this.stop();
      this.onChange?.();
    });
    this.stream = stream;
    this.onChange?.();
  }

  disarm(): void {
    if (this.recorder) void this.stop();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.onChange?.();
  }

  /** Begin recording into `filename` (.webm). Null when not armed or the listener said no. */
  async start(filename: string, dir?: string): Promise<ActiveVideo | null> {
    if (!this.stream || this.recorder) return null;
    try {
      const res = await fetch(VIDEO_START_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dir, filename }),
      });
      if (!res.ok) return null;
    } catch {
      return null;
    }
    const mimeType = MIME_CANDIDATES.find((m) =>
      typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
    const recorder = new MediaRecorder(this.stream, { mimeType, videoBitsPerSecond: BITS_PER_SEC });
    this.dir = dir;
    const chunkUrl = `${VIDEO_CHUNK_URL}?name=${encodeURIComponent(filename)}`
      + (dir ? `&dir=${encodeURIComponent(dir)}` : '');
    recorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      this.uploads = this.uploads.then(() =>
        fetch(chunkUrl, {
          method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: e.data,
        }).catch(() => undefined));
    };
    recorder.start(CHUNK_MS);
    this.recorder = recorder;
    this.active = { filename, startedAtMs: Date.now(), mimeType };
    this.onChange?.();
    return this.active;
  }

  /** Stop, flush the tail chunk, confirm the file landed. The stream stays armed. */
  async stop(): Promise<ActiveVideo | null> {
    const recorder = this.recorder;
    const active = this.active;
    this.recorder = null;
    this.active = null;
    if (!recorder) return null;
    if (recorder.state !== 'inactive') {
      // stop() emits the final dataavailable (queuing its upload) before onstop.
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
    }
    await this.uploads;
    if (active) {
      await fetch(VIDEO_FINISH_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dir: this.dir, name: active.filename }),
      }).catch(() => undefined);
    }
    this.onChange?.();
    return active;
  }
}
