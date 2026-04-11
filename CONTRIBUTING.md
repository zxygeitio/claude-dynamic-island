# Contributing

## Local Setup

```bash
npm install
npm run tauri dev
```

Requirements:

- Node.js 18+
- Rust stable
- Windows 11

## Verification

Run these before opening a pull request:

```bash
npx tsc --noEmit
cd src-tauri && cargo check && cargo test
```

If you touch release packaging, also run:

```bash
npm run build:release
```

## Project Conventions

- Keep the island behavior stable in both development and packaged builds.
- Do not overwrite user Claude hook settings; merge project hooks into existing config.
- Keep portable release output self-contained inside `release/`.
- Prefer direct, user-visible validation for tray behavior, icon changes, and hook flows.

## Pull Requests

- Keep changes focused.
- Include screenshots for visible UI changes.
- Mention Windows-specific behavior if your change depends on shell, tray, or WebView behavior.
