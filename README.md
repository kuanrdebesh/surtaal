# 𝄞 Surtaal

Audio studio for Indian performers to separate stems, create karaoke tracks, shift pitch, adjust tempo, enhance recordings, and build rehearsal-ready mixes locally.

> Phase 1: free local audio tools for Hindustani, Bollywood, and practice-focused music workflows

Surtaal is designed for singers, students, and musicians who want more control over **sur**, **taal**, and arrangement without sending songs to a cloud service. It runs on your machine, keeps the workflow simple, and now includes Audio Enhancement, a shared session Library, and an in-browser workshop for trying ideas quickly.

## Why Surtaal

- Built for Indian music practice and stage-prep workflows
- Runs locally on your Mac with no recurring API cost
- Lets you preview uploads, process in the background, and keep working
- Includes Audio Enhancement for cleanup and effects
- Includes a shared session Library for reusing outputs across tools
- Includes a workshop for layering tracks, saving projects, and exporting mixes

## What You Can Do

| Tool | What it does |
|---|---|
| **Stem Separator** | Extract only the stems you need, such as vocals, backing, drums, bass, guitar, piano, or other |
| **Vocal Remover** | Generate karaoke-style backing tracks from full songs |
| **Pitch Shift** | Change key without changing tempo |
| **BPM & Tempo** | Detect BPM and slow down or speed up tracks for practice |
| **Audio Enhancement** | Clean recordings, remove hum/noise, shape frequency ranges, and add effects to selected regions |
| **Library** | Reuse current-session outputs across tools and Workshop without re-uploading from disk |
| **Audio Workshop** | Load tracks, save or load Workshop projects, arrange clips, and build mixes |
| **Medley Builder** | Stitch multiple songs with crossfades |
| **Trim & Fade** | Cut clips, add fades, and export polished sections |

## Quick Start

```bash
cd ~/Documents/surtaal
chmod +x setup.sh start.sh
./setup.sh
./start.sh
```

Then open:

- `http://localhost:3000`
- `http://localhost:3000/how-to-use.html`

Everything runs **100% locally on your Mac**. After setup, most workflows do not require internet access except first-time model downloads.

## Guides

- Live guide inside the app: `http://localhost:3000/how-to-use.html`
- Shareable standalone guide in this repo: `Surtaal-How-To-Guide-Standalone.html`
- Dedicated troubleshooting guide in this repo: `TROUBLESHOOTING.md`

---

## Requirements

- macOS (Apple Silicon or Intel)
- Python 3.10 or 3.11
- Node.js 18+
- Homebrew

---

## Setup (One Time)

### Step 1 — Clone or extract this folder
Place the `surtaal/` folder anywhere you like, e.g. `~/Documents/surtaal`

### Step 2 — Open Terminal and navigate to the folder
```bash
cd ~/Documents/surtaal
```

### Step 3 — Run the setup script
```bash
chmod +x setup.sh start.sh
./setup.sh
```

This will:
- Install `ffmpeg` and `rubberband` via Homebrew
- Create a Python virtual environment in `backend/venv/`
- Install all Python audio libraries
- Install React frontend dependencies

⏱ First run takes about 5–8 minutes depending on your internet speed.

---

## Running the App

Every time you want to use Surtaal:

```bash
cd ~/Documents/surtaal
./start.sh
```

This opens your browser automatically at **http://localhost:3000**

Press `Ctrl+C` in Terminal to stop everything.

### Help page

Once the app is running, open:

```text
http://localhost:3000/how-to-use.html
```

This shows a standalone guided walkthrough of the main tools and workflow.

---

## Desktop Packaging Starter

Surtaal now includes a quick desktop scaffold for the fastest path toward a Windows app:

- Electron desktop shell in `desktop/electron/`
- Shared frontend API config so the UI can run in browser mode or desktop mode
- Root packaging scripts in `package.json`

Current scope of this starter:

- launches the built frontend inside Electron
- starts the FastAPI backend in the background
- keeps the current architecture mostly intact

