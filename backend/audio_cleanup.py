"""
audio_cleanup.py — focused cleanup/polish tools for uploaded audio
"""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Callable, Optional

from runtime import configure_runtime_environment
from audio_ops import _source_base, _out

configure_runtime_environment()


def _ffmpeg_binary() -> str:
    return os.environ.get("FFMPEG_BINARY") or shutil.which("ffmpeg") or "ffmpeg"


def _pydub_audio_segment():
    from pydub import AudioSegment

    ffmpeg = os.environ.get("FFMPEG_BINARY")
    ffprobe = os.environ.get("FFPROBE_BINARY")
    if ffmpeg:
      AudioSegment.converter = ffmpeg
    if ffprobe:
      AudioSegment.ffprobe = ffprobe
    return AudioSegment


def _cleanup_suffix(
    *,
    remove_noise: bool,
    remove_hum: bool,
    low_cut_hz: int,
    high_cut_hz: int,
    add_eq_lift: bool,
    add_compressor: bool,
    add_limiter: bool,
    add_stereo_widen: bool,
    add_telephone: bool,
    add_tremolo: bool,
    add_phaser: bool,
    add_flanger: bool,
    add_saturation: bool,
    add_reverse_reverb: bool,
    add_reverb: bool,
    add_echo: bool,
    add_chorus: bool,
    normalize: bool,
) -> str:
    parts = ["enhance"]
    if remove_noise:
        parts.append("denoise")
    if remove_hum:
        parts.append("dehum")
    if low_cut_hz > 0:
        parts.append(f"lowcut_{int(low_cut_hz)}")
    if high_cut_hz > 0:
        parts.append(f"highcut_{int(high_cut_hz)}")
    if add_eq_lift:
        parts.append("eq")
    if add_compressor:
        parts.append("comp")
    if add_limiter:
        parts.append("limit")
    if add_stereo_widen:
        parts.append("widen")
    if add_telephone:
        parts.append("telephone")
    if add_tremolo:
        parts.append("tremolo")
    if add_phaser:
        parts.append("phaser")
    if add_flanger:
        parts.append("flanger")
    if add_saturation:
        parts.append("saturation")
    if add_reverse_reverb:
        parts.append("reverse_reverb")
    if add_reverb:
        parts.append("reverb")
    if add_echo:
        parts.append("echo")
    if add_chorus:
        parts.append("chorus")
    if normalize:
        parts.append("norm")
    return "_".join(parts)


def _cleanup_label(
    *,
    remove_noise: bool,
    remove_hum: bool,
    low_cut_hz: int,
    high_cut_hz: int,
    add_eq_lift: bool,
    add_compressor: bool,
    add_limiter: bool,
    add_stereo_widen: bool,
    add_telephone: bool,
    add_tremolo: bool,
    add_phaser: bool,
    add_flanger: bool,
    add_saturation: bool,
    add_reverse_reverb: bool,
    add_reverb: bool,
    add_echo: bool,
    add_chorus: bool,
    normalize: bool,
) -> str:
    tags = []
    if remove_noise:
        tags.append("denoised")
    if remove_hum:
        tags.append("de-hummed")
    if low_cut_hz > 0 or high_cut_hz > 0:
        tags.append("filtered")
    if add_eq_lift:
        tags.append("EQ")
    if add_compressor:
        tags.append("compressed")
    if add_limiter:
        tags.append("limited")
    if add_stereo_widen:
        tags.append("widened")
    if add_telephone:
        tags.append("telephone")
    if add_tremolo:
        tags.append("tremolo")
    if add_phaser:
        tags.append("phaser")
    if add_flanger:
        tags.append("flanger")
    if add_saturation:
        tags.append("saturated")
    if add_reverse_reverb:
        tags.append("reverse reverb")
    if add_reverb:
        tags.append("reverb")
    if add_echo:
        tags.append("echo")
    if add_chorus:
        tags.append("chorus")
    if normalize:
        tags.append("normalized")
    return "Audio enhancement" + (f" ({', '.join(tags)})" if tags else "")


