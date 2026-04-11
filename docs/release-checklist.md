# Release Checklist

## Before Building

- confirm `npm install` completed successfully
- confirm icons have been regenerated if mascot assets changed
- confirm Claude hook merge logic still preserves existing user config

## Build

```bash
npm run build:release
```

## Smoke Checks

- launch `release/Claude Dynamic Island.exe`
- verify the island renders with the yellow mascot
- verify tray menu contains `Show Claude Dynamic Island` and `Exit`
- verify the close button exits the app
- verify startup self-check reports hook health
- verify Claude Code hook events show up in the island
- verify portable release folder contains `_up_`
- verify installer output exists under `src-tauri/target/release/bundle/nsis/`

## Screenshots

Update these when the UI changes materially:

- `docs/images/desktop-integration.png`
- `docs/images/island-inline.png`
- `docs/images/github-social-preview.png`
