# Installing Dota 2 NeuroSync

Download from the [latest release](https://github.com/enkhbold470/dota2-companion/releases/latest).

## Windows

1. Run **`Dota2-NeuroSync-Setup-<version>.exe`**.
2. If SmartScreen appears: **More info → Run anyway**.

## macOS

1. Open the **`.dmg`**, drag **Dota 2 NeuroSync** into **Applications**.
2. Run this once in Terminal (the app isn't notarized yet):

   ```bash
   xattr -dr com.apple.quarantine "/Applications/Dota 2 NeuroSync.app"
   ```

3. Open the app.

No Terminal? Try to open the app → **System Settings → Privacy & Security → Open Anyway**.

## First run

- The app installs Dota's GSI config automatically when it finds Steam — restart Dota 2 once. If it can't find Steam, it shows you the file to copy.
- Optional: add an OpenAI key in **Settings ⚙** to enable the AI features. Everything else works without it.

Updates arrive in-app; you choose when to install.
