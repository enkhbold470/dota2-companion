import { app, BrowserWindow, shell, dialog, session, desktopCapturer } from 'electron';
// electron-updater is CommonJS with NO default export — a default import resolves to
// undefined. Use the named export (esbuild reads it off the require() result).
import { autoUpdater } from 'electron-updater';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { buildServer } from '../../listener/src/server';
import { Hub } from '../../listener/src/hub';
import { downloadAndSwap, bundleFromExecPath, type MacUpdateInfo } from './mac-update';

const PORT = Number(process.env.PORT ?? 53000);
// Must match publish: in electron-builder.yml (mac-update.ts fetches assets from here).
const RELEASE_DOWNLOAD_BASE = 'https://github.com/enkhbold470/dota2-companion/releases/download';
const RELEASES_PAGE = 'https://github.com/enkhbold470/dota2-companion/releases/latest';

function configDir(): string {
  const dir = app.getPath('userData');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// Stable per-install GSI token, generated once.
function loadOrCreateToken(dir: string): string {
  const file = join(dir, 'gsi-token.txt');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const token = randomBytes(12).toString('hex');
  writeFileSync(file, token, 'utf8');
  return token;
}

function gsiCfg(token: string): string {
  return [
    '"dota2-companion"',
    '{',
    `  "uri"       "http://127.0.0.1:${PORT}/"`,
    '  "timeout"   "5.0"',
    '  "buffer"    "0.1"',
    '  "throttle"  "0.1"',
    '  "heartbeat" "30.0"',
    '  "data"',
    '  {',
    '    "provider"  "1"',
    '    "map"       "1"',
    '    "player"    "1"',
    '    "hero"      "1"',
    '    "abilities" "1"',
    '    "items"     "1"',
    '  }',
    `  "auth" { "token" "${token}" }`,
    '}',
    '',
  ].join('\n');
}

// Common Windows Steam locations for Dota's GSI config directory.
function findDotaGsiDir(): string | null {
  const bases = [
    'C:/Program Files (x86)/Steam/steamapps/common/dota 2 beta',
    'C:/Program Files/Steam/steamapps/common/dota 2 beta',
    join(app.getPath('home'), 'Steam/steamapps/common/dota 2 beta'),
  ];
  for (const base of bases) {
    if (existsSync(base)) return join(base, 'game/dota/cfg/gamestate_integration');
  }
  return null;
}

// Write the .cfg locally and, if Dota is found, install it so live data just works.
function ensureGsiConfig(token: string, dir: string): { installed: boolean; path: string } {
  const local = join(dir, 'gamestate_integration_dota2-companion.cfg');
  writeFileSync(local, gsiCfg(token), 'utf8');
  const dotaDir = findDotaGsiDir();
  if (dotaDir) {
    try {
      if (!existsSync(dotaDir)) mkdirSync(dotaDir, { recursive: true });
      copyFileSync(local, join(dotaDir, 'gamestate_integration_dota2-companion.cfg'));
      return { installed: true, path: dotaDir };
    } catch {
      /* fall through to manual instructions */
    }
  }
  return { installed: false, path: local };
}

function readOpenAiKey(dir: string): string | null {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const file = join(dir, 'openai-key.txt');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim() || null;
  return null;
}

// Updater state, surfaced through GET /settings so the overlay can show "checking /
// downloading 42% / error: …" instead of failures dying in an invisible console.
let updaterState: { state: string; info: string | null } = {
  state: app.isPackaged ? 'idle' : 'dev', info: null,
};
function setUpdaterState(state: string, info?: string): void {
  updaterState = { state, info: info ?? null };
}

// macOS install path. Electron's Squirrel.Mac validates an update against the
// RUNNING app's code-signature designated requirement; our ad-hoc signature is a
// per-build cdhash, so Squirrel rejects every update ("Code signature … did not
// pass validation"). Instead we download + sha512-verify the zip ourselves and
// swap the bundle (see mac-update.ts) — never call autoUpdater.downloadUpdate()
// on darwin. Falls back to the releases page if anything goes wrong.
async function runMacUpdate(win: BrowserWindow, info: MacUpdateInfo, dir: string): Promise<void> {
  const fallback = async (why: string): Promise<void> => {
    setUpdaterState('error', why.split('\n')[0]!.slice(0, 140));
    try {
      appendFileSync(join(dir, 'updater.log'), `${new Date().toISOString()} mac-update: ${why}\n`, 'utf8');
    } catch { /* non-fatal */ }
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Open download page', 'Later'], defaultId: 0, cancelId: 1,
      title: 'Update failed',
      message: 'Automatic update didn’t work.',
      detail: 'Download the new version from the releases page and drag it into Applications.',
    });
    if (response === 0) void shell.openExternal(RELEASES_PAGE);
  };

  const bundlePath = bundleFromExecPath(process.execPath);
  if (!bundlePath) return fallback('not running from an .app bundle');
  try {
    setUpdaterState('downloading', '0%');
    await downloadAndSwap({
      info, bundlePath,
      workDir: join(app.getPath('temp'), 'nf-mac-update'),
      releaseBase: RELEASE_DOWNLOAD_BASE,
      onProgress: (p) => setUpdaterState('downloading', `${p}%`),
    });
    setUpdaterState('downloaded', info.version);
    const { response } = await dialog.showMessageBox(win, {
      type: 'info', buttons: ['Restart now', 'On next launch'], defaultId: 0, cancelId: 1,
      title: 'Update ready',
      message: `Version ${info.version} is installed.`,
      detail: 'It’s already in place — restarting now switches to it, otherwise the next launch will.',
    });
    if (response === 0) { app.relaunch(); app.exit(0); }
  } catch (err) {
    await fallback(err instanceof Error ? err.message : String(err));
  }
}

