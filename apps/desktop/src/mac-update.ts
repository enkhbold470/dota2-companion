/**
 * Self-managed macOS update: download the release zip, verify its sha512
 * against the update feed, and swap the .app bundle in place.
 *
 * Why not Squirrel.Mac (Electron's autoUpdater.quitAndInstall)? ShipIt
 * validates the downloaded app against the RUNNING app's code-signature
 * designated requirement. We sign ad-hoc (no Apple cert), and an ad-hoc DR is
 * a per-build cdhash — so Squirrel rejects every update with "Code signature
 * … did not pass validation". This module replaces the install step; the
 * check (reading latest-mac.yml) still comes from electron-updater.
 *
 * Side benefit: the zip is fetched by this process, not a browser, so the new
 * bundle carries no com.apple.quarantine flag — no Gatekeeper re-prompt, no
 * repeat xattr.
 *
 * Plain Node (no Electron imports) so the flow is testable outside the app.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, dirname, basename } from 'node:path';

const execFileP = promisify(execFile);

/** The slice of electron-updater's UpdateInfo we need (files come from latest-mac.yml). */
export interface MacUpdateInfo {
  version: string;
  files: { url: string; sha512: string }[];
}

export interface MacUpdateOptions {
  info: MacUpdateInfo;
  /** Absolute path of the installed .app bundle to replace. */
  bundlePath: string;
  /** Scratch space for the download + extraction (created, then removed). */
  workDir: string;
  /** GitHub release download base, e.g. https://github.com/o/r/releases/download */
  releaseBase: string;
  onProgress?: (percent: number) => void;
  fetchImpl?: typeof fetch; // test seam
}

/** Resolve the running .app bundle from process.execPath (…/Foo.app/Contents/MacOS/bin). */
export function bundleFromExecPath(execPath: string): string | null {
  const bundle = dirname(dirname(dirname(execPath)));
  return bundle.endsWith('.app') ? bundle : null;
}

async function download(url: string, dest: string, expectedSha512: string,
  onProgress: ((percent: number) => void) | undefined, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl(url);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} ${url}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const hash = createHash('sha512');
  let seen = 0;
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  body.on('data', (chunk: Buffer) => {
    hash.update(chunk);
    seen += chunk.length;
    if (total > 0) onProgress?.(Math.round((seen / total) * 100));
  });
  await pipeline(body, createWriteStream(dest));
  const got = hash.digest('base64');
  if (got !== expectedSha512) throw new Error(`sha512 mismatch for ${basename(dest)}`);
}

/**
 * Download + verify + swap. On success the bundle at `bundlePath` IS the new
 * version — the caller just relaunches. Throws on any failure, leaving the
 * installed app untouched (the swap is backup-first and rolls back).
 */
export async function downloadAndSwap(opts: MacUpdateOptions): Promise<void> {
  const file = opts.info.files.find((f) => f.url.endsWith('.zip'));
  if (!file) throw new Error('no zip asset in the update feed');
  const fetchImpl = opts.fetchImpl ?? fetch;

  await rm(opts.workDir, { recursive: true, force: true });
  await mkdir(opts.workDir, { recursive: true });
  try {
    const zipPath = join(opts.workDir, file.url);
    // Artifact names are space-free by design, but encode defensively.
    await download(
      `${opts.releaseBase}/v${opts.info.version}/${encodeURIComponent(file.url)}`,
      zipPath, file.sha512, opts.onProgress, fetchImpl,
    );

    // ditto preserves the framework symlinks + permissions an .app needs
    // (plain unzip implementations often don't).
    const extractDir = join(opts.workDir, 'extracted');
    await execFileP('ditto', ['-xk', zipPath, extractDir]);
    const appName = (await readdir(extractDir)).find((n) => n.endsWith('.app'));
    if (!appName) throw new Error('zip did not contain an .app bundle');
    const staged = join(extractDir, appName);
    // Sanity: it must at least look like a Mach-O bundle before we swap.
    await readFile(join(staged, 'Contents', 'Info.plist'));

    // Backup-first swap, same directory so rename never crosses volumes.
    const backup = `${opts.bundlePath}.old`;
    await rm(backup, { recursive: true, force: true });
    await rename(opts.bundlePath, backup);
    try {
      try {
        await rename(staged, opts.bundlePath);
      } catch {
        // workDir on another volume — fall back to a ditto copy.
        await execFileP('ditto', [staged, opts.bundlePath]);
      }
    } catch (err) {
      await rename(backup, opts.bundlePath); // roll back, app still intact
      throw err;
    }
    // Deleting the backup is safe while the old binary runs (macOS keeps the inode).
    await rm(backup, { recursive: true, force: true }).catch(() => undefined);
  } finally {
    await rm(opts.workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
