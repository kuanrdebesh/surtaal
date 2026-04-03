"""
audio_ops.py — All audio processing logic for Surtaal Phase 1
"""

import os
import re
import sys
import uuid
import subprocess
from pathlib import Path
from typing import Callable, Optional

OUTPUT_DIR = Path("outputs")
OUTPUT_DIR.mkdir(exist_ok=True)

PERCENT_RE = re.compile(r"(\d{1,3})%\|")
BAG_RE = re.compile(r"bag of (\d+) models", re.IGNORECASE)

STEM_ALIAS_MAP = {
    "vocals": "vocals",
    "vocal": "vocals",
    "no vocals": "no_vocals",
    "no_vocals": "no_vocals",
    "instrumental": "no_vocals",
    "backing": "no_vocals",
    "drums": "drums",
    "bass": "bass",
    "other": "other",
    "guitar": "guitar",
    "piano": "piano",
}


def _out(name: str, ext: str) -> Path:
    return OUTPUT_DIR / f"{name}_{uuid.uuid4().hex[:8]}.{ext}"


def _normalize_target_stems(target_stems: Optional[list[str]]) -> list[str]:
    normalized: list[str] = []
    for raw in target_stems or []:
        key = STEM_ALIAS_MAP.get(str(raw or "").strip().lower())
        if key and key not in normalized:
            normalized.append(key)
    return normalized


def _required_stem_family(target_stems: list[str], requested_stems: str) -> str:
    if not target_stems:
        return str(requested_stems or "2")
    if "no_vocals" in target_stems and any(stem not in {"vocals", "no_vocals"} for stem in target_stems):
        raise ValueError("Backing can only be extracted by itself or together with Vocals.")
    if any(stem in {"guitar", "piano"} for stem in target_stems):
        return "6"
    if any(stem in {"drums", "bass", "other"} for stem in target_stems):
        return "4"
    return "2"


def _filter_result_stems(results: list[dict], target_stems: list[str]) -> list[dict]:
    if not target_stems:
        return results

    filtered: list[dict] = []
    allowed = set(target_stems)
    for result in results:
        stem_key = result["label"].strip().lower().replace(" ", "_")
        if stem_key in allowed:
            filtered.append(result)
    return filtered


def _demucs_env() -> dict:
    """
    Make Demucs model downloads more reliable on macOS Python installs by
    passing an explicit CA bundle into the subprocess environment.
    """
    env = os.environ.copy()
    try:
        import certifi
        cafile = certifi.where()
        env.setdefault("SSL_CERT_FILE", cafile)
        env.setdefault("REQUESTS_CA_BUNDLE", cafile)
        env.setdefault("CURL_CA_BUNDLE", cafile)
    except Exception:
        pass
    return env


def _demucs_error(stderr: str) -> str:
    tail = (stderr or "").strip()
    if "CERTIFICATE_VERIFY_FAILED" in tail or "SSL:" in tail:
        return (
            "Demucs could not download its model because macOS/Python SSL "
            "certificate verification failed. Surtaal now passes the certifi "
            "CA bundle automatically, but if this still happens, reactivate "
            "the backend venv and run: "
            "`python -m pip install --upgrade certifi` and then retry. "
            f"Original error: {tail[-500:]}"
        )
    if "Trying to use DiffQ, but diffq is not installed" in tail:
        return (
            "Demucs tried to use a quantized model that needs the optional "
            "`diffq` package. Surtaal has been updated to avoid that model in "
            "Fast mode, so please restart the app and try again. "
            f"Original error: {tail[-500:]}"
        )
    return f"Demucs failed: {tail[-500:]}"


def _run_demucs(
    cmd: list[str],
    *,
    expected_bars: int = 1,
    progress_cb: Optional[Callable[[int], None]] = None,
) -> str:
    """
    Run Demucs and, when possible, translate its real tqdm output into a
    backend progress percentage.
    """
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=_demucs_env(),
    )

    output_parts: list[str] = []
    line_buffer = ""
    total_bars = max(1, expected_bars)
    completed_bars = 0
    last_pct = -1
    emitted_progress = 0

    def handle_progress_text(text: str):
        nonlocal total_bars, completed_bars, last_pct, emitted_progress
        if not text:
            return

        output_parts.append(text)

        bag_match = BAG_RE.search(text)
        if bag_match:
            total_bars = max(1, int(bag_match.group(1)))

        pct_match = PERCENT_RE.search(text)
        if not pct_match or not progress_cb:
            return

        pct = max(0, min(100, int(pct_match.group(1))))

        if pct >= 100 and last_pct < 100:
            completed_bars = min(total_bars, completed_bars + 1)
            effective = completed_bars / total_bars
        else:
            effective = min(1.0, (completed_bars + pct / 100) / total_bars)

        progress = min(99, max(12, int(round(12 + effective * 87))))
        if progress > emitted_progress:
            emitted_progress = progress
            progress_cb(progress)
        last_pct = pct

    assert process.stdout is not None
    while True:
        char = process.stdout.read(1)
        if char == "":
            if process.poll() is not None:
                break
            continue
        if char in ("\r", "\n"):
            handle_progress_text(line_buffer)
            line_buffer = ""
        else:
            line_buffer += char

    if line_buffer:
        handle_progress_text(line_buffer)

    returncode = process.wait()
    combined_output = "\n".join(output_parts)
    if returncode != 0:
        raise RuntimeError(_demucs_error(combined_output))
    return combined_output


