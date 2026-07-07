/**
 * Frame/image → compact JPEG data-URL helpers, shared by the manual screenshot
 * analyzer (HeroAnalyzer) and the automatic draft grab (ScreenRecorder).
 *
 * The auto-draft path crops to the top hero-bar band and skips downscaling:
 * hero portraits are ~40px tall on a 1080p screen, so a full-frame 1280-wide
 * JPEG leaves the vision model squinting at ~25px thumbnails — the main reason
 * detection used to misread most drafts.
 */
const MAX_W = 1280;
const JPEG_Q = 0.82;

/** Fractions of the source frame (0..1). */
export interface CropRect { x: number; y: number; w: number; h: number }

export interface FrameOptions {
  crop?: CropRect;
  maxW?: number;
  quality?: number;
}

/** Top band of the screen holding the ten hero portraits + clock. */
export const DRAFT_BAR_CROP: CropRect = { x: 0, y: 0, w: 1, h: 0.12 };

/** Draft scans keep full resolution and a higher JPEG quality — the crop keeps the payload small anyway. */
export const DRAFT_BAR_OPTIONS: FrameOptions = { crop: DRAFT_BAR_CROP, maxW: 1920, quality: 0.9 };

/** Source-rect pixels for a crop, clamped to the frame. Exported for tests. */
export function cropToPixels(crop: CropRect, w: number, h: number): { sx: number; sy: number; sw: number; sh: number } {
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  const sx = Math.round(clamp01(crop.x) * w);
  const sy = Math.round(clamp01(crop.y) * h);
  const sw = Math.min(w - sx, Math.max(1, Math.round(clamp01(crop.w) * w)));
  const sh = Math.min(h - sy, Math.max(1, Math.round(clamp01(crop.h) * h)));
  return { sx, sy, sw, sh };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

function scaleToCanvas(src: CanvasImageSource, w: number, h: number, opts?: FrameOptions): string | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx || w === 0 || h === 0) return null;
  const { sx, sy, sw, sh } = opts?.crop ? cropToPixels(opts.crop, w, h) : { sx: 0, sy: 0, sw: w, sh: h };
  const scale = Math.min(1, (opts?.maxW ?? MAX_W) / sw);
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', opts?.quality ?? JPEG_Q);
}

/** Shrink a pasted/uploaded image blob; falls back to the raw data URL if canvas is absent. */
export async function toUploadDataUrl(blob: Blob): Promise<string> {
  const raw = await blobToDataUrl(blob);
  try {
    if (typeof createImageBitmap !== 'function') return raw;
    const bitmap = await createImageBitmap(blob);
    return scaleToCanvas(bitmap, bitmap.width, bitmap.height) ?? raw;
  } catch {
    return raw;
  }
}

/**
 * Grab a still JPEG data-URL from a live MediaStream (screen capture). Renders
 * the current frame of the stream's video track to a canvas. Returns null if the
 * stream has no ready video frame yet or canvas is unavailable.
 */
export async function streamToDataUrl(stream: MediaStream, opts?: FrameOptions): Promise<string | null> {
  const track = stream.getVideoTracks()[0];
  if (!track) return null;
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  try {
    await video.play().catch(() => undefined);
    // Wait until the track has produced a frame with real dimensions.
    for (let i = 0; i < 20 && (video.videoWidth === 0 || video.videoHeight === 0); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;
    return scaleToCanvas(video, video.videoWidth, video.videoHeight, opts);
  } finally {
    video.pause();
    video.srcObject = null;
  }
}
