// electron-builder afterPack hook: ad-hoc sign the macOS app.
//
// We have no Apple Developer cert (identity: null), but shipping with NO valid
// signature is fatal on Apple Silicon: electron-builder rewrites Info.plist after
// packing, invalidating the ad-hoc seal the Electron prebuilt ships with, and
// macOS then refuses the quarantined app outright ("damaged and can't be opened",
// no bypass). Re-signing ad-hoc ("-") restores a valid seal so the app opens via
// System Settings → "Open Anyway" or `xattr -dr com.apple.quarantine`.
const { execFileSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const { join } = require('node:path');

exports.default = function adHocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = readdirSync(context.appOutDir).find((n) => n.endsWith('.app'));
  if (!appName) throw new Error(`mac-adhoc-sign: no .app bundle in ${context.appOutDir}`);
  const appPath = join(context.appOutDir, appName);
  // --deep is deprecated for real distribution signing, but it's the standard way
  // to blanket ad-hoc sign an Electron bundle's nested frameworks/helpers.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  console.log(`mac-adhoc-sign: ad-hoc signed ${appName}`);
};
