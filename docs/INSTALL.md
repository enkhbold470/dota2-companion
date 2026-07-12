# Installing Dota 2 NeuroSync

**Dota 2 NeuroSync** by [NeuroFocus](https://neurofocus.dev) — read-only, advisory-only, local-first. Grab the latest build from the [releases page](https://github.com/enkhbold470/dota2-companion/releases/latest).

## Windows

1. Download **`Dota2-NeuroSync-Setup-<version>.exe`** and run it.
2. If SmartScreen shows *"Windows protected your PC"*, click **More info → Run anyway** (the build isn't code-signed yet).
3. The app generates your GSI config and installs it into Dota automatically when it can find your Steam folder.

## macOS (Apple Silicon)

1. Download **`Dota2-NeuroSync-<version>-arm64.dmg`**, open it, and drag **Dota 2 NeuroSync** into **Applications**.
2. The build is ad-hoc signed but not notarized, so the first launch is blocked by Gatekeeper. Clear the quarantine flag once in Terminal and it opens normally forever after:

   ```bash
   xattr -dr com.apple.quarantine "/Applications/Dota 2 NeuroSync.app"
   ```

   Prefer no terminal? Try to open the app → it gets blocked → **System Settings → Privacy & Security** → scroll down → **Open Anyway** → authenticate. (On macOS Sequoia and later the old right-click → Open trick no longer works.)

3. If you ever see *"Dota 2 NeuroSync is damaged and can't be opened"*, you're running an old build (≤ 0.9.0) that shipped with a broken signature — delete it and download the current release, then run the `xattr` command above.

> Why the hoops? Gatekeeper flags every non-notarized download. Proper notarization (Apple Developer Program) is on the roadmap; until then the `xattr` command is the one-time fix.

## After installing

1. Launch the app. If it couldn't find your Steam folder, it shows the one-time GSI setup dialog — copy the generated `.cfg` into `steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration/` and fully restart Dota 2.
2. Add your OpenAI key in **Settings ⚙** to light up the AI features (item builds, draft vision, coach, deep analysis). Everything else works without it.
3. Play. Arm screen capture when prompted at draft — that powers auto hero detection and the video-synced review.

Updates are delivered in-app from GitHub releases — you always choose when to download and install.
