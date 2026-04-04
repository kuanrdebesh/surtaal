# Windows Desktop Build Guide

This guide explains how to produce the first self-contained Windows build of Surtaal.

The current repo already includes:

- an Electron desktop shell
- a Windows installer build path
- a backend runtime layout for desktop mode
- a Windows backend bundle script

What is still required is to build and bundle the backend runtime on a Windows machine and include the Windows audio binaries.

## Goal

Produce a Windows installer that can launch Surtaal without requiring the end user to install Python, Node.js, or frontend tooling manually.

## Build Machine Requirements

Set up a Windows build machine with:

- Git
- Node.js 18 or newer
- Python 3.10 or 3.11
- PowerShell

Recommended:

- Windows 11
- enough disk space for Electron, Python dependencies, and build output

## Important Repo Files

- Desktop launcher: `desktop/electron/main.cjs`
- Desktop preload bridge: `desktop/electron/preload.cjs`
- Backend runtime config: `backend/runtime.py`
- Windows backend bundle script: `desktop/scripts/build-backend-win.ps1`
- Desktop package config: `package.json`

## Binaries You Must Provide

Download Windows builds of these tools:

- `ffmpeg.exe`
- `ffprobe.exe`
- `rubberband.exe`

Important for Rubber Band:

- do not copy only `rubberband.exe`
- copy `rubberband.exe` and any DLL files that come with the Windows Rubber Band package
- place those DLLs in the same folder as `rubberband.exe`

Place them here:

- `desktop/vendor/bin/ffmpeg.exe`
- `desktop/vendor/bin/ffprobe.exe`
- `desktop/vendor/bin/rubberband.exe`
- `desktop/vendor/bin/*.dll` from the Rubber Band package, if provided

These binaries are used by the packaged desktop runtime through the environment wiring in `backend/runtime.py`.

## Build Steps On Windows

### 1. Clone the repo

Open PowerShell and go to the project:

```powershell
cd path\to\surtaal
```

### 2. Install desktop dependencies

```powershell
npm install
```

The frontend dependencies may already be present in the repo structure, but to be safe:

```powershell
npm --prefix frontend install
```

### 3. Build the packaged backend

Run:

```powershell
npm run desktop:build:backend:win
```

This script:

- creates a dedicated backend build virtual environment
- installs desktop backend dependencies
- runs PyInstaller
- produces a packaged backend bundle

Expected output folder:

```text
desktop\backend-dist\surtaal-backend\
```

### 4. Add the required Windows binaries

Copy these files into:

```text
desktop\vendor\bin\
```

Required files:

- `ffmpeg.exe`
- `ffprobe.exe`
- `rubberband.exe`

Also copy:

- any DLL files shipped alongside `rubberband.exe` in the Windows Rubber Band download

If you only copy `rubberband.exe`, tempo and pitch processing can fail at runtime with a Windows DLL error.

### 5. Build the frontend

```powershell
npm run frontend:build
```

### 6. Build the Windows installer

```powershell
npm run desktop:build
```

## Expected Output

After a successful build, look in:

```text
dist\
```

Expected artifacts:

- `Surtaal Setup 1.0.0.exe`
- `Surtaal Setup 1.0.0.exe.blockmap`
- `win-unpacked\`

Main files:

- installer: `dist\Surtaal Setup 1.0.0.exe`
- portable app: `dist\win-unpacked\Surtaal.exe`

## Which File To Run On Windows

Use:

- `Surtaal Setup 1.0.0.exe` for normal installer testing

Or:

- `win-unpacked\Surtaal.exe` for direct portable-run testing

## What To Test After Building

Test on a Windows machine that does not already have Surtaal configured manually.

### Basic startup

- installer runs
- app opens
- no Python install prompt appears
- backend starts automatically

### Core workflows

- upload audio works
- BPM detection works
- pitch shift works
- workshop opens and plays audio

### Heavier workflow

- stem separation starts
- Demucs model download works on first use
- results can be previewed and downloaded

### Runtime folders

Confirm desktop mode creates and uses its own runtime folders for:

- uploads
- outputs
- model cache

## Likely Failure Points

### 1. Missing audio binaries

Symptoms:

- pitch or tempo processing fails
- ffmpeg export fails
- rubberband-based pitch/tempo path fails

Fix:

- verify `desktop/vendor/bin/` contains the required `.exe` files
- if Rubber Band is being used, also verify the DLLs from the Rubber Band Windows package were copied next to `rubberband.exe`

### 2. PyInstaller backend bundle misses a dependency

Symptoms:

- desktop app opens but backend crashes immediately
- import error in packaged backend

Fix:

- adjust `desktop/scripts/build-backend-win.ps1`
- add missing `--hidden-import` or `--collect-all` entries

### 3. Demucs first-run model download issues

Symptoms:

- stem separation fails on first use

Fix:

- verify internet access on first model download
- confirm the packaged backend can write to the model cache directory

### 4. Windows Defender / unknown publisher warnings

Symptoms:

- Windows warns users before launch

Fix:

- expected for unsigned builds
- code signing is a later polish step

## Current Status

The repo is now at this stage:

- Electron desktop shell works
- frontend build works
- Windows installer build path works
- backend runtime layout is desktop-aware

Still needed for a truly self-contained Windows release:

- build backend bundle on Windows
- add Windows audio binaries
- test installer on a real Windows machine

## Recommended Progression

### Milestone 1

Get the installer to launch and confirm:

- app opens
- BPM and pitch workflows work

### Milestone 2

Confirm:

- stem separation works
- model downloads work
- results can be previewed and exported

### Milestone 3

Polish:

- custom app icon
- code signing
- better update/distribution flow
