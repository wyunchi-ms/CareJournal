# CareJournal Tauri backend

This backend is foreground-only and stores portable native data under `CareJournalData` next to `CareJournal.exe`.

The main WebView2 user data directory is explicitly configured with Tauri's `WebviewWindowBuilder::data_directory` to `<exe-dir>/CareJournalData/WebView2`. If a future platform/runtime ignores this setting, WebView2 may fall back to the OS profile location; the application-owned media and LAN metadata still use `<exe-dir>/CareJournalData`.

Build a portable executable without an installer:

```powershell
npm run tauri:build:portable
```

The helper script runs the frontend build and `cargo tauri build --no-bundle`, then creates a ZIP containing `CareJournal.exe`, usage notes and a `CareJournalData` directory.
