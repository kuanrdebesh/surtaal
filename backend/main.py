from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Header, Response, status
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import uvicorn
import os
import uuid
import shutil
import asyncio
from pathlib import Path
from typing import Optional
import logging
import mimetypes
from runtime import UPLOAD_DIR, OUTPUT_DIR, configure_runtime_environment

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

configure_runtime_environment()

app = FastAPI(title="Surtaal Audio Engine", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

job_status = {}

def _safe_stem(name: str) -> str:
    stem = Path(name or "track").stem.strip()
    cleaned = "".join(ch if ch.isalnum() else "_" for ch in stem)
    cleaned = "_".join(part for part in cleaned.split("_") if part)
    return cleaned[:80] or "track"

def save_upload(file: UploadFile) -> Path:
    file_id = str(uuid.uuid4())
    ext = Path(file.filename).suffix or ".mp3"
    original_stem = _safe_stem(file.filename or "track")
    path = UPLOAD_DIR / f"{original_stem}__{file_id}{ext}"
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return path

@app.get("/health")
def health():
    return {"status": "ok", "message": "Surtaal backend is running"}

@app.get("/job/{job_id}")
def get_job(job_id: str):
    if job_id not in job_status:
        raise HTTPException(status_code=404, detail="Job not found")
    return job_status[job_id]

@app.get("/download/{filename}")
def download_file(filename: str, range_header: Optional[str] = Header(None, alias="Range")):
    path = OUTPUT_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    file_size = path.stat().st_size
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    common_headers = {
        "Accept-Ranges": "bytes",
        "Content-Disposition": f'inline; filename="{path.name}"',
    }

    if not range_header:
        return FileResponse(path, filename=filename, media_type=media_type, headers=common_headers)

    match = None
    try:
        import re
        match = re.match(r"bytes=(\d*)-(\d*)$", range_header.strip())
    except Exception:
        match = None

    if not match:
        return FileResponse(path, filename=filename, media_type=media_type, headers=common_headers)

    start_text, end_text = match.groups()
    if start_text == "" and end_text == "":
        return FileResponse(path, filename=filename, media_type=media_type, headers=common_headers)

    if start_text == "":
        length = min(int(end_text), file_size)
        start = max(0, file_size - length)
        end = file_size - 1
    else:
        start = int(start_text)
        end = int(end_text) if end_text else file_size - 1

    if start >= file_size or end < start:
        raise HTTPException(status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE, detail="Invalid range")

    end = min(end, file_size - 1)
    content_length = end - start + 1

    with open(path, "rb") as fh:
        fh.seek(start)
        content = fh.read(content_length)

    return Response(
        content=content,
        status_code=status.HTTP_206_PARTIAL_CONTENT,
        media_type=media_type,
        headers={
            **common_headers,
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(content_length),
        },
    )

# ── 1. STEM SEPARATION ──────────────────────────────────────────────────────

@app.post("/api/stem-separate")
async def stem_separate(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    stems: str = Form("2"),  # "2" = vocals+accompaniment, "4" = drums/bass/other/vocals
    engine: str = Form("demucs"),
    quality: str = Form("fast"),
    target_stems: str = Form(""),
):
    input_path = save_upload(file)
    job_id = str(uuid.uuid4())
    job_status[job_id] = {"status": "processing", "progress": 0}
    requested_targets = [part.strip() for part in target_stems.split(",") if part.strip()]
    background_tasks.add_task(_stem_separate_task, job_id, input_path, stems, engine, quality, requested_targets)
    return {"job_id": job_id}

async def _stem_separate_task(job_id: str, input_path: Path, stems: str, engine: str, quality: str, target_stems: list[str]):
    try:
        from audio_ops import stem_separate
        job_status[job_id]["progress"] = 10
        results = await asyncio.to_thread(
            stem_separate,
            input_path,
            stems,
            engine,
            quality,
            target_stems,
            lambda progress: job_status.get(job_id, {}).update(progress=progress),
        )
        job_status[job_id] = {
            "status": "done",
            "progress": 100,
            "files": results,
        }
    except Exception as e:
        logger.error(f"Stem separation failed: {e}")
        job_status[job_id] = {"status": "error", "message": str(e)}
    finally:
        if input_path.exists():
            os.remove(input_path)

# ── 2. VOCAL REMOVAL (KARAOKE) ───────────────────────────────────────────────

@app.post("/api/vocal-remove")
async def vocal_remove(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    quality: str = Form("fast"),
):
    input_path = save_upload(file)
    job_id = str(uuid.uuid4())
    job_status[job_id] = {"status": "processing", "progress": 0}
    background_tasks.add_task(_vocal_remove_task, job_id, input_path, quality)
    return {"job_id": job_id}

async def _vocal_remove_task(job_id: str, input_path: Path, quality: str):
    try:
        from audio_ops import vocal_remove
        job_status[job_id]["progress"] = 10
        result = await asyncio.to_thread(
            vocal_remove,
            input_path,
            quality,
            lambda progress: job_status.get(job_id, {}).update(progress=progress),
        )
        job_status[job_id] = {"status": "done", "progress": 100, "files": result}
    except Exception as e:
        logger.error(f"Vocal removal failed: {e}")
        job_status[job_id] = {"status": "error", "message": str(e)}
    finally:
        if input_path.exists():
            os.remove(input_path)

# ── 3. KEY DETECTION ─────────────────────────────────────────────────────────

@app.post("/api/detect-key")
async def detect_key_endpoint(file: UploadFile = File(...)):
    input_path = save_upload(file)
    try:
        from audio_ops import detect_key
        result = await asyncio.to_thread(detect_key, input_path)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if input_path.exists():
            os.remove(input_path)

# ── 4. KEY / PITCH CHANGE ────────────────────────────────────────────────────

@app.post("/api/pitch-shift")
async def pitch_shift(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    semitones: float = Form(...),
    output_format: str = Form("mp3"),
):
    input_path = save_upload(file)
    job_id = str(uuid.uuid4())
    job_status[job_id] = {"status": "processing", "progress": 0}
    background_tasks.add_task(_pitch_shift_task, job_id, input_path, semitones, output_format)
    return {"job_id": job_id}

async def _pitch_shift_task(job_id: str, input_path: Path, semitones: float, output_format: str):
    try:
        from audio_ops import pitch_shift
        job_status[job_id]["progress"] = 20
        result = await asyncio.to_thread(pitch_shift, input_path, semitones, output_format)
        job_status[job_id] = {"status": "done", "progress": 100, "files": result}
    except Exception as e:
        logger.error(f"Pitch shift failed: {e}")
        job_status[job_id] = {"status": "error", "message": str(e)}
    finally:
        if input_path.exists():
            os.remove(input_path)

# ── 4. BPM DETECTION + TEMPO CHANGE ─────────────────────────────────────────

@app.post("/api/detect-bpm")
async def detect_bpm(file: UploadFile = File(...)):
    input_path = save_upload(file)
    try:
        from audio_ops import detect_bpm
        bpm = await asyncio.to_thread(detect_bpm, input_path)
        return {"bpm": round(bpm, 2)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if input_path.exists():
            os.remove(input_path)

@app.post("/api/tempo-change")
async def tempo_change(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    factor: float = Form(...),  # e.g. 1.1 = 10% faster, 0.9 = 10% slower
    output_format: str = Form("mp3"),
    target_bpm: Optional[int] = Form(None),
):
    input_path = save_upload(file)
    job_id = str(uuid.uuid4())
    job_status[job_id] = {"status": "processing", "progress": 0}
    background_tasks.add_task(_tempo_change_task, job_id, input_path, factor, output_format, target_bpm)
    return {"job_id": job_id}

async def _tempo_change_task(job_id: str, input_path: Path, factor: float, output_format: str, target_bpm: Optional[int]):
    try:
        from audio_ops import tempo_change
        job_status[job_id]["progress"] = 20
        result = await asyncio.to_thread(tempo_change, input_path, factor, output_format, target_bpm)
        job_status[job_id] = {"status": "done", "progress": 100, "files": result}
    except Exception as e:
        logger.error(f"Tempo change failed: {e}")
        job_status[job_id] = {"status": "error", "message": str(e)}
    finally:
        if input_path.exists():
            os.remove(input_path)

# ── 5. MIX EXPORT ────────────────────────────────────────────────────────────

@app.post("/api/mix-export")
async def mix_export(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    trim_starts: list[float] = Form(...),
    trim_ends:   list[float] = Form(...),
    fade_ins:    list[float] = Form(...),
    fade_outs:   list[float] = Form(...),
    volumes:     list[float] = Form(...),
    time_offsets:list[float] = Form(...),
    output_format: str = Form("mp3"),
):
    paths = [save_upload(f) for f in files]
    job_id = str(uuid.uuid4())
    job_status[job_id] = {"status": "processing", "progress": 0}
    background_tasks.add_task(
        _mix_export_task, job_id, paths,
        trim_starts, trim_ends, fade_ins, fade_outs,
        volumes, time_offsets, output_format
    )
    return {"job_id": job_id}

async def _mix_export_task(job_id, paths, trim_starts, trim_ends,
                            fade_ins, fade_outs, volumes, time_offsets, output_format):
    try:
        from audio_ops import mix_export
        job_status[job_id]["progress"] = 10
        result = await asyncio.to_thread(
            mix_export, paths, trim_starts, trim_ends,
            fade_ins, fade_outs, volumes, time_offsets, output_format
        )
        job_status[job_id] = {"status": "done", "progress": 100, "files": result}
    except Exception as e:
        logger.error(f"Mix export failed: {e}")
        job_status[job_id] = {"status": "error", "message": str(e)}
    finally:
        for p in paths:
            if Path(p).exists():
                os.remove(p)

# ── 6. AUDIO STITCHING (MEDLEY BUILDER) ──────────────────────────────────────

@app.post("/api/stitch")
async def stitch_audio(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    fade_duration: float = Form(2.0),
    crossfade: bool = Form(False),
    silence_duration: float = Form(0.0),
    output_format: str = Form("mp3"),
):
    paths = [save_upload(f) for f in files]
    job_id = str(uuid.uuid4())
    job_status[job_id] = {"status": "processing", "progress": 0}
    background_tasks.add_task(_stitch_task, job_id, paths, fade_duration, crossfade, silence_duration, output_format)
    return {"job_id": job_id}

async def _stitch_task(job_id: str, paths, fade_duration, crossfade, silence_duration, output_format):
    try:
        from audio_ops import stitch_audio
        job_status[job_id]["progress"] = 10
        result = await asyncio.to_thread(stitch_audio, paths, fade_duration, crossfade, output_format, silence_duration)
        job_status[job_id] = {"status": "done", "progress": 100, "files": result}
    except Exception as e:
        logger.error(f"Stitching failed: {e}")
        job_status[job_id] = {"status": "error", "message": str(e)}
    finally:
        for p in paths:
            if Path(p).exists():
                os.remove(p)

# ── 6. TRIM + FADE ───────────────────────────────────────────────────────────

@app.post("/api/trim-fade")
async def trim_fade(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    start_ms: int = Form(0),
    end_ms: Optional[int] = Form(None),
    fade_in_ms: int = Form(0),
    fade_out_ms: int = Form(0),
    output_format: str = Form("mp3"),
):
    input_path = save_upload(file)
    job_id = str(uuid.uuid4())
    job_status[job_id] = {"status": "processing", "progress": 0}
    background_tasks.add_task(
        _trim_fade_task, job_id, input_path, start_ms, end_ms,
        fade_in_ms, fade_out_ms, output_format
    )
    return {"job_id": job_id}

async def _trim_fade_task(job_id, input_path, start_ms, end_ms, fade_in_ms, fade_out_ms, output_format):
    try:
        from audio_ops import trim_fade
        job_status[job_id]["progress"] = 20
        result = await asyncio.to_thread(trim_fade, input_path, start_ms, end_ms, fade_in_ms, fade_out_ms, output_format)
        job_status[job_id] = {"status": "done", "progress": 100, "files": result}
    except Exception as e:
        logger.error(f"Trim/fade failed: {e}")
        job_status[job_id] = {"status": "error", "message": str(e)}
    finally:
        if input_path.exists():
            os.remove(input_path)


# ── MIX EXPORT ───────────────────────────────────────────────────────────────

class TrackExportSpec(BaseModel):
    start_offset_ms: int = 0
    trim_start_ms: int = 0
    trim_end_ms: Optional[int] = None
    fade_in_ms: int = 0
    fade_out_ms: int = 0
    volume: float = 1.0
    muted: bool = False

class MixExportRequest(BaseModel):
    tracks: list[TrackExportSpec]
    output_format: str = "mp3"

_mix_upload_store: dict = {}

@app.post("/api/mix-upload/{slot}")
async def mix_upload(slot: str, file: UploadFile = File(...)):
    """Upload a file and get a server-side path for mix export."""
    path = save_upload(file)
    _mix_upload_store[slot] = path
    return {"slot": slot, "ok": True}

@app.post("/api/export-mix")
async def export_mix_endpoint(
    background_tasks: BackgroundTasks,
    slots: str = Form(...),          # JSON array of slot ids in order
    specs: str = Form(...),          # JSON array of TrackExportSpec dicts
    output_format: str = Form("mp3"),
):
    import json
    slot_list = json.loads(slots)
    spec_list = json.loads(specs)

    tracks = []
    for slot, spec in zip(slot_list, spec_list):
        path = _mix_upload_store.get(slot)
        if not path or not Path(path).exists():
            raise HTTPException(status_code=400, detail=f"Slot {slot} not uploaded")
        tracks.append({
            "path": path,
            "start_offset_ms": spec.get("start_offset_ms", 0),
            "trim_start_ms": spec.get("trim_start_ms", 0),
            "trim_end_ms": spec.get("trim_end_ms", None),
            "fade_in_ms": spec.get("fade_in_ms", 0),
            "fade_out_ms": spec.get("fade_out_ms", 0),
            "volume": spec.get("volume", 1.0),
            "muted": spec.get("muted", False),
        })

    job_id = str(uuid.uuid4())
    job_status[job_id] = {"status": "processing", "progress": 0}
    background_tasks.add_task(_export_mix_task, job_id, tracks, output_format)
    return {"job_id": job_id}

async def _export_mix_task(job_id: str, tracks: list, output_format: str):
    try:
        from audio_ops import export_mix
        job_status[job_id]["progress"] = 20
        result = await asyncio.to_thread(export_mix, tracks, output_format)
        job_status[job_id] = {"status": "done", "progress": 100, "files": result}
    except Exception as e:
        logger.error(f"Mix export failed: {e}")
        job_status[job_id] = {"status": "error", "message": str(e)}

if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.environ.get("SURTAAL_API_HOST", "127.0.0.1"),
        port=int(os.environ.get("SURTAAL_API_PORT", "8000")),
        reload=False,
    )