def _demucs_profile(stems: str, quality: str) -> tuple[str, list[str], int]:
    """
    Return the Demucs model name and additional CLI args for the requested
    quality/stem count combination.
    """
    quality = (quality or "fast").lower()
    stems = str(stems or "2")

    if stems == "6":
        return "htdemucs_6s", ["--mp3-preset", "2"], 1

    if quality == "best":
        return "htdemucs_ft", ["--mp3-preset", "2"], 4

    # Fast mode should be a true single-model path with more aggressive CPU-
    # friendly settings. Use the lighter MDX model for the common 2-stem
    # karaoke case and keep htdemucs for broader 4-stem separation.
    if stems == "2":
        return "mdx", ["--mp3-preset", "7", "--segment", "8", "--overlap", "0.1", "-j", "2"], 1
    return "htdemucs", ["--mp3-preset", "7", "--segment", "8", "--overlap", "0.1", "-j", "2"], 1


# ── STEM SEPARATION ──────────────────────────────────────────────────────────

def stem_separate(
    input_path: Path,
    stems: str = "2",
    engine: str = "demucs",
    quality: str = "fast",
    target_stems: Optional[list[str]] = None,
    progress_cb: Optional[Callable[[int], None]] = None,
) -> list[dict]:
    out_dir = OUTPUT_DIR / f"stems_{uuid.uuid4().hex[:8]}"
    out_dir.mkdir(exist_ok=True)
    normalized_targets = _normalize_target_stems(target_stems)
    effective_stems = _required_stem_family(normalized_targets, stems)
    model, extra_args, expected_bars = _demucs_profile(effective_stems, quality)
    cmd = [sys.executable, "-m", "demucs", "--out", str(out_dir), "--mp3", "-n", model, *extra_args]
    if len(normalized_targets) == 1:
        target = normalized_targets[0]
        demucs_target = "vocals" if target == "no_vocals" else target
        cmd += ["--two-stems", demucs_target]
    elif effective_stems == "2":
        cmd += ["--two-stems", "vocals"]
    cmd.append(str(input_path))
    _run_demucs(cmd, expected_bars=expected_bars, progress_cb=progress_cb)
    if progress_cb:
        progress_cb(99)
    results = []
    uid = uuid.uuid4().hex[:6]
    for stem_file in sorted(out_dir.rglob("*.mp3")):
        dest_name = f"{stem_file.stem}_{uid}.mp3"
        dest = OUTPUT_DIR / dest_name
        stem_file.rename(dest)
        results.append({"label": stem_file.stem.replace("_", " ").title(), "filename": dest_name})
    results = _filter_result_stems(results, normalized_targets)
    try:
        import shutil
        shutil.rmtree(out_dir, ignore_errors=True)
    except Exception:
        pass
    return results


def vocal_remove(
    input_path: Path,
    quality: str = "fast",
    progress_cb: Optional[Callable[[int], None]] = None,
) -> list[dict]:
    results = stem_separate(input_path, stems="2", engine="demucs", quality=quality, progress_cb=progress_cb)
    no_vocal = [r for r in results if "vocal" not in r["label"].lower()]
    return no_vocal if no_vocal else results


# ── KEY DETECTION ─────────────────────────────────────────────────────────────

def detect_key(input_path: Path) -> dict:
    import librosa
    import numpy as np
    y, sr = librosa.load(str(input_path), sr=None, mono=True, duration=60)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_mean = chroma.mean(axis=1)
    major_profile = np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88])
    minor_profile = np.array([6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17])
    NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
    major_corrs = [np.corrcoef(np.roll(major_profile,i),chroma_mean)[0,1] for i in range(12)]
    minor_corrs = [np.corrcoef(np.roll(minor_profile,i),chroma_mean)[0,1] for i in range(12)]
    best_major = int(np.argmax(major_corrs))
    best_minor = int(np.argmax(minor_corrs))
    if major_corrs[best_major] >= minor_corrs[best_minor]:
        return {"key": NOTE_NAMES[best_major], "mode": "major", "confidence": round(float(major_corrs[best_major]),3)}
    return {"key": NOTE_NAMES[best_minor], "mode": "minor", "confidence": round(float(minor_corrs[best_minor]),3)}