What still needs to be bundled for a polished Windows installer:

- Python runtime
- `ffmpeg`
- `rubberband`
- Windows-tested Demucs/runtime packaging

Starter commands:

```bash
npm install
npm run frontend:build
npm run desktop
```

Windows build target:

```bash
npm run desktop:build
```

This is the quickest workable desktop path, not the final production-grade installer yet.

To move toward a self-contained Windows build, Surtaal now also includes:

- portable backend runtime paths via environment variables
- Electron-managed runtime folders for uploads, outputs, and model cache
- a Windows backend bundling script:

```powershell
npm run desktop:build:backend:win
```

That script is meant to run on a Windows build machine. It prepares a packaged backend in `desktop/backend-dist/`, which the Electron installer can include automatically.

---

## Manual Start (if start.sh has issues)

Open two Terminal windows:

**Terminal 1 — Backend:**
```bash
cd ~/Documents/surtaal/backend
source venv/bin/activate
uvicorn main:app --port 8000 --reload
```

**Terminal 2 — Frontend:**
```bash
cd ~/Documents/surtaal/frontend
npm run dev
```

Then open http://localhost:3000 in your browser.

---

## Architecture

Surtaal is a local two-process app:

- The frontend is a React + Vite single-page app on `http://localhost:3000`
- The backend is a FastAPI service on `http://localhost:8000`
- The browser talks directly to FastAPI using `fetch` and `multipart/form-data`
- There is no database in Phase 1; state is kept either in browser memory or in backend memory

### Frontend

- `frontend/src/App.jsx` is the shell for navigation, shared UI state, and the session library
- Tool views stay mounted when hidden, so switching tabs does not wipe form/results state
- `frontend/src/useJob.js` is the shared async client for long-running jobs:
  - submit a request
  - poll `/job/{job_id}`
  - expose `status`, `progress`, `results`, and download URLs
- Standard tools like stem separation, vocal removal, pitch shift, tempo change, and audio enhancement are thin React views over backend endpoints
- `frontend/src/components/Workshop.jsx` is a clip-based mini-DAW that keeps editing state in React and uses:
  - `mixer.js` for Web Audio playback, mute/solo, seek, and transport
  - `waveform.js` for waveform and ruler rendering

### Backend

- `backend/main.py` handles uploads, routes, background jobs, and file downloads
- `backend/audio_ops.py` contains the processing functions
- Uploads are written to `backend/uploads/`
- Rendered results are written to `backend/outputs/`
- Long-running work is scheduled with FastAPI `BackgroundTasks` and executed with `asyncio.to_thread(...)`
- Job progress is tracked in the in-memory `job_status` map and exposed through:
  - `GET /job/{job_id}`
  - `GET /download/{filename}`

### Processing pipeline

1. The user drops an audio file in the React UI.
2. The frontend posts it to a FastAPI endpoint.
3. FastAPI saves the upload to `backend/uploads/`.
4. For long-running operations, FastAPI returns a `job_id` immediately.
5. A background task calls the matching function in `audio_ops.py`.
6. The frontend polls `/job/{job_id}` until it reaches `done` or `error`.
7. Completed files are downloaded from `backend/outputs/` through `/download/{filename}`.

### Workshop split: client vs server

The `Audio Workshop` deliberately splits responsibilities:

- Client-side:
  - timeline editing
  - clip metadata
  - waveform drawing
  - live playback and transport
  - mute/solo/volume state
- Server-side:
  - pitch-shift and tempo-change renders
  - trim/fade exports
  - stitched medleys
  - final mixed exports

This keeps editing responsive in the browser while using Python audio libraries for the actual renders.

### Current architectural constraints

- Backend job state is in memory only, so restarting the server clears active jobs
- Workshop upload slots are also in memory only
- The current architecture is designed for a single local user rather than multi-user deployment
- CORS is intentionally open because the app is meant to run locally on `localhost`

---

## Folder Structure