// In-app software updates from GitHub releases. The user always chooses — we never
// download or install without a click. Best-effort: an update check must never block
// or crash the app (offline, rate-limited, unsigned dev build all fail quiet).
function setupAutoUpdate(win: BrowserWindow, dir: string): void {
  if (!app.isPackaged) return; // dev has no release feed
  autoUpdater.autoDownload = false;          // ask before downloading
  autoUpdater.autoInstallOnAppQuit = true;   // if they defer, install on next quit

  autoUpdater.on('checking-for-update', () => setUpdaterState('checking'));
  autoUpdater.on('update-not-available', () => setUpdaterState('up-to-date'));
  autoUpdater.on('download-progress', (p) => setUpdaterState('downloading', `${Math.round(p.percent)}%`));

  autoUpdater.on('update-available', (info) => {
    setUpdaterState('available', info.version);
    void dialog.showMessageBox(win, {
      type: 'info', buttons: ['Download & install', 'Later'], defaultId: 0, cancelId: 1,
      title: 'Update available',
      message: `Dota 2 NeuroSync ${info.version} is available.`,
      detail: 'Download it now? You can keep using the app while it downloads.',
    }).then(({ response }) => {
      if (response !== 0) return;
      if (process.platform === 'darwin') {
        const files = (info.files ?? []).map((f) => ({ url: f.url, sha512: f.sha512 ?? '' }));
        void runMacUpdate(win, { version: info.version, files }, dir);
      } else {
        void autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setUpdaterState('downloaded', info.version);
    void dialog.showMessageBox(win, {
      type: 'info', buttons: ['Restart & install', 'On next launch'], defaultId: 0, cancelId: 1,
      title: 'Update ready',
      message: `Version ${info.version} downloaded.`,
      detail: 'Restart now to finish installing?',
    }).then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall(); });
  });

  autoUpdater.on('error', (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    // First line only, capped — raw HTTP header dumps (cookies etc.) belong in
    // the log file, not the Settings UI.
    setUpdaterState('error', msg.split('\n')[0]!.slice(0, 140));
    console.error('[updater]', msg);
    // Persist for diagnosis — "the update didn't work" is undebuggable otherwise.
    try {
      appendFileSync(join(dir, 'updater.log'), `${new Date().toISOString()} ${msg}\n`, 'utf8');
    } catch { /* non-fatal */ }
  });

  void autoUpdater.checkForUpdates();
}

async function start(): Promise<void> {
  const dir = configDir();
  const token = loadOrCreateToken(dir);
  const cfg = ensureGsiConfig(token, dir);
  const openaiKey = readOpenAiKey(dir);

  const staticDir = app.isPackaged
    ? join(process.resourcesPath, 'overlay')
    : join(__dirname, '../../overlay/dist');

  const server = buildServer({
    token, hub: new Hub(), openaiKey, staticDir,
    // Version + updater surface for the overlay's Settings panel.
    version: app.getVersion(),
    updaterStatus: () => updaterState,
    checkUpdates: () => { if (app.isPackaged) void autoUpdater.checkForUpdates(); },
    // Default folder for saved EEG recordings (the user can override the path in
    // Settings → Raw EEG data folder).
    recordingsDir: join(dir, 'recordings'),
    // First-time setup writes the key here so it survives a restart.
    onSaveOpenAiKey: (key) => {
      try { writeFileSync(join(dir, 'openai-key.txt'), key, 'utf8'); } catch { /* non-fatal */ }
    },
  });
  await server.listen({ host: '127.0.0.1', port: PORT });

  // Screen-capture source picker: the overlay records gameplay via
  // getDisplayMedia (Settings → "Arm screen capture"). Chromium has no built-in
  // picker in Electron, so resolve the source here — prefer the Dota 2 window,
  // else the primary screen — making "arm" a single click with no dialog.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['window', 'screen'] }).then((sources) => {
      const dota = sources.find((s) => /\bdota 2\b/i.test(s.name));
      const screen = sources.find((s) => s.id.startsWith('screen:')) ?? sources[0];
      const pick = dota ?? screen;
      if (pick) callback({ video: pick });
      else callback({});                       // nothing to share — deny
    }).catch(() => callback({}));
  });

  const win = new BrowserWindow({
    width: 460,
    height: 920,
    title: `Dota 2 NeuroSync v${app.getVersion()}`,
    autoHideMenuBar: true,
    // Match the overlay's app background so the window never flashes white
    // before the page paints (and around the content while loading).
    backgroundColor: '#0b1220',
    webPreferences: { contextIsolation: true },
  });
  await win.loadURL(`http://127.0.0.1:${PORT}`);
  // Keep the versioned title — the page's <title> would overwrite it on load.
  win.on('page-title-updated', (e) => e.preventDefault());
  // Open any external links (e.g. sources) in the system browser, not the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Web Bluetooth device picker: the overlay calls navigator.bluetooth to reach
  // the NeuroFocus EEG headset. Electron needs the host to resolve the chooser —
  // auto-pick the first NeuroFocus device so the in-page "Connect" just works.
  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    const nf = devices.find((d) => (d.deviceName ?? '').toUpperCase().includes('NEUROFOCUS'));
    if (nf) callback(nf.deviceId);
    else if (devices.length > 0) callback(devices[0]!.deviceId);
    // else: keep waiting; the picker times out client-side.
  });

  // Offer in-app updates (best-effort; user chooses).
  setupAutoUpdate(win, dir);

  if (!cfg.installed) {
    void dialog.showMessageBox(win, {
      type: 'info',
      title: 'One-time Dota 2 setup',
      message: 'Enable live game data',
      detail:
        `Copy this file:\n${cfg.path}\n\ninto your Dota 2 folder:\n` +
        'steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration/\n\n' +
        'then fully restart Dota 2. (AI features need an OpenAI key in ' +
        `${join(dir, 'openai-key.txt')}.)`,
    });
  }
}

app.whenReady().then(start).catch((err) => {
  dialog.showErrorBox('Dota 2 NeuroSync failed to start', String(err instanceof Error ? err.stack : err));
  app.quit();
});
app.on('window-all-closed', () => app.quit());