def _build_filters(
    *,
    remove_noise: bool,
    noise_strength: int,
    remove_hum: bool,
    hum_frequency: int,
    low_cut_hz: int,
    high_cut_hz: int,
    remove_frequency_band: bool,
    band_low_hz: int,
    band_high_hz: int,
    band_strength: int,
    add_eq_lift: bool,
    eq_amount: int,
    add_compressor: bool,
    compressor_amount: int,
    add_limiter: bool,
    limiter_ceiling_db: float,
    add_stereo_widen: bool,
    stereo_widen_amount: int,
    add_telephone: bool,
    telephone_amount: int,
    add_tremolo: bool,
    tremolo_rate_hz: float,
    tremolo_depth: int,
    add_phaser: bool,
    phaser_rate_hz: float,
    phaser_depth: int,
    add_flanger: bool,
    flanger_depth: int,
    flanger_speed_hz: float,
    add_saturation: bool,
    saturation_amount: int,
    add_reverse_reverb: bool,
    reverse_reverb_amount: int,
    add_reverb: bool,
    reverb_amount: int,
    add_echo: bool,
    echo_delay_ms: int,
    echo_feedback: int,
    add_chorus: bool,
    chorus_depth: int,
    normalize: bool,
) -> str:
    filters: list[str] = []

    if low_cut_hz > 0:
        filters.append(f"highpass=f={int(low_cut_hz)}")

    if high_cut_hz > 0:
        filters.append(f"lowpass=f={int(high_cut_hz)}")

    if remove_frequency_band and band_high_hz > band_low_hz > 0:
        center = (int(band_low_hz) + int(band_high_hz)) / 2
        width = max(20, int(band_high_hz) - int(band_low_hz))
        strength = max(1, min(100, int(band_strength)))
        gain = round(-3 - (strength / 100) * 21, 1)
        filters.append(
            f"equalizer=f={center}:width_type=h:width={width}:g={gain}"
        )

    if remove_hum:
        base = max(40, min(1000, int(hum_frequency)))
        gains = [-18, -12, -8]
        for idx, gain in enumerate(gains, start=1):
            filters.append(
                f"equalizer=f={base * idx}:width_type=h:width=30:g={gain}"
            )

    if remove_noise:
        clamped_strength = max(0, min(100, int(noise_strength)))
        nr = round(6 + (clamped_strength / 100) * 24, 1)
        filters.append(f"afftdn=nr={nr}:nf=-28")

    if add_eq_lift:
        amount = max(0, min(100, int(eq_amount)))
        presence = round(1.5 + (amount / 100) * 7.5, 1)
        air = round(0.8 + (amount / 100) * 5.2, 1)
        body_cut = round(-0.8 - (amount / 100) * 2.7, 1)
        filters.extend([
            f"equalizer=f=240:width_type=h:width=180:g={body_cut}",
            f"equalizer=f=3200:width_type=h:width=2200:g={presence}",
            f"equalizer=f=9800:width_type=h:width=4500:g={air}",
        ])

    if add_compressor:
        amount = max(0, min(100, int(compressor_amount)))
        threshold = round(0.14 + ((100 - amount) / 100) * 0.34, 3)
        ratio = round(1.8 + (amount / 100) * 4.2, 2)
        makeup = round(1.0 + (amount / 100) * 2.8, 2)
        filters.append(
            f"acompressor=threshold={threshold}:ratio={ratio}:attack=18:release=170:makeup={makeup}:knee=2.5"
        )

    if add_limiter:
        ceiling = max(-8.0, min(-0.3, float(limiter_ceiling_db)))
        linear = round(10 ** (ceiling / 20), 4)
        filters.append(f"alimiter=limit={linear}:level=disabled")

    if add_stereo_widen:
        amount = max(0, min(100, int(stereo_widen_amount)))
        widen = round(1.0 + (amount / 100) * 2.2, 2)
        filters.append(f"extrastereo=m={widen}")

    if add_telephone:
        amount = max(0, min(100, int(telephone_amount)))
        highpass_hz = 260 + int(amount * 2.2)
        lowpass_hz = 2800 + int(amount * 18)
        presence = round(3.0 + (amount / 100) * 7.0, 1)
        drive = round(0.2 + (amount / 100) * 0.55, 2)
        filters.extend([
            f"highpass=f={highpass_hz}",
            f"lowpass=f={lowpass_hz}",
            f"equalizer=f=1800:width_type=h:width=1800:g={presence}",
            f"acrusher=bits=10:mode=log:aa=1",
            f"volume={drive + 0.75}",
        ])

    if add_tremolo:
        rate = max(0.2, min(18.0, float(tremolo_rate_hz)))
        depth = round(0.15 + (max(0, min(100, int(tremolo_depth))) / 100) * 0.8, 2)
        filters.append(f"tremolo=f={rate}:d={depth}")

    if add_phaser:
        rate = max(0.1, min(2.0, float(phaser_rate_hz)))
        depth = max(0, min(100, int(phaser_depth)))
        delay = round(1.2 + (depth / 100) * 2.6, 2)
        decay = round(0.25 + (depth / 100) * 0.45, 2)
        out_gain = round(0.7 + (depth / 100) * 0.18, 2)
        filters.append(
            f"aphaser=in_gain=0.45:out_gain={out_gain}:delay={delay}:decay={decay}:speed={rate}:type=s"
        )

    if add_flanger:
        depth = max(0, min(100, int(flanger_depth)))
        speed = max(0.1, min(8.0, float(flanger_speed_hz)))
        sweep = round(0.6 + (depth / 100) * 4.6, 2)
        regen = round(-8 + (depth / 100) * 32, 1)
        width = round(35 + (depth / 100) * 45, 1)
        filters.append(
            f"flanger=delay=1.2:depth={sweep}:regen={regen}:width={width}:speed={speed}:shape=s:phase=35"
        )

    if add_saturation:
        amount = max(0, min(100, int(saturation_amount)))
        threshold = round(0.96 - (amount / 100) * 0.38, 3)
        output = round(0.92 + (amount / 100) * 0.32, 2)
        drive = round(1.0 + (amount / 100) * 1.1, 2)
        filters.extend([
            f"asoftclip=type=tanh:threshold={threshold}:output={output}:param={drive}:oversample=2",
            "equalizer=f=220:width_type=h:width=220:g=1.2",
            "equalizer=f=7800:width_type=h:width=4200:g=0.9",
        ])

    if add_reverse_reverb:
        amount = max(0, min(100, int(reverse_reverb_amount)))
        primary = round(0.16 + (amount / 100) * 0.36, 2)
        secondary = round(max(0.1, primary - 0.08), 2)
        tertiary = round(max(0.06, secondary - 0.05), 2)
        filters.append(
            f"areverse,aecho=0.82:0.88:70|140|210:{primary}|{secondary}|{tertiary},lowpass=f=7200,areverse"
        )

    if add_reverb:
        amount = max(0, min(100, int(reverb_amount)))
        primary = round(0.18 + (amount / 100) * 0.34, 2)
        secondary = round(max(0.12, primary - 0.07), 2)
        tertiary = round(max(0.08, secondary - 0.05), 2)
        filters.append(
            f"aecho=0.85:0.88:55|95|155:{primary}|{secondary}|{tertiary}"
        )

    if add_echo:
        delay = max(60, min(1400, int(echo_delay_ms)))
        feedback = round(0.12 + (max(0, min(100, int(echo_feedback))) / 100) * 0.48, 2)
        filters.append(f"aecho=0.82:0.88:{delay}:{feedback}")

    if add_chorus:
        depth = max(0, min(100, int(chorus_depth)))
        decays = f"{0.22 + depth / 480:.2f}|{0.28 + depth / 380:.2f}"
        speeds = f"{0.25 + depth / 170:.2f}|{0.34 + depth / 135:.2f}"
        depths = f"{6 + depth / 12:.1f}|{7 + depth / 10:.1f}"
        filters.append(f"chorus=0.55:0.88:34|46:{decays}:{speeds}:{depths}")

    if normalize:
        filters.append("loudnorm=I=-16:TP=-1.5:LRA=11")

    return ",".join(filters)