# ── PITCH SHIFT ───────────────────────────────────────────────────────────────

def pitch_shift(input_path: Path, semitones: float, output_format: str = "mp3") -> list[dict]:
    import librosa, soundfile as sf, numpy as np
    y, sr = librosa.load(str(input_path), sr=None, mono=False)
    try:
        import pyrubberband as pyrb
        shifted = pyrb.pitch_shift(y, sr, semitones) if y.ndim==1 else np.array([pyrb.pitch_shift(y[i], sr, semitones) for i in range(y.shape[0])])
    except ImportError:
        if y.ndim > 1: y = librosa.to_mono(y)
        shifted = librosa.effects.pitch_shift(y, sr=sr, n_steps=semitones)
    out_wav = _out("pitch_shifted", "wav")
    sf.write(str(out_wav), shifted.T if shifted.ndim>1 else shifted, sr)
    sign = "+" if semitones >= 0 else ""
    label = f"Pitch shifted ({sign}{semitones} semitones)"
    if output_format == "mp3":
        out_mp3 = _out("pitch_shifted", "mp3")
        _wav_to_mp3(out_wav, out_mp3)
        os.remove(out_wav)
        return [{"label": label, "filename": out_mp3.name}]
    return [{"label": label, "filename": out_wav.name}]


# ── BPM DETECTION ─────────────────────────────────────────────────────────────

def detect_bpm(input_path: Path) -> float:
    import librosa
    y, sr = librosa.load(str(input_path), sr=None, mono=True)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    return float(tempo[0]) if hasattr(tempo, '__len__') else float(tempo)


# ── TEMPO CHANGE ──────────────────────────────────────────────────────────────

def tempo_change(input_path: Path, factor: float, output_format: str = "mp3") -> list[dict]:
    import librosa, soundfile as sf, numpy as np
    y, sr = librosa.load(str(input_path), sr=None, mono=False)
    try:
        import pyrubberband as pyrb
        stretched = pyrb.time_stretch(y, sr, factor) if y.ndim==1 else np.array([pyrb.time_stretch(y[i], sr, factor) for i in range(y.shape[0])])
    except ImportError:
        if y.ndim > 1: y = librosa.to_mono(y)
        stretched = librosa.effects.time_stretch(y, rate=factor)
    out_wav = _out("tempo_changed", "wav")
    sf.write(str(out_wav), stretched.T if stretched.ndim>1 else stretched, sr)
    pct = round((factor-1)*100)
    label = f"Tempo {'+' if pct>=0 else ''}{pct}%"
    if output_format == "mp3":
        out_mp3 = _out("tempo_changed", "mp3")
        _wav_to_mp3(out_wav, out_mp3)
        os.remove(out_wav)
        return [{"label": label, "filename": out_mp3.name}]
    return [{"label": label, "filename": out_wav.name}]


# ── AUDIO STITCH ──────────────────────────────────────────────────────────────

def stitch_audio(input_paths: list, fade_duration: float = 2.0,
                 crossfade: bool = False, output_format: str = "mp3",
                 silence_duration: float = 0.0) -> list[dict]:
    from pydub import AudioSegment
    fade_ms = int(fade_duration * 1000)
    silence_ms = int(silence_duration * 1000)
    segments = [AudioSegment.from_file(str(p)) for p in input_paths]
    if not segments:
        raise ValueError("No audio files provided")
    result = segments[0]
    for seg in segments[1:]:
        if crossfade and fade_ms > 0:
            result = result.append(seg, crossfade=fade_ms)
        elif silence_ms > 0:
            result = result + AudioSegment.silent(duration=silence_ms) + seg
        else:
            if fade_ms > 0:
                result = result.fade_out(fade_ms)
                seg = seg.fade_in(fade_ms)
            result = result + seg
    out = _out("medley", output_format)
    result.export(str(out), format=output_format)
    return [{"label": "Medley", "filename": out.name}]


# ── TRIM + FADE ───────────────────────────────────────────────────────────────

def trim_fade(input_path: Path, start_ms: int = 0, end_ms: Optional[int] = None,
              fade_in_ms: int = 0, fade_out_ms: int = 0,
              output_format: str = "mp3") -> list[dict]:
    from pydub import AudioSegment
    seg = AudioSegment.from_file(str(input_path))
    trimmed = seg[start_ms:end_ms] if end_ms else seg[start_ms:]
    if fade_in_ms > 0: trimmed = trimmed.fade_in(fade_in_ms)
    if fade_out_ms > 0: trimmed = trimmed.fade_out(fade_out_ms)
    out = _out("trimmed", output_format)
    trimmed.export(str(out), format=output_format)
    return [{"label": "Trimmed clip", "filename": out.name}]