```
surtaal/
├── backend/
│   ├── main.py             ← FastAPI routes + job orchestration
│   ├── audio_ops.py        ← Audio processing functions
│   ├── requirements.txt    ← Python dependencies
│   ├── uploads/            ← Runtime temp uploads
│   ├── outputs/            ← Rendered audio files
│   └── venv/               ← Local Python virtual environment
├── frontend/
│   ├── src/
│   │   ├── App.jsx           ← App shell + shared state
│   │   ├── App.css           ← Main styling
│   │   ├── main.jsx          ← React entrypoint
│   │   ├── useJob.js         ← Shared job polling hook
│   │   └── components/
│   │       ├── StemSeparator.jsx
│   │       ├── VocalRemover.jsx
│   │       ├── PitchShifter.jsx
│   │       ├── BpmTool.jsx
│   │       ├── Workshop.jsx  ← Clip-based editor
│   │       ├── mixer.js      ← Web Audio playback engine
│   │       ├── waveform.js   ← Waveform utilities
│   │       ├── Shared.jsx
│   │       ├── MedleyBuilder.jsx
│   │       └── TrimFade.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── setup.sh                 ← One-time setup
├── start.sh                 ← Starts backend + frontend
└── README.md
```

---

## Tips for Indian Music

### Pitch Shifting for Sur
- If a Bollywood track is in **D** and your natural sur is **C**, shift **−2 semitones**
- If you sing in **Kafi** and the track is in **Khamaj**, that's often a **−2 semitone** shift
- Shifting **±12** gives you the same key one octave up or down

### Tempo for Raga Practice
- Use **×0.75** (75% speed) for slow practice of intricate taans
- Use **×1.0** (original) for performance
- Most classical compositions sit between **60–120 BPM**

### Medley for Stage Shows
- Trim each song first (using Trim & Fade) to the section you want
- Add 1–2 second fade in/out to each clip
- Then stitch them in Medley Builder with 2-second crossfade

### Stem Separation Quality
- **Fast**: Good default for experimentation and everyday practice
- **Best Quality**: Slower, but cleaner on dense arrangements
- Extracting only the stems you need is usually faster than asking for broader separation
- `Vocals` or `Backing` are usually lighter than `guitar` or `piano`, which require the heavier 6-stem path

---

## Troubleshooting

### "Cannot reach backend" error in the browser
1. Check Terminal 1 is running without errors
2. Visit http://localhost:8000/health — should show `{"status":"ok"}`
3. Make sure you activated the venv: `source venv/bin/activate`

### Demucs fails with `CERTIFICATE_VERIFY_FAILED`
```bash
cd ~/Documents/surtaal/backend
source venv/bin/activate
python -m pip install --upgrade certifi
```
Then restart Surtaal and try stem separation again. Demucs downloads its model the first time you use it.

### ffmpeg not found
```bash
brew install ffmpeg
```

### pyrubberband errors (pitch shift falls back to librosa)
```bash
brew install rubberband
pip install pyrubberband
```
This is non-critical — pitch shift still works via librosa, just slightly lower quality.

### Port already in use
```bash
lsof -ti:8000 | xargs kill -9
lsof -ti:3000 | xargs kill -9
```

### Output files not downloading
Processed files are saved in `backend/outputs/`. You can also access them directly from that folder.

---

## Coming in Phase 2 (Paid/AI Tier)

- 🎤 Voice range analysis & raga compatibility suggestions
- 🎵 Song recommendations based on your vocal profile  
- 🧙 Medley planning wizard with transition suggestions
- ✍️ Lyrics generation in Hindi/Urdu
- 🎛️ Custom backing track generation from text prompts
- ☁️ Cloud deployment for team access

---

## Tech Stack

- **Frontend**: React 18 + Vite
- **Backend**: Python FastAPI + Uvicorn
- **Stem separation**: Demucs
- **Pitch/tempo**: pyrubberband (rubberband), librosa
- **Audio I/O**: pydub, soundfile, ffmpeg
- **Browser audio**: Web Audio API
