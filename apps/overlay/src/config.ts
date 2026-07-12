// Where the overlay reaches the listener.
// - Dev: Vite serves the overlay on :5273 and the listener runs on :53000.
// - Packaged: the listener serves the overlay, so everything is same-origin.
const origin = import.meta.env.DEV ? 'http://127.0.0.1:53000' : window.location.origin;

export const COACH_URL = `${origin}/coach`;
export const ITEM_BUILD_URL = `${origin}/item-build`;
export const VISION_URL = `${origin}/vision`;
export const SETTINGS_URL = `${origin}/settings`;
export const OPENAI_KEY_URL = `${origin}/settings/openai-key`;
export const RECORDING_URL = `${origin}/recording`;
export const VIDEO_START_URL = `${origin}/video/start`;
export const VIDEO_CHUNK_URL = `${origin}/video/chunk`;
export const VIDEO_FINISH_URL = `${origin}/video/finish`;
export const RECORDINGS_URL = `${origin}/recordings`;
export const RECORDING_FILE_URL = `${origin}/recordings/file`;
export const ANALYSIS_URL = `${origin}/analysis`;

export const WS_URL = (() => {
  const u = new URL(origin);
  const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${u.host}/ws`;
})();
