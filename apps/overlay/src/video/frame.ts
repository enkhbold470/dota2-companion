/**
 * Frame/image → compact JPEG data-URL helpers, shared by the manual screenshot
 * analyzer (HeroAnalyzer) and the automatic draft grab (ScreenRecorder). Kept in
 * one place so both scale identically (≤ MAX_W wide, JPEG q0.82) — small POSTs,
 * fast vision.
 */
const MAX_W = 1280;
const JPEG_Q = 0.82;

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

function scaleToCanvas(src: CanvasImageSource, w: number, h: number): string | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx || w === 0 || h === 0) return null;
  const scale = Math.min(1, MAX_W / w);
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', JPEG_Q);
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
export async function streamToDataUrl(stream: MediaStream): Promise<string | null> {
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
    return scaleToCanvas(video, video.videoWidth, video.videoHeight);
  } finally {
    video.pause();
    video.srcObject = null;
  }
}
