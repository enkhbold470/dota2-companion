import { app, BrowserWindow, shell, dialog } from 'electron';
// electron-updater is CommonJS with NO default export — a default import resolves to
// undefined. Use the named export (esbuild reads it off the require() result).
import { autoUpdater } from 'electron-updater';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { buildServer } from '../../listener/src/server';
import { Hub } from '../../listener/src/hub';

const PORT = Number(process.env.PORT ?? 53000);

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

// In-app software updates from GitHub releases. The user always chooses — we never
// download or install without a click. Best-effort: an update check must never block
// or crash the app (offline, rate-limited, unsigned dev build all fail quiet).
function setupAutoUpdate(win: BrowserWindow): void {
  if (!app.isPackaged) return; // dev has no release feed
  autoUpdater.autoDownload = false;          // ask before downloading
  autoUpdater.autoInstallOnAppQuit = true;   // if they defer, install on next quit

  autoUpdater.on('update-available', (info) => {
    void dialog.showMessageBox(win, {
      type: 'info', buttons: ['Download & install', 'Later'], defaultId: 0, cancelId: 1,
      title: 'Update available',
      message: `Dota 2 Companion ${info.version} is available.`,
      detail: 'Download it now? You can keep using the app while it downloads.',
    }).then(({ response }) => { if (response === 0) void autoUpdater.downloadUpdate(); });
  });

  autoUpdater.on('update-downloaded', (info) => {
    void dialog.showMessageBox(win, {
      type: 'info', buttons: ['Restart & install', 'On next launch'], defaultId: 0, cancelId: 1,
      title: 'Update ready',
      message: `Version ${info.version} downloaded.`,
      detail: 'Restart now to finish installing?',
    }).then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall(); });
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater]', err instanceof Error ? err.message : err);
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
    // Default folder for saved EEG recordings (the user can override the path in
    // Settings → Raw EEG data folder).
    recordingsDir: join(dir, 'recordings'),
    // First-time setup writes the key here so it survives a restart.
    onSaveOpenAiKey: (key) => {
      try { writeFileSync(join(dir, 'openai-key.txt'), key, 'utf8'); } catch { /* non-fatal */ }
    },
  });
  await server.listen({ host: '127.0.0.1', port: PORT });

  const win = new BrowserWindow({
    width: 460,
    height: 920,
    title: 'Dota 2 Companion',
    autoHideMenuBar: true,
    // Match the overlay's app background so the window never flashes white
    // before the page paints (and around the content while loading).
    backgroundColor: '#0b1220',
    webPreferences: { contextIsolation: true },
  });
  await win.loadURL(`http://127.0.0.1:${PORT}`);
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
  setupAutoUpdate(win);

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
  dialog.showErrorBox('Dota 2 Companion failed to start', String(err instanceof Error ? err.stack : err));
  app.quit();
});
app.on('window-all-closed', () => app.quit());