def cleanup_audio(
    input_path: Path,
    *,
    remove_noise: bool = True,
    noise_strength: int = 40,
    remove_hum: bool = False,
    hum_frequency: int = 50,
    low_cut_hz: int = 0,
    high_cut_hz: int = 0,
    remove_frequency_band: bool = False,
    band_low_hz: int = 0,
    band_high_hz: int = 0,
    band_strength: int = 50,
    add_eq_lift: bool = False,
    eq_amount: int = 45,
    add_compressor: bool = False,
    compressor_amount: int = 50,
    add_limiter: bool = False,
    limiter_ceiling_db: float = -1.2,
    add_stereo_widen: bool = False,
    stereo_widen_amount: int = 42,
    add_telephone: bool = False,
    telephone_amount: int = 45,
    add_tremolo: bool = False,
    tremolo_rate_hz: float = 4.5,
    tremolo_depth: int = 48,
    add_phaser: bool = False,
    phaser_rate_hz: float = 0.55,
    phaser_depth: int = 45,
    add_flanger: bool = False,
    flanger_depth: int = 42,
    flanger_speed_hz: float = 0.45,
    add_saturation: bool = False,
    saturation_amount: int = 36,
    add_reverse_reverb: bool = False,
    reverse_reverb_amount: int = 44,
    add_reverb: bool = False,
    reverb_amount: int = 35,
    add_echo: bool = False,
    echo_delay_ms: int = 220,
    echo_feedback: int = 28,
    add_chorus: bool = False,
    chorus_depth: int = 38,
    normalize: bool = True,
    selected_start_ms: int = 0,
    selected_end_ms: Optional[int] = None,
    output_format: str = "mp3",
    progress_cb: Optional[Callable[[int], None]] = None,
) -> list[dict]:
    filters = _build_filters(
        remove_noise=remove_noise,
        noise_strength=noise_strength,
        remove_hum=remove_hum,
        hum_frequency=hum_frequency,
        low_cut_hz=low_cut_hz,
        high_cut_hz=high_cut_hz,
        remove_frequency_band=remove_frequency_band,
        band_low_hz=band_low_hz,
        band_high_hz=band_high_hz,
        band_strength=band_strength,
        add_eq_lift=add_eq_lift,
        eq_amount=eq_amount,
        add_compressor=add_compressor,
        compressor_amount=compressor_amount,
        add_limiter=add_limiter,
        limiter_ceiling_db=limiter_ceiling_db,
        add_stereo_widen=add_stereo_widen,
        stereo_widen_amount=stereo_widen_amount,
        add_telephone=add_telephone,
        telephone_amount=telephone_amount,
        add_tremolo=add_tremolo,
        tremolo_rate_hz=tremolo_rate_hz,
        tremolo_depth=tremolo_depth,
        add_phaser=add_phaser,
        phaser_rate_hz=phaser_rate_hz,
        phaser_depth=phaser_depth,
        add_flanger=add_flanger,
        flanger_depth=flanger_depth,
        flanger_speed_hz=flanger_speed_hz,
        add_saturation=add_saturation,
        saturation_amount=saturation_amount,
        add_reverse_reverb=add_reverse_reverb,
        reverse_reverb_amount=reverse_reverb_amount,
        add_reverb=add_reverb,
        reverb_amount=reverb_amount,
        add_echo=add_echo,
        echo_delay_ms=echo_delay_ms,
        echo_feedback=echo_feedback,
        add_chorus=add_chorus,
        chorus_depth=chorus_depth,
        normalize=normalize,
    )
    if not filters:
        raise ValueError("Enable at least one enhancement or effect option before processing.")

    source_base = _source_base(input_path)
    suffix = _cleanup_suffix(
        remove_noise=remove_noise,
        remove_hum=remove_hum,
        low_cut_hz=low_cut_hz,
        high_cut_hz=high_cut_hz,
        add_eq_lift=add_eq_lift,
        add_compressor=add_compressor,
        add_limiter=add_limiter,
        add_stereo_widen=add_stereo_widen,
        add_telephone=add_telephone,
        add_tremolo=add_tremolo,
        add_phaser=add_phaser,
        add_flanger=add_flanger,
        add_saturation=add_saturation,
        add_reverse_reverb=add_reverse_reverb,
        add_reverb=add_reverb,
        add_echo=add_echo,
        add_chorus=add_chorus,
        normalize=normalize,
    )
    final_output = _out(source_base, suffix, output_format)

    ffmpeg = _ffmpeg_binary()
    AudioSegment = _pydub_audio_segment()
    with tempfile.TemporaryDirectory(prefix="surtaal_enhance_") as temp_dir:
        full_audio = AudioSegment.from_file(str(input_path))
        total_ms = len(full_audio)
        start_ms = max(0, int(selected_start_ms or 0))
        end_ms = int(selected_end_ms) if selected_end_ms is not None else total_ms
        end_ms = max(start_ms, min(total_ms, end_ms))

        target_segment = full_audio[start_ms:end_ms]
        if len(target_segment) == 0:
            raise ValueError("Select a non-empty region before processing.")

        before = full_audio[:start_ms]
        after = full_audio[end_ms:]

        temp_input = Path(temp_dir) / "target.wav"
        temp_cleaned = Path(temp_dir) / "cleaned.wav"
        temp_output = Path(temp_dir) / f"enhancement.{output_format}"
        target_segment.export(str(temp_input), format="wav")
        cmd = [
            ffmpeg,
            "-y",
            "-i", str(temp_input),
            "-af",
            filters,
        ]
        cmd.append(str(temp_cleaned))

        if progress_cb:
            progress_cb(18)

        process = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        if process.returncode != 0:
            tail = (process.stderr or process.stdout or "").strip()[-800:]
            raise RuntimeError(f"Audio enhancement failed: {tail}")

        if progress_cb:
            progress_cb(74)

        cleaned_segment = AudioSegment.from_file(str(temp_cleaned))
        result_audio = before + cleaned_segment + after
        export_kwargs = {"format": output_format}
        if output_format == "mp3":
            export_kwargs["bitrate"] = "192k"
        result_audio.export(str(temp_output), **export_kwargs)
        if progress_cb:
            progress_cb(96)
        temp_output.replace(final_output)

    return [{
        "label": _cleanup_label(
            remove_noise=remove_noise,
            remove_hum=remove_hum,
            low_cut_hz=low_cut_hz,
            high_cut_hz=high_cut_hz,
            add_eq_lift=add_eq_lift,
            add_compressor=add_compressor,
            add_limiter=add_limiter,
            add_stereo_widen=add_stereo_widen,
            add_telephone=add_telephone,
            add_tremolo=add_tremolo,
            add_phaser=add_phaser,
            add_flanger=add_flanger,
            add_saturation=add_saturation,
            add_reverse_reverb=add_reverse_reverb,
            add_reverb=add_reverb,
            add_echo=add_echo,
            add_chorus=add_chorus,
            normalize=normalize,
        ),
        "filename": final_output.name,
    }]