# ── MIX EXPORT (multi-track render with offsets, mute, volume) ───────────────

def export_mix(tracks: list[dict], output_format: str = "mp3") -> list[dict]:
    """
    Render multiple tracks into one mixed-down file.
    Each track dict: { path, start_offset_ms, trim_start_ms, trim_end_ms,
                       fade_in_ms, fade_out_ms, volume (0-1), muted }
    Muted tracks are excluded. Volume is applied per track.
    Tracks are placed at their start_offset_ms in the timeline.
    """
    from pydub import AudioSegment

    # Filter out muted tracks
    active = [t for t in tracks if not t.get("muted", False)]
    if not active:
        raise ValueError("All tracks are muted — nothing to export.")

    # Calculate total mix duration
    max_end = 0
    for t in active:
        offset = t.get("start_offset_ms", 0)
        trim_start = t.get("trim_start_ms", 0)
        trim_end = t.get("trim_end_ms", None)
        seg = AudioSegment.from_file(str(t["path"]))
        clip = seg[trim_start:trim_end] if trim_end else seg[trim_start:]
        end = offset + len(clip)
        if end > max_end:
            max_end = end

    # Build mix
    mix = AudioSegment.silent(duration=max_end)
    for t in active:
        seg = AudioSegment.from_file(str(t["path"]))
        trim_start = t.get("trim_start_ms", 0)
        trim_end = t.get("trim_end_ms", None)
        clip = seg[trim_start:trim_end] if trim_end else seg[trim_start:]

        fade_in = t.get("fade_in_ms", 0)
        fade_out = t.get("fade_out_ms", 0)
        if fade_in > 0: clip = clip.fade_in(fade_in)
        if fade_out > 0: clip = clip.fade_out(fade_out)

        vol = t.get("volume", 1.0)
        if vol != 1.0:
            import math
            db = 20 * math.log10(max(vol, 0.001))
            clip = clip + db  # pydub uses dB gain

        offset = t.get("start_offset_ms", 0)
        mix = mix.overlay(clip, position=offset)

    out = _out("mix", output_format)
    mix.export(str(out), format=output_format, bitrate="192k")
    return [{"label": "Mixed track", "filename": out.name}]



# ── MIX EXPORT ────────────────────────────────────────────────────────────────

def mix_export(
    input_paths: list,
    trim_starts:  list,
    trim_ends:    list,
    fade_ins:     list,
    fade_outs:    list,
    volumes:      list,
    time_offsets: list,
    output_format: str = "mp3"
) -> list[dict]:
    """
    Render all tracks into a single mixed-down file.
    Respects per-track trim, fade, volume and timeline offset.
    Mute/solo is already handled by the frontend — only active tracks are passed in.
    """
    from pydub import AudioSegment

    # Find the total canvas duration
    total_ms = 0
    segments = []
    for i, path in enumerate(input_paths):
        seg = AudioSegment.from_file(str(path))
        start_ms = int(trim_starts[i] * 1000)
        end_ms   = int(trim_ends[i]   * 1000)
        clip = seg[start_ms:end_ms]

        fin  = int(fade_ins[i]  * 1000)
        fout = int(fade_outs[i] * 1000)
        if fin  > 0: clip = clip.fade_in(fin)
        if fout > 0: clip = clip.fade_out(fout)

        # Apply volume (pydub uses dB; convert linear -> dB)
        vol = float(volumes[i])
        if vol != 1.0:
            import math
            db = 20 * math.log10(max(vol, 0.0001))
            clip = clip + db  # pydub volume adjust in dB

        offset_ms = int(float(time_offsets[i]) * 1000)
        end_pos   = offset_ms + len(clip)
        total_ms  = max(total_ms, end_pos)
        segments.append((offset_ms, clip))

    if total_ms == 0:
        raise ValueError("No audio to export")

    # Build a silent canvas and overlay each track
    canvas = AudioSegment.silent(duration=total_ms)
    for offset_ms, clip in segments:
        canvas = canvas.overlay(clip, position=offset_ms)

    out = _out("mix", output_format)
    canvas.export(str(out), format=output_format, bitrate="192k")
    return [{"label": "Mixed export", "filename": out.name}]

# ── HELPERS ───────────────────────────────────────────────────────────────────

def _wav_to_mp3(wav_path: Path, mp3_path: Path):
    from pydub import AudioSegment
    AudioSegment.from_wav(str(wav_path)).export(str(mp3_path), format="mp3", bitrate="192k")
