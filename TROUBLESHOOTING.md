# SurTaal Troubleshooting Guide

Use this guide when something in SurTaal does not behave as expected. The fastest path is:

1. Read the exact error message.
2. Cancel the current job if a cancel button is visible.
3. Retry once.
4. If it still fails, use the section below that matches what you are seeing.

## Startup And Backend

### App opens but actions do nothing

Possible cause:
- the backend is not running

What to do:
- restart SurTaal normally
- on Mac:
  ```bash
  cd ~/Documents/surtaal
  ./start.sh
  ```
- for Electron desktop on Mac:
  ```bash
  cd ~/Documents/surtaal
  npm run desktop
  ```

### Cannot reach backend / server not running

Possible cause:
- FastAPI did not start
- another process is using the expected port

What to do:
- stop SurTaal and restart it
- if it still fails, run backend and frontend separately to see the real error
  ```bash
  cd ~/Documents/surtaal/backend
  source venv/bin/activate
  uvicorn main:app --port 8000 --reload
  ```
  ```bash
  cd ~/Documents/surtaal/frontend
  npm run dev
  ```

## Playback And Preview

### Uploaded file plays, but generated output does not scrub or seek correctly

What to do:
- make sure you are on the latest build of SurTaal
- newer builds serve generated files with byte-range support so seeking works properly

### Audio does not play reliably in browser mode

What to do:
- prefer Google Chrome
- Safari can behave inconsistently with Web Audio features

### App name or icon shows as Electron in dev mode

What this means:
- `npm run desktop` is still a development shell

What to do:
- use a packaged build for the real app name/icon behavior

## Long Jobs And Cancelling

### A button seems frozen or nothing responds during processing

What this means:
- the tool is already running a job
- SurTaal now blocks new actions while a job is active

What to do:
- use `Cancel` in the section status area
- or use `Cancel` in the floating background notification
- after cancellation finishes, try another setting

### Progress looks strange or stalls near the end

What this means:
- different engines report progress differently
- MP3 writing, cleanup, or file move steps may happen after model inference finishes

What to do:
- wait a little longer once
- if it still does not finish, cancel and retry

## Stem Separator And Demucs

### Stem extraction fails in Best Quality

What to do:
1. retry once
2. if it still fails, switch to `Fast`
3. if you only need backing/vocals, request fewer stems
4. restart SurTaal and try again

### Demucs downloads model files and seems slow the first time

What this means:
- first-time model download and cache setup is normal

What to do:
- let the first run finish
- later runs should be faster

### Demucs gives a model or segment error

What to do:
- retry once
- if the issue appears only in `Best Quality`, switch to `Fast`
- if the message is still new or unexpected, keep the exact error text and share it

### Guitar or piano stems force a different mode

What this means:
- those stems need the 6-source separation path

What to do:
- allow SurTaal to use the slower required model path

## Vocal Remover

### Karaoke output still contains some voice

What this means:
- heavy reverb, crowd/live audio, or dense mastering can leave vocal residue

What to do:
- try `Best Quality`
- or use `Stem Separator` and compare the extracted backing stem

## Pitch Shift And Tempo

### Tempo or pitch change fails

What to do:
- retry once
- if you are on a packaged Windows build, rebuild with the latest backend bundle
- keep the exact error message if it persists

### Original key or BPM is missing

What this means:
- detection was uncertain or failed

What to do:
- try a cleaner section of the song
- use the tool manually without relying on auto-detection if needed

## Audio Enhancement

### Effect mode or enhancement mode fails

What to do:
- keep the selected region simple and non-empty
- try one effect at a time
- retry once before stacking multiple changes

### Frequency removal does not behave as expected

What this means:
- current frequency removal is numeric band targeting, not full spectral editing

What to do:
- narrow the selected band
- reduce strength
- compare with a lighter EQ-style approach first

### Result sounds too processed

What to do:
- reduce one control at a time
- prefer smaller changes over stacking strong settings
- save the better version to the Library when you like the result

## Library

### Save to Library seems unclear

What to expect:
- SurTaal’s Library is a live session library
- it tracks useful current-session assets for reuse across tools

What to do:
- use the header `Library` button to verify saved items
- rename or delete items there if needed

### A saved item is hard to recognize

What to do:
- rename it in the Library
- SurTaal tries to prefill useful names, but rename is available directly in the list

## Audio Workshop

### I made a mistake while editing clips

What to do:
- use `Ctrl/Cmd + Z` to Undo and `Ctrl/Cmd + Shift + Z` to Redo.
- or click the Undo/Redo buttons directly in the top action bar of the Workshop.

### Add Tracks vs Load Project feels confusing

What the difference is:
- `Load Project` restores a saved Workshop session file
- `Add Tracks` imports audio into the current session

### I want to reuse something from another tool

What to do:
- save it to the Library
- then use `Add Tracks -> From Library` in Workshop

### The view feels too cramped

What to do:
- collapse the sidebar with the hamburger button
- resize the Workshop left panel horizontally
- adjust the global row height control in Workshop

## Windows Build And Installer

### Windows app shows old functionality after rebuild

Possible cause:
- old source files were copied into the wrong folder
- old installed app was opened instead of the new unpacked build

What to do:
- verify files were copied into the correct paths
- test `dist\\win-unpacked\\Surtaal.exe` first
- only test the installer after that

### PowerShell says scripts are disabled

What to do:
- use Command Prompt instead of PowerShell
- or run:
  ```powershell
  Set-ExecutionPolicy -Scope Process Bypass
  ```

### Build fails because files are in use

What to do:
- close SurTaal
- stop old app processes
- remove old `dist\\win-unpacked`
- rebuild again

### Packaged backend is missing

What to do:
- rebuild the Windows backend first
  ```cmd
  npm run desktop:build:backend:win
  npm run desktop:build
  ```

## When To Report The Error

Please keep the exact error message if:
- retrying once does not help
- switching from `Best` to `Fast` does not help
- cancellation does not finish
- the app opens but a tool never completes

Most useful details:
- which section you were in
- what button you clicked
- whether this was Mac or Windows
- the exact text of the error
