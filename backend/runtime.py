import os
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parent


def _dir_from_env(env_name: str, default_name: str) -> Path:
    raw = os.environ.get(env_name)
    if raw:
      path = Path(raw).expanduser().resolve()
    else:
      path = (BACKEND_ROOT / default_name).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


UPLOAD_DIR = _dir_from_env("SURTAAL_UPLOAD_DIR", "uploads")
OUTPUT_DIR = _dir_from_env("SURTAAL_OUTPUT_DIR", "outputs")
MODEL_DIR = _dir_from_env("SURTAAL_MODEL_DIR", "models")
BIN_DIR = _dir_from_env("SURTAAL_BIN_DIR", "bin")


def _existing_binary(*relative_names: str) -> str | None:
    for name in relative_names:
        candidate = BIN_DIR / name
        if candidate.exists():
            return str(candidate)
    return None


def configure_runtime_environment() -> None:
    bin_dir = str(BIN_DIR)
    path_parts = os.environ.get("PATH", "").split(os.pathsep) if os.environ.get("PATH") else []
    if bin_dir and bin_dir not in path_parts:
        os.environ["PATH"] = os.pathsep.join([bin_dir, *path_parts]) if path_parts else bin_dir

    ffmpeg = (
        os.environ.get("SURTAAL_FFMPEG")
        or _existing_binary("ffmpeg.exe", "ffmpeg")
    )
    ffprobe = (
        os.environ.get("SURTAAL_FFPROBE")
        or _existing_binary("ffprobe.exe", "ffprobe")
    )
    rubberband = (
        os.environ.get("SURTAAL_RUBBERBAND")
        or _existing_binary("rubberband.exe", "rubberband")
    )

    if ffmpeg:
        os.environ.setdefault("FFMPEG_BINARY", ffmpeg)
    if ffprobe:
        os.environ.setdefault("FFPROBE_BINARY", ffprobe)
    if rubberband:
        os.environ.setdefault("RUBBERBAND", rubberband)

    os.environ.setdefault("TORCH_HOME", str(MODEL_DIR))
    os.environ.setdefault("XDG_CACHE_HOME", str(MODEL_DIR))
