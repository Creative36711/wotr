# Portable Windows build

The portable edition is a single executable: it does not install the app and does not require files next to it.

## One-time Windows setup

1. Install Node.js 20 or newer.
2. Install Rust: `winget install --id Rustlang.Rustup`, restart PowerShell, then run `rustup default stable-msvc`.
3. Install Microsoft Visual Studio Build Tools 2022 and select **Desktop development with C++** plus a Windows 10/11 SDK.
4. Restart PowerShell or Windows.

Verify:

```powershell
node --version
npm --version
rustc --version
cargo --version
```

## Build

The easiest option is to double-click:

```text
BUILD_PORTABLE_WINDOWS.bat
```

Or use PowerShell:

```powershell
cd wotr
npm ci
npm run desktop:portable
```

The one-file build is copied to:

```text
portable\War-of-the-Ring_0.45.4_windows_x64.exe
```

Send only this EXE to the tester. On first launch it creates `portable_data` directly beside the executable. All settings, mods, maps, logs and per-mod saves live in that folder; AppData is never used. Keep the EXE and `portable_data` together when moving the application. If the EXE is placed in a protected folder such as Program Files, move it to a writable folder like `D:\Games\WOTR` or Documents.

## Test during development

```powershell
npm run tauri:dev
```

## Compatibility

The portable build relies on Microsoft Edge WebView2 installed in Windows. It is normally included with current Windows 10 updates and Windows 11. If the EXE does not start on an old or stripped-down system, install the Microsoft WebView2 Evergreen Runtime or use an installer build.

The EXE is unsigned, so Windows SmartScreen can display an unknown-publisher warning during private testing.
