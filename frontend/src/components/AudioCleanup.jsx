import { useEffect, useMemo, useRef, useState } from "react";
import { FormatPicker, JobStatus, LibraryPickerButton, SaveToLibraryButton } from "./Shared";
import { useJob } from "../useJob";
import { buildWaveData, drawWave } from "./waveform";
import { API_BASE } from "../config";

const PRESETS = {
  singing: {
    label: "Clean Singing",
    removeNoise: true,
    noiseStrength: 42,
    removeHum: true,
    humFrequency: 50,
    lowCutHz: 80,
    highCutHz: 15000,
    normalize: true,
  },
  backing: {
    label: "Clean Backing",
    removeNoise: true,
    noiseStrength: 30,
    removeHum: false,
    humFrequency: 50,
    lowCutHz: 45,
    highCutHz: 16000,
    normalize: true,
  },
  hum: {
    label: "Reduce Hum",
    removeNoise: false,
    noiseStrength: 20,
    removeHum: true,
    humFrequency: 50,
    lowCutHz: 65,
    highCutHz: 0,
    normalize: false,
  },
};

const EFFECT_PRESETS = {
  space: {
    label: "Vocal Space",
    effect: "reverb",
    addReverb: true,
    reverbAmount: 46,
    addEcho: false,
    echoDelayMs: 220,
    echoFeedback: 28,
    addChorus: true,
    chorusDepth: 34,
    addStereoWiden: false,
    stereoWidenAmount: 42,
  },
  echo: {
    label: "Dream Echo",
    effect: "echo",
    addReverb: false,
    reverbAmount: 32,
    addEcho: true,
    echoDelayMs: 280,
    echoFeedback: 42,
    addChorus: false,
    chorusDepth: 30,
    addStereoWiden: false,
    stereoWidenAmount: 42,
  },
  widen: {
    label: "Light Width",
    effect: "widen",
    addReverb: false,
    reverbAmount: 28,
    addEcho: false,
    echoDelayMs: 180,
    echoFeedback: 20,
    addChorus: false,
    chorusDepth: 38,
    addStereoWiden: true,
    stereoWidenAmount: 52,
  },
};

const EFFECT_OPTIONS = [
  {
    label: "Polish",
    items: [
      { value: "eq", label: "EQ Lift", enabled: true },
      { value: "compressor", label: "Compressor", enabled: true },
      { value: "limiter", label: "Limiter", enabled: true },
      { value: "deesser", label: "De-esser", enabled: false },
      { value: "widen", label: "Stereo Widen", enabled: true },
    ],
  },
  {
    label: "Space",
    items: [
      { value: "reverb", label: "Reverb", enabled: true },
      { value: "echo", label: "Echo / Delay", enabled: true },
      { value: "chorus", label: "Chorus / Width", enabled: true },
    ],
  },
  {
    label: "Creative",
    items: [
      { value: "telephone", label: "Telephone / Radio", enabled: true },
      { value: "tremolo", label: "Tremolo", enabled: true },
      { value: "phaser", label: "Phaser", enabled: true },
      { value: "flanger", label: "Flanger", enabled: true },
      { value: "saturation", label: "Warm Saturation", enabled: true },
      { value: "reverse-reverb", label: "Reverse Reverb", enabled: true },
    ],
  },
];

const FREQ_MIN = 20;
const FREQ_MAX = 18000;

function fmtSeconds(value) {
  if (!Number.isFinite(value)) return "0:00.0";
  const mins = Math.floor(value / 60);
  const secs = (value % 60).toFixed(1).padStart(4, "0");
  return `${mins}:${secs}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hzToRatio(hz) {
  const logMin = Math.log(FREQ_MIN);
  const logMax = Math.log(FREQ_MAX);
  const safeHz = clamp(hz, FREQ_MIN, FREQ_MAX);
  return (Math.log(safeHz) - logMin) / (logMax - logMin);
}

function ratioToHz(ratio) {
  const logMin = Math.log(FREQ_MIN);
  const logMax = Math.log(FREQ_MAX);
  return Math.round(Math.exp(logMin + clamp(ratio, 0, 1) * (logMax - logMin)));
}

function OptionCard({ title, hint, children }) {
  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: 14,
      background: "var(--bg2)",
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{title}</div>
      {hint && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>{hint}</div>}
      {children}
    </div>
  );
}

function ToggleRow({ checked, onChange, title, hint }) {
  return (
    <label style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: "var(--accent)" }}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{hint}</div>
      </div>
    </label>
  );
}

function RangeField({ label, value, onChange, min, max, step = 0.1 }) {
  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      <div className="range-row">
        <input
          type="range"
          min={min}
          max={Math.max(min, max)}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="range-value">{fmtSeconds(value)}</span>
      </div>
    </div>
  );
}

function buildSpectrogramData(samples, sampleRate, duration) {
  if (!samples || !samples.length || !sampleRate || !duration) return null;

  const maxFreq = Math.min(16000, sampleRate / 2);
  const bins = 72;
  const logMin = Math.log(40);
  const logMax = Math.log(Math.max(60, maxFreq));
  const baseWindow = Math.min(
    1024,
    Math.max(256, 2 ** Math.floor(Math.log2(Math.max(256, samples.length / 150))))
  );
  const windowSize = Math.min(samples.length, baseWindow);
  const maxFrames = Math.max(80, Math.min(220, Math.floor(duration * 18)));
  const frameCount = Math.max(1, Math.min(maxFrames, Math.floor((samples.length - windowSize) / Math.max(1, windowSize / 4)) + 1));
  const hop = frameCount > 1 ? Math.max(1, Math.floor((samples.length - windowSize) / (frameCount - 1))) : 1;
  const hann = new Float32Array(windowSize);
  for (let i = 0; i < windowSize; i += 1) {
    hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, windowSize - 1));
  }

  const frequencies = Array.from({ length: bins }, (_, index) => (
    Math.exp(logMin + (index / Math.max(1, bins - 1)) * (logMax - logMin))
  ));
  const coeffs = frequencies.map((freq) => 2 * Math.cos((2 * Math.PI * freq) / sampleRate));

  const values = Array.from({ length: frameCount }, () => new Float32Array(bins));
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = Math.min(samples.length - windowSize, frame * hop);
    for (let bin = 0; bin < bins; bin += 1) {
      const coeff = coeffs[bin];
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < windowSize; i += 1) {
        s0 = samples[start + i] * hann[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
      const value = Math.log10(power + 1e-12);
      values[frame][bin] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }

  const span = Math.max(1e-6, max - min);
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let bin = 0; bin < bins; bin += 1) {
      values[frame][bin] = (values[frame][bin] - min) / span;
    }
  }

  return { values, frequencies, frameCount, bins, duration };
}

function useSpectrumData(samples, sampleRate, duration, enabled) {
  const [state, setState] = useState({ data: null, loading: false });

  useEffect(() => {
    let cancelled = false;
    if (!enabled || !samples || !sampleRate || !duration) {
      setState({ data: null, loading: false });
      return undefined;
    }

    setState((prev) => ({ data: prev.data, loading: true }));
    const timer = window.setTimeout(() => {
      try {
        const data = buildSpectrogramData(samples, sampleRate, duration);
        if (!cancelled) setState({ data, loading: false });
      } catch (error) {
        console.error("Could not build spectrogram", error);
        if (!cancelled) setState({ data: null, loading: false });
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, samples, sampleRate, duration]);

  return state;
}

function useWaveAsset(source) {
  const [audioUrl, setAudioUrl] = useState(null);
  const [waveData, setWaveData] = useState(null);
  const [duration, setDuration] = useState(0);
  const [label, setLabel] = useState("");
  const [samples, setSamples] = useState(null);
  const [sampleRate, setSampleRate] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let cleanupUrl = null;

    const reset = () => {
      setAudioUrl(null);
      setWaveData(null);
      setDuration(0);
      setLabel("");
      setSamples(null);
      setSampleRate(0);
    };

    if (!source) {
      reset();
      return undefined;
    }

    const load = async () => {
      try {
        let objectUrl = null;
        let arrayBuffer = null;
        let nextLabel = "";

        if (source.kind === "file") {
          objectUrl = URL.createObjectURL(source.file);
          cleanupUrl = objectUrl;
          arrayBuffer = await source.file.arrayBuffer();
          nextLabel = source.file.name;
        } else {
          const response = await fetch(source.url);
          if (!response.ok) throw new Error(`Could not load ${source.url}`);
          const blob = await response.blob();
          objectUrl = URL.createObjectURL(blob);
          cleanupUrl = objectUrl;
          arrayBuffer = await blob.arrayBuffer();
          nextLabel = source.label || source.url.split("/").pop() || "output";
        }

        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
        await audioCtx.close();

        const mono = new Float32Array(decoded.length);
        for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
          const channelData = decoded.getChannelData(channel);
          for (let i = 0; i < decoded.length; i += 1) {
            mono[i] += channelData[i] / decoded.numberOfChannels;
          }
        }

        if (cancelled) return;
        setAudioUrl(objectUrl);
        setWaveData(buildWaveData(decoded, 1800));
        setDuration(decoded.duration || 0);
        setLabel(nextLabel);
        setSamples(mono);
        setSampleRate(decoded.sampleRate || 0);
      } catch (error) {
        console.error("Could not prepare waveform asset", error);
        if (!cancelled) reset();
      }
    };

    load();

    return () => {
      cancelled = true;
      if (cleanupUrl) URL.revokeObjectURL(cleanupUrl);
    };
  }, [source]);

  return { audioUrl, waveData, duration, label, samples, sampleRate };
}

function InputAnalysisPanel({
  audioUrl,
  waveData,
  duration,
  selection,
  setSelection,
  playhead,
  setPlayhead,
  audioRef,
  accentColor,
  spectrumData,
  spectrumLoading,
  viewMode,
  setViewMode,
  spectrumZoom,
  setSpectrumZoom,
  removeFrequencyBand,
  bandLowHz,
  bandHighHz,
  setBandLowHz,
  setBandHighHz,
}) {
  const canvasRef = useRef(null);
  const spectrumCanvasRef = useRef(null);
  const spectrumViewportRef = useRef(null);
  const dragRef = useRef(null);
  const bandDragRef = useRef(null);

  const seekAudio = (time) => {
    const clamped = Math.max(0, Math.min(duration || 0, time));
    if (audioRef.current) {
      audioRef.current.currentTime = clamped;
      if (!audioRef.current.paused) {
        audioRef.current.play().catch(() => {});
      }
    }
    setPlayhead(clamped);
  };

  const waveformTime = (clientX) => {
    const canvas = canvasRef.current;
    if (!canvas || !duration) return 0;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  const spectrumTime = (clientX) => {
    const canvas = spectrumCanvasRef.current;
    if (!canvas || !duration) return 0;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  const spectrumHz = (clientY) => {
    const canvas = spectrumCanvasRef.current;
    if (!canvas) return bandLowHz;
    const rect = canvas.getBoundingClientRect();
    const ratio = 1 - Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return ratioToHz(ratio);
  };

  const renderWave = () => {
    const canvas = canvasRef.current;
    if (!canvas || !waveData || !duration) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    drawWave(canvas, waveData, {
      trimStart: 0,
      trimEnd: duration,
      selStart: selection?.start ?? null,
      selEnd: selection?.end ?? null,
      startOffset: 0,
      playhead,
      zoom: width / Math.max(duration, 0.001),
      scrollLeft: 0,
      color: accentColor,
      taal: null,
      bpm: 0,
      TAALS: null,
    });
  };

  const renderSpectrum = () => {
    const canvas = spectrumCanvasRef.current;
    if (!canvas || !spectrumData || !duration) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);

    const { values, frameCount, bins } = spectrumData;
    const cellW = width / Math.max(1, frameCount);
    const cellH = height / Math.max(1, bins);

    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let bin = 0; bin < bins; bin += 1) {
        const value = values[frame][bin];
        const hue = 260 - value * 210;
        const lightness = 10 + value * 62;
        ctx.fillStyle = `hsl(${hue} 70% ${lightness}%)`;
        ctx.fillRect(frame * cellW, height - (bin + 1) * cellH, cellW + 1, cellH + 1);
      }
    }

    const selectionStartX = (selection.start / Math.max(duration, 0.001)) * width;
    const selectionEndX = (selection.end / Math.max(duration, 0.001)) * width;
    ctx.fillStyle = "rgba(8, 10, 18, 0.42)";
    ctx.fillRect(0, 0, selectionStartX, height);
    ctx.fillRect(selectionEndX, 0, width - selectionEndX, height);

    if (removeFrequencyBand && bandHighHz > bandLowHz) {
      const top = (1 - hzToRatio(bandHighHz)) * height;
      const bottom = (1 - hzToRatio(bandLowHz)) * height;
      ctx.fillStyle = "rgba(201,125,58,0.18)";
      ctx.fillRect(selectionStartX, top, Math.max(2, selectionEndX - selectionStartX), Math.max(2, bottom - top));
      ctx.strokeStyle = "rgba(201,125,58,0.75)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeRect(selectionStartX, top, Math.max(2, selectionEndX - selectionStartX), Math.max(2, bottom - top));
    }

    const playX = (playhead / Math.max(duration, 0.001)) * width;
    ctx.strokeStyle = "#f6e8d8";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(playX, 0);
    ctx.lineTo(playX, height);
    ctx.stroke();
  };

  useEffect(() => {
    renderWave();
  }, [waveData, duration, selection, playhead, accentColor]);

  useEffect(() => {
    renderSpectrum();
  }, [spectrumData, duration, selection, playhead, removeFrequencyBand, bandLowHz, bandHighHz]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (viewMode === "waveform") renderWave();
      if (viewMode === "spectrum") renderSpectrum();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [viewMode, spectrumZoom]);

  useEffect(() => {
    const onResize = () => {
      renderWave();
      renderSpectrum();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  useEffect(() => {
    const onMove = (event) => {
      if (bandDragRef.current) {
        const nextHz = spectrumHz(event.clientY);
        if (bandDragRef.current === "low") setBandLowHz(Math.min(nextHz, bandHighHz - 10));
        if (bandDragRef.current === "high") setBandHighHz(Math.max(nextHz, bandLowHz + 10));
        return;
      }
      if (!dragRef.current || !setSelection) return;
      const delta = Math.abs(event.clientX - dragRef.current.startX);
      if (delta > 4) dragRef.current.draggingSelection = true;
      if (!dragRef.current.draggingSelection) return;
      const time = waveformTime(event.clientX);
      const start = Math.max(0, Math.min(dragRef.current.anchorTime, time));
      const end = Math.min(duration, Math.max(dragRef.current.anchorTime, time));
      setSelection({ start, end });
    };

    const onUp = (event) => {
      if (bandDragRef.current) {
        bandDragRef.current = null;
        return;
      }
      if (!dragRef.current) return;
      const time = waveformTime(event.clientX);
      if (dragRef.current.draggingSelection && setSelection) {
        const start = Math.max(0, Math.min(dragRef.current.anchorTime, time));
        const end = Math.min(duration, Math.max(dragRef.current.anchorTime, time));
        setSelection({ start, end });
      } else {
        seekAudio(time);
      }
      dragRef.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [bandHighHz, bandLowHz, duration, setBandHighHz, setBandLowHz, setSelection]);

  const startWaveSelection = (event) => {
    if (!duration) return;
    const time = waveformTime(event.clientX);
    dragRef.current = {
      startX: event.clientX,
      anchorTime: time,
      draggingSelection: false,
    };
    setSelection((prev) => prev || { start: 0, end: duration });
  };

  const startBandDrag = (event, handle) => {
    if (!removeFrequencyBand) return;
    event.preventDefault();
    event.stopPropagation();
    bandDragRef.current = handle;
    const nextHz = spectrumHz(event.clientY);
    if (handle === "low") setBandLowHz(Math.min(nextHz, bandHighHz - 10));
    if (handle === "high") setBandHighHz(Math.max(nextHz, bandLowHz + 10));
  };

  const spectrumHeight = Math.round(180 * spectrumZoom);
  const lowTop = `${(1 - hzToRatio(bandLowHz)) * 100}%`;
  const highTop = `${(1 - hzToRatio(bandHighHz)) * 100}%`;

  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: 18,
      background: "var(--surface-glass)",
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 12,
      boxShadow: "var(--shadow-lg)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
          Input
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {["waveform", "spectrum"].map((mode) => (
              <button
                key={mode}
                type="button"
                className="btn-ghost"
                onClick={() => setViewMode(mode)}
                style={{
                  padding: "5px 10px",
                  fontSize: 11,
                  borderColor: viewMode === mode ? "var(--accent)" : undefined,
                  color: viewMode === mode ? "var(--accent)" : undefined,
                }}
              >
                {mode === "waveform" ? "Waveform" : "Spectrum"}
              </button>
            ))}
          </div>
          {viewMode === "spectrum" && (
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn-ghost" onClick={() => setSpectrumZoom((prev) => Math.max(1, Number((prev - 0.5).toFixed(1))))} style={{ padding: "5px 10px", fontSize: 11 }}>
                -
              </button>
              <button type="button" className="btn-ghost" onClick={() => setSpectrumZoom((prev) => Math.min(4, Number((prev + 0.5).toFixed(1))))} style={{ padding: "5px 10px", fontSize: 11 }}>
                +
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setSpectrumZoom(1);
                  if (spectrumViewportRef.current) spectrumViewportRef.current.scrollTop = 0;
                }}
                style={{ padding: "5px 10px", fontSize: 11 }}
              >
                Reset
              </button>
            </div>
          )}
        </div>
      </div>

      {audioUrl ? (
        <>
          {viewMode === "waveform" ? (
            <div style={{
              border: "1px solid var(--border)",
              borderRadius: 14,
              overflow: "hidden",
              background: "var(--bg2)",
            }}>
              <canvas
                ref={canvasRef}
                onPointerDown={startWaveSelection}
                style={{
                  display: "block",
                  width: "100%",
                  height: 180,
                  cursor: duration ? "crosshair" : "default",
                }}
              />
            </div>
          ) : (
            <div style={{
              border: "1px solid var(--border)",
              borderRadius: 14,
              background: "var(--bg2)",
              overflow: "hidden",
            }}>
              <div
                ref={spectrumViewportRef}
                style={{
                  height: 180,
                  overflowY: "auto",
                  overflowX: "hidden",
                }}
              >
                <div style={{ position: "relative", height: spectrumHeight }}>
                  {spectrumLoading && !spectrumData ? (
                    <div style={{
                      position: "absolute",
                      inset: 0,
                      display: "grid",
                      placeItems: "center",
                      color: "var(--muted)",
                      fontSize: 12,
                    }}>
                      Building spectrum…
                    </div>
                  ) : (
                    <canvas
                      ref={spectrumCanvasRef}
                      onPointerDown={(event) => seekAudio(spectrumTime(event.clientX))}
                      style={{
                        display: "block",
                        width: "100%",
                        height: spectrumHeight,
                        cursor: duration ? "pointer" : "default",
                      }}
                    />
                  )}

                  {removeFrequencyBand && (
                    <>
                      <button
                        type="button"
                        onPointerDown={(event) => startBandDrag(event, "high")}
                        style={{
                          position: "absolute",
                          left: 12,
                          right: 12,
                          top: highTop,
                          transform: "translateY(-50%)",
                          height: 24,
                          borderRadius: 999,
                          border: "1px solid rgba(255,255,255,0.2)",
                          background: "rgba(18,18,24,0.88)",
                          color: "var(--text)",
                          fontSize: 11,
                          fontWeight: 600,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "0 10px",
                          cursor: "ns-resize",
                        }}
                      >
                        <span>High</span>
                        <span>{Math.round(bandHighHz)}Hz</span>
                      </button>
                      <button
                        type="button"
                        onPointerDown={(event) => startBandDrag(event, "low")}
                        style={{
                          position: "absolute",
                          left: 12,
                          right: 12,
                          top: lowTop,
                          transform: "translateY(-50%)",
                          height: 24,
                          borderRadius: 999,
                          border: "1px solid rgba(255,255,255,0.2)",
                          background: "rgba(18,18,24,0.88)",
                          color: "var(--text)",
                          fontSize: 11,
                          fontWeight: 600,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "0 10px",
                          cursor: "ns-resize",
                        }}
                      >
                        <span>Low</span>
                        <span>{Math.round(bandLowHz)}Hz</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          <audio
            ref={audioRef}
            controls
            preload="metadata"
            src={audioUrl}
            onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime || 0)}
            onSeeked={(e) => setPlayhead(e.currentTarget.currentTime || 0)}
            style={{ width: "100%", height: 40 }}
          />
        </>
      ) : (
        <div style={{
          minHeight: 260,
          border: "1px dashed var(--border)",
          borderRadius: 14,
          display: "grid",
          placeItems: "center",
          color: "var(--muted)",
          background: "var(--bg2)",
          textAlign: "center",
          padding: 18,
        }}>
          Load a track to see its waveform and spectrum.
        </div>
      )}
    </div>
  );
}

function AudioWavePanel({
  title,
  audioUrl,
  waveData,
  duration,
  selection,
  setSelection,
  playhead,
  setPlayhead,
  audioRef,
  accentColor,
  allowSelection = false,
  footer,
}) {
  const canvasRef = useRef(null);
  const dragRef = useRef(null);

  const renderWave = () => {
    const canvas = canvasRef.current;
    if (!canvas || !waveData || !duration) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    drawWave(canvas, waveData, {
      trimStart: 0,
      trimEnd: duration,
      selStart: selection?.start ?? null,
      selEnd: selection?.end ?? null,
      startOffset: 0,
      playhead,
      zoom: width / Math.max(duration, 0.001),
      scrollLeft: 0,
      color: accentColor,
      taal: null,
      bpm: 0,
      TAALS: null,
    });
  };

  useEffect(() => {
    renderWave();
  }, [waveData, duration, selection, playhead, accentColor]);

  useEffect(() => {
    const onResize = () => renderWave();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  const seekAudio = (time) => {
    const clamped = Math.max(0, Math.min(duration || 0, time));
    if (audioRef.current) {
      audioRef.current.currentTime = clamped;
      if (!audioRef.current.paused) {
        audioRef.current.play().catch(() => {});
      }
    }
    setPlayhead(clamped);
  };

  const pointerTime = (clientX) => {
    const canvas = canvasRef.current;
    if (!canvas || !duration) return 0;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  const onPointerDown = (event) => {
    if (!duration) return;
    const time = pointerTime(event.clientX);
    dragRef.current = {
      startX: event.clientX,
      anchorTime: time,
      draggingSelection: false,
    };
    if (allowSelection && setSelection) {
      setSelection((prev) => prev || { start: 0, end: duration });
    }
  };

  useEffect(() => {
    const onMove = (event) => {
      if (!dragRef.current || !allowSelection || !setSelection) return;
      const delta = Math.abs(event.clientX - dragRef.current.startX);
      if (delta > 4) {
        dragRef.current.draggingSelection = true;
      }
      if (!dragRef.current.draggingSelection) return;
      const time = pointerTime(event.clientX);
      const start = Math.max(0, Math.min(dragRef.current.anchorTime, time));
      const end = Math.min(duration, Math.max(dragRef.current.anchorTime, time));
      setSelection({ start, end });
    };

    const onUp = (event) => {
      if (!dragRef.current) return;
      const time = pointerTime(event.clientX);
      if (dragRef.current.draggingSelection && allowSelection && setSelection) {
        const start = Math.max(0, Math.min(dragRef.current.anchorTime, time));
        const end = Math.min(duration, Math.max(dragRef.current.anchorTime, time));
        setSelection({ start, end });
      } else {
        seekAudio(time);
      }
      dragRef.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [allowSelection, duration, setSelection]);

  return (
    <div style={{
      border: "1px solid var(--border)",
      borderRadius: 18,
      background: "var(--surface-glass)",
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 12,
      boxShadow: "var(--shadow-lg)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontSize: 12, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
          {title}
        </div>
      </div>

      {audioUrl ? (
        <>
          <div style={{
            border: "1px solid var(--border)",
            borderRadius: 14,
            overflow: "hidden",
            background: "var(--bg2)",
          }}>
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              style={{
                display: "block",
                width: "100%",
                height: 180,
                cursor: duration ? (allowSelection ? "crosshair" : "pointer") : "default",
              }}
            />
          </div>
          <audio
            ref={audioRef}
            controls
            preload="metadata"
            src={audioUrl}
            onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime || 0)}
            onSeeked={(e) => setPlayhead(e.currentTarget.currentTime || 0)}
            style={{ width: "100%", height: 40 }}
          />
        </>
      ) : (
        <div style={{
          minHeight: 260,
          border: "1px dashed var(--border)",
          borderRadius: 14,
          display: "grid",
          placeItems: "center",
          color: "var(--muted)",
          background: "var(--bg2)",
          textAlign: "center",
          padding: 18,
        }}>
          {title === "Input"
            ? "Load a track to see its waveform and choose the region to process."
            : "After enhancement finishes, the processed result will appear here."}
        </div>
      )}

      {footer}
    </div>
  );
}

export default function AudioCleanup({ onAddToWorkshop, libraryItems, onSaveToLibrary }) {
  const [file, setFile] = useState(null);
  const [uploadDrag, setUploadDrag] = useState(false);
  const [panelMode, setPanelMode] = useState("enhance");
  const [preset, setPreset] = useState("singing");
  const [activeEffect, setActiveEffect] = useState("reverb");
  const [removeNoise, setRemoveNoise] = useState(PRESETS.singing.removeNoise);
  const [noiseStrength, setNoiseStrength] = useState(PRESETS.singing.noiseStrength);
  const [removeHum, setRemoveHum] = useState(PRESETS.singing.removeHum);
  const [humFrequency, setHumFrequency] = useState(PRESETS.singing.humFrequency);
  const [lowCutHz, setLowCutHz] = useState(PRESETS.singing.lowCutHz);
  const [highCutHz, setHighCutHz] = useState(PRESETS.singing.highCutHz);
  const [removeFrequencyBand, setRemoveFrequencyBand] = useState(false);
  const [bandLowHz, setBandLowHz] = useState(250);
  const [bandHighHz, setBandHighHz] = useState(1800);
  const [bandStrength, setBandStrength] = useState(55);
  const [addReverb, setAddReverb] = useState(EFFECT_PRESETS.space.addReverb);
  const [reverbAmount, setReverbAmount] = useState(EFFECT_PRESETS.space.reverbAmount);
  const [addEcho, setAddEcho] = useState(EFFECT_PRESETS.space.addEcho);
  const [echoDelayMs, setEchoDelayMs] = useState(EFFECT_PRESETS.space.echoDelayMs);
  const [echoFeedback, setEchoFeedback] = useState(EFFECT_PRESETS.space.echoFeedback);
  const [addChorus, setAddChorus] = useState(EFFECT_PRESETS.space.addChorus);
  const [chorusDepth, setChorusDepth] = useState(EFFECT_PRESETS.space.chorusDepth);
  const [addEqLift, setAddEqLift] = useState(true);
  const [eqAmount, setEqAmount] = useState(48);
  const [addCompressor, setAddCompressor] = useState(true);
  const [compressorAmount, setCompressorAmount] = useState(52);
  const [addLimiter, setAddLimiter] = useState(true);
  const [limiterCeilingDb, setLimiterCeilingDb] = useState(-1.2);
  const [addStereoWiden, setAddStereoWiden] = useState(true);
  const [stereoWidenAmount, setStereoWidenAmount] = useState(EFFECT_PRESETS.widen.stereoWidenAmount);
  const [addTelephone, setAddTelephone] = useState(true);
  const [telephoneAmount, setTelephoneAmount] = useState(42);
  const [addTremolo, setAddTremolo] = useState(true);
  const [tremoloRateHz, setTremoloRateHz] = useState(4.5);
  const [tremoloDepth, setTremoloDepth] = useState(48);
  const [addPhaser, setAddPhaser] = useState(true);
  const [phaserRateHz, setPhaserRateHz] = useState(0.55);
  const [phaserDepth, setPhaserDepth] = useState(45);
  const [addFlanger, setAddFlanger] = useState(true);
  const [flangerDepth, setFlangerDepth] = useState(42);
  const [flangerSpeedHz, setFlangerSpeedHz] = useState(0.45);
  const [addSaturation, setAddSaturation] = useState(true);
  const [saturationAmount, setSaturationAmount] = useState(36);
  const [addReverseReverb, setAddReverseReverb] = useState(true);
  const [reverseReverbAmount, setReverseReverbAmount] = useState(44);
  const [normalize, setNormalize] = useState(PRESETS.singing.normalize);
  const [format, setFormat] = useState("mp3");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [inputPlayhead, setInputPlayhead] = useState(0);
  const [outputPlayhead, setOutputPlayhead] = useState(0);
  const [viewMode, setViewMode] = useState("waveform");
  const [spectrumZoom, setSpectrumZoom] = useState(1);
  const { status, progress, results, error, submit, reset } = useJob({
    jobKey: "cleanup",
    label: "Audio Enhancement",
  });

  const inputAudioRef = useRef(null);
  const outputAudioRef = useRef(null);
  const uploadInputRef = useRef(null);

  const inputSource = useMemo(() => (file ? { kind: "file", file } : null), [file]);
  const inputAsset = useWaveAsset(inputSource);
  const outputResult = results?.[0] || null;
  const outputSource = useMemo(() => (
    outputResult ? {
      kind: "url",
      url: `${API_BASE}/download/${outputResult.filename}`,
      label: outputResult.filename,
    } : null
  ), [outputResult]);
  const outputAsset = useWaveAsset(outputSource);
  const { data: spectrumData, loading: spectrumLoading } = useSpectrumData(
    inputAsset.samples,
    inputAsset.sampleRate,
    inputAsset.duration,
    viewMode === "spectrum"
  );
  const currentFileLabel = file?.name || inputAsset.label || "No audio loaded";

  const hasEnhancementSelection =
    removeNoise ||
    removeHum ||
    normalize ||
    lowCutHz > 0 ||
    highCutHz > 0 ||
    (removeFrequencyBand && bandHighHz > bandLowHz);
  const hasAnyAddedEffect = (
    (activeEffect === "eq" && addEqLift) ||
    (activeEffect === "compressor" && addCompressor) ||
    (activeEffect === "limiter" && addLimiter) ||
    (activeEffect === "widen" && addStereoWiden) ||
    (activeEffect === "telephone" && addTelephone) ||
    (activeEffect === "tremolo" && addTremolo) ||
    (activeEffect === "phaser" && addPhaser) ||
    (activeEffect === "flanger" && addFlanger) ||
    (activeEffect === "saturation" && addSaturation) ||
    (activeEffect === "reverse-reverb" && addReverseReverb) ||
    (activeEffect === "reverb" && addReverb) ||
    (activeEffect === "echo" && addEcho) ||
    (activeEffect === "chorus" && addChorus)
  );
  const hasAnyEffect = panelMode === "enhance" ? hasEnhancementSelection : hasAnyAddedEffect;
  const hasSelection = inputAsset.duration > 0 && selection.end > selection.start;

  useEffect(() => {
    if (inputAsset.duration > 0) {
      setSelection((prev) => (
        prev.end > prev.start ? prev : { start: 0, end: inputAsset.duration }
      ));
    } else {
      setSelection({ start: 0, end: 0 });
    }
  }, [inputAsset.duration]);

  const selectedSummary = useMemo(() => {
    const parts = [];
    if (panelMode === "enhance") {
      if (removeNoise) parts.push(`Noise ${noiseStrength}%`);
      if (removeHum) parts.push(`Hum ${humFrequency}Hz`);
      if (lowCutHz > 0) parts.push(`Low cut ${lowCutHz}Hz`);
      if (highCutHz > 0) parts.push(`High cut ${highCutHz}Hz`);
      if (removeFrequencyBand && bandHighHz > bandLowHz) {
        parts.push(`Band ${bandLowHz}-${bandHighHz}Hz @ ${bandStrength}%`);
      }
      if (normalize) parts.push("Normalize");
      return parts.length ? parts.join(" • ") : "No enhancement options selected";
    }
    if (activeEffect === "eq" && addEqLift) parts.push(`EQ Lift ${eqAmount}%`);
    if (activeEffect === "compressor" && addCompressor) parts.push(`Compressor ${compressorAmount}%`);
    if (activeEffect === "limiter" && addLimiter) parts.push(`Limiter ${limiterCeilingDb.toFixed(1)}dB`);
    if (activeEffect === "widen" && addStereoWiden) parts.push(`Stereo Widen ${stereoWidenAmount}%`);
    if (activeEffect === "telephone" && addTelephone) parts.push(`Telephone ${telephoneAmount}%`);
    if (activeEffect === "tremolo" && addTremolo) parts.push(`Tremolo ${tremoloRateHz.toFixed(1)}Hz @ ${tremoloDepth}%`);
    if (activeEffect === "phaser" && addPhaser) parts.push(`Phaser ${phaserRateHz.toFixed(2)}Hz @ ${phaserDepth}%`);
    if (activeEffect === "flanger" && addFlanger) parts.push(`Flanger ${flangerSpeedHz.toFixed(2)}Hz @ ${flangerDepth}%`);
    if (activeEffect === "saturation" && addSaturation) parts.push(`Warm Saturation ${saturationAmount}%`);
    if (activeEffect === "reverse-reverb" && addReverseReverb) parts.push(`Reverse Reverb ${reverseReverbAmount}%`);
    if (activeEffect === "reverb" && addReverb) parts.push(`Reverb ${reverbAmount}%`);
    if (activeEffect === "echo" && addEcho) parts.push(`Echo ${echoDelayMs}ms @ ${echoFeedback}%`);
    if (activeEffect === "chorus" && addChorus) parts.push(`Chorus ${chorusDepth}%`);
    return parts.length ? parts.join(" • ") : "No effect options selected";
  }, [panelMode, activeEffect, removeNoise, noiseStrength, removeHum, humFrequency, lowCutHz, highCutHz, removeFrequencyBand, bandLowHz, bandHighHz, bandStrength, normalize, addEqLift, eqAmount, addCompressor, compressorAmount, addLimiter, limiterCeilingDb, addStereoWiden, stereoWidenAmount, addTelephone, telephoneAmount, addTremolo, tremoloRateHz, tremoloDepth, addPhaser, phaserRateHz, phaserDepth, addFlanger, flangerDepth, flangerSpeedHz, addSaturation, saturationAmount, addReverseReverb, reverseReverbAmount, addReverb, reverbAmount, addEcho, echoDelayMs, echoFeedback, addChorus, chorusDepth]);

  const applyPreset = (presetKey) => {
    const next = PRESETS[presetKey];
    setPreset(presetKey);
    setRemoveNoise(next.removeNoise);
    setNoiseStrength(next.noiseStrength);
    setRemoveHum(next.removeHum);
    setHumFrequency(next.humFrequency);
    setLowCutHz(next.lowCutHz);
    setHighCutHz(next.highCutHz);
    setRemoveFrequencyBand(false);
    setNormalize(next.normalize);
  };

  const applyEffectPreset = (presetKey) => {
    const next = EFFECT_PRESETS[presetKey];
    setAddReverb(next.addReverb);
    setReverbAmount(next.reverbAmount);
    setAddEcho(next.addEcho);
    setEchoDelayMs(next.echoDelayMs);
    setEchoFeedback(next.echoFeedback);
    setAddChorus(next.addChorus);
    setChorusDepth(next.chorusDepth);
    setAddStereoWiden(next.addStereoWiden);
    setStereoWidenAmount(next.stereoWidenAmount);
  };

  const handleSubmit = () => {
    if (!file || !hasAnyEffect || !hasSelection) return;
    const enhancementMode = panelMode === "enhance";
    const fd = new FormData();
    fd.append("file", file);
    fd.append("remove_noise", String(enhancementMode ? removeNoise : false));
    fd.append("noise_strength", String(noiseStrength));
    fd.append("remove_hum", String(enhancementMode ? removeHum : false));
    fd.append("hum_frequency", String(humFrequency));
    fd.append("low_cut_hz", String(enhancementMode ? lowCutHz : 0));
    fd.append("high_cut_hz", String(enhancementMode ? highCutHz : 0));
    fd.append("remove_frequency_band", String(enhancementMode ? removeFrequencyBand : false));
    fd.append("band_low_hz", String(bandLowHz));
    fd.append("band_high_hz", String(bandHighHz));
    fd.append("band_strength", String(bandStrength));
    fd.append("add_eq_lift", String(!enhancementMode && activeEffect === "eq" && addEqLift));
    fd.append("eq_amount", String(eqAmount));
    fd.append("add_compressor", String(!enhancementMode && activeEffect === "compressor" && addCompressor));
    fd.append("compressor_amount", String(compressorAmount));
    fd.append("add_limiter", String(!enhancementMode && activeEffect === "limiter" && addLimiter));
    fd.append("limiter_ceiling_db", String(limiterCeilingDb));
    fd.append("add_stereo_widen", String(!enhancementMode && activeEffect === "widen" && addStereoWiden));
    fd.append("stereo_widen_amount", String(stereoWidenAmount));
    fd.append("add_telephone", String(!enhancementMode && activeEffect === "telephone" && addTelephone));
    fd.append("telephone_amount", String(telephoneAmount));
    fd.append("add_tremolo", String(!enhancementMode && activeEffect === "tremolo" && addTremolo));
    fd.append("tremolo_rate_hz", String(tremoloRateHz));
    fd.append("tremolo_depth", String(tremoloDepth));
    fd.append("add_phaser", String(!enhancementMode && activeEffect === "phaser" && addPhaser));
    fd.append("phaser_rate_hz", String(phaserRateHz));
    fd.append("phaser_depth", String(phaserDepth));
    fd.append("add_flanger", String(!enhancementMode && activeEffect === "flanger" && addFlanger));
    fd.append("flanger_depth", String(flangerDepth));
    fd.append("flanger_speed_hz", String(flangerSpeedHz));
    fd.append("add_saturation", String(!enhancementMode && activeEffect === "saturation" && addSaturation));
    fd.append("saturation_amount", String(saturationAmount));
    fd.append("add_reverse_reverb", String(!enhancementMode && activeEffect === "reverse-reverb" && addReverseReverb));
    fd.append("reverse_reverb_amount", String(reverseReverbAmount));
    fd.append("add_reverb", String(!enhancementMode && activeEffect === "reverb" && addReverb));
    fd.append("reverb_amount", String(reverbAmount));
    fd.append("add_echo", String(!enhancementMode && activeEffect === "echo" && addEcho));
    fd.append("echo_delay_ms", String(echoDelayMs));
    fd.append("echo_feedback", String(echoFeedback));
    fd.append("add_chorus", String(!enhancementMode && activeEffect === "chorus" && addChorus));
    fd.append("chorus_depth", String(chorusDepth));
    fd.append("normalize", String(enhancementMode ? normalize : false));
    fd.append("selected_start_ms", String(Math.round(selection.start * 1000)));
    fd.append("selected_end_ms", String(Math.round(selection.end * 1000)));
    fd.append("output_format", format);
    submit("/api/audio-cleanup", fd);
  };

  const addOutputToWorkshop = async () => {
    if (!outputResult || !onAddToWorkshop) return;
    await onAddToWorkshop([outputResult]);
  };

  const handleHeaderFile = (nextFile) => {
    if (!nextFile) return;
    setFile(nextFile);
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 20,
      height: "calc(100vh - 128px)",
      minHeight: 680,
    }}>
      <div className="tool-header" style={{ marginBottom: 0 }}>
        <h2 className="tool-title">Audio Enhancement</h2>
        <p className="tool-subtitle">
          Clean recordings, shape tone, and add musical effects only to the section you choose.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setUploadDrag(true); }}
        onDragLeave={() => setUploadDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setUploadDrag(false);
          handleHeaderFile(e.dataTransfer.files?.[0]);
        }}
        style={{
          flexShrink: 0,
          padding: "10px 14px",
          borderRadius: 14,
          border: uploadDrag ? "1px solid rgba(201,125,58,0.45)" : "1px solid var(--border)",
          background: uploadDrag ? "rgba(201,125,58,0.08)" : "var(--bg2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          minHeight: 52,
        }}
      >
        <input
          ref={uploadInputRef}
          type="file"
          accept="audio/*"
          style={{ display: "none" }}
          onChange={(e) => handleHeaderFile(e.target.files?.[0])}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
          <div style={{
            display: "inline-grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 4,
            padding: 4,
            borderRadius: 999,
            background: "var(--bg3)",
            border: "1px solid var(--border)",
          }}>
            {[
              { id: "enhance", label: "Enhance" },
              { id: "effects", label: "Effect" },
            ].map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={panelMode === mode.id ? "btn-primary" : "btn-ghost"}
                onClick={() => setPanelMode(mode.id)}
                style={{ padding: "6px 10px", fontSize: 11, minWidth: 76 }}
              >
                {mode.label}
              </button>
            ))}
          </div>
          {panelMode === "effects" && (
            <select
              value={activeEffect}
              onChange={(e) => setActiveEffect(e.target.value)}
              style={{
                background: "var(--bg3)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                color: "var(--text)",
                padding: "7px 10px",
                fontSize: 12,
                minWidth: 168,
              }}
            >
              {EFFECT_OPTIONS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.items.map((item) => (
                    <option key={item.value} value={item.value} disabled={!item.enabled}>
                      {item.enabled ? item.label : `${item.label} (Coming Soon)`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 10px",
            borderRadius: 12,
            background: "linear-gradient(135deg, rgba(201,125,58,0.16), rgba(139,78,163,0.08))",
            border: "1px solid rgba(201,125,58,0.24)",
          }}>
            <div style={{
              fontSize: 12,
              color: "var(--accent)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}>
              Upload Audio
            </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => uploadInputRef.current?.click()}
            style={{ padding: "6px 12px", fontSize: 12 }}
          >
            Choose File
          </button>
          <LibraryPickerButton onPickFile={handleHeaderFile} libraryItems={libraryItems} style={{ padding: "6px 12px", fontSize: 12 }} />
          </div>
        </div>
        <div style={{
          minWidth: 0,
          flex: 1,
          textAlign: "right",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontSize: 13,
          fontWeight: 600,
          color: file ? "var(--text)" : "var(--muted)",
        }}>
          {currentFileLabel}
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "320px minmax(0, 1fr)",
        gap: 20,
        alignItems: "stretch",
        minHeight: 0,
        flex: 1,
        overflow: "hidden",
      }}>
        <aside style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          border: "1px solid var(--border)",
          borderRadius: 18,
          background: "var(--surface-glass)",
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
        }}>
          <div style={{
            overflowY: "auto",
            padding: "0 10px 0 0",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            flex: 1,
            minHeight: 0,
            margin: 16,
            marginRight: 10,
          }}>
          {panelMode === "enhance" && (
            <>
          <div className="section" style={{ marginBottom: 0 }}>
            <p className="section-label">Quick Presets</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {Object.entries(PRESETS).map(([key, value]) => (
                <button
                  key={key}
                  type="button"
                  className="btn-ghost"
                  onClick={() => applyPreset(key)}
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    borderColor: preset === key ? "var(--accent)" : undefined,
                    color: preset === key ? "var(--accent)" : undefined,
                  }}
                >
                  {value.label}
                </button>
              ))}
            </div>
          </div>

          <div className="section" style={{ marginBottom: 0 }}>
            <p className="section-label">Apply To</p>
            <div style={{
              padding: "10px 14px",
              background: "rgba(107,97,185,0.08)",
              borderRadius: 8,
              border: "1px solid rgba(107,97,185,0.18)",
              fontSize: 12,
              color: "var(--muted)",
              lineHeight: 1.7,
            }}>
              <strong style={{ color: "var(--text)" }}>
                {hasSelection ? `${fmtSeconds(selection.start)} → ${fmtSeconds(selection.end)}` : "Select a waveform region"}
              </strong>
              <div style={{ marginTop: 4 }}>
                Click to place the playhead. Drag to define the region that should be cleaned.
              </div>
            </div>
            <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
              <RangeField
                label="Selection Start"
                value={selection.start}
                onChange={(value) => setSelection((prev) => ({
                  start: Math.max(0, Math.min(value, prev.end)),
                  end: prev.end,
                }))}
                min={0}
                max={inputAsset.duration || 0}
              />
              <RangeField
                label="Selection End"
                value={selection.end}
                onChange={(value) => setSelection((prev) => ({
                  start: prev.start,
                  end: Math.max(prev.start, Math.min(value, inputAsset.duration || 0)),
                }))}
                min={0}
                max={inputAsset.duration || 0}
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => inputAsset.duration && setSelection({ start: 0, end: inputAsset.duration })}
                style={{ fontSize: 11, padding: "5px 10px" }}
              >
                Use Full Track
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  const current = inputAudioRef.current?.currentTime || 0;
                  const end = Math.min(inputAsset.duration || 0, current + 3);
                  setSelection({ start: current, end });
                }}
                style={{ fontSize: 11, padding: "5px 10px" }}
              >
                Mark 3s From Cursor
              </button>
            </div>
          </div>

          <div className="section" style={{ marginBottom: 0 }}>
            <p className="section-label">Enhancement Controls</p>
            <div style={{ display: "grid", gap: 12 }}>
              <OptionCard title="Noise Reduction" hint="Useful for fan noise, room hiss, and rough practice recordings.">
                <ToggleRow
                  checked={removeNoise}
                  onChange={setRemoveNoise}
                  title="Reduce broadband noise"
                  hint="Applies a gentle denoise pass to make the selected region cleaner."
                />
                <div style={{ marginTop: 12, opacity: removeNoise ? 1 : 0.45 }}>
                  <div className="range-row">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={noiseStrength}
                      disabled={!removeNoise}
                      onChange={(e) => setNoiseStrength(Number(e.target.value))}
                    />
                    <span className="range-value">{noiseStrength}%</span>
                  </div>
                </div>
              </OptionCard>

              <OptionCard title="Hum & Tone Control" hint="Useful for electrical buzz, low-end rumble, and overly dull source files.">
                <div style={{ display: "grid", gap: 14 }}>
                  <ToggleRow
                    checked={removeHum}
                    onChange={setRemoveHum}
                    title="Reduce mains hum"
                    hint="Targets the most common electrical hum frequencies and a few harmonics."
                  />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", opacity: removeHum ? 1 : 0.45 }}>
                    {[50, 60].map((hz) => (
                      <button
                        key={hz}
                        type="button"
                        className="btn-ghost"
                        disabled={!removeHum}
                        onClick={() => setHumFrequency(hz)}
                        style={{
                          padding: "5px 12px",
                          fontSize: 12,
                          borderColor: humFrequency === hz ? "var(--accent)" : undefined,
                          color: humFrequency === hz ? "var(--accent)" : undefined,
                        }}
                      >
                        {hz}Hz
                      </button>
                    ))}
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Low Cut</label>
                    <div className="range-row">
                      <input type="range" min="0" max="220" step="5" value={lowCutHz} onChange={(e) => setLowCutHz(Number(e.target.value))} />
                      <span className="range-value">{lowCutHz > 0 ? `${lowCutHz}Hz` : "Off"}</span>
                    </div>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>High Cut</label>
                    <div className="range-row">
                      <input type="range" min="0" max="18000" step="250" value={highCutHz} onChange={(e) => setHighCutHz(Number(e.target.value))} />
                      <span className="range-value">{highCutHz > 0 ? `${highCutHz}Hz` : "Off"}</span>
                    </div>
                  </div>
                </div>
              </OptionCard>

              <OptionCard title="Frequency Removal" hint="Attenuate one frequency band inside the selected time region. This is useful for taming harsh midrange, boxiness, or a narrow distracting layer.">
                <div style={{ display: "grid", gap: 14 }}>
                  <ToggleRow
                    checked={removeFrequencyBand}
                    onChange={setRemoveFrequencyBand}
                    title="Remove selected frequency band"
                    hint="Cuts energy between the chosen low and high frequency limits."
                  />

                  <div style={{ opacity: removeFrequencyBand ? 1 : 0.45, display: "grid", gap: 12 }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Band Start</label>
                      <div className="range-row">
                        <input
                          type="range"
                          min="20"
                          max="12000"
                          step="10"
                          value={bandLowHz}
                          disabled={!removeFrequencyBand}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            setBandLowHz(Math.min(next, bandHighHz - 10));
                          }}
                        />
                        <span className="range-value">{bandLowHz}Hz</span>
                      </div>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Band End</label>
                      <div className="range-row">
                        <input
                          type="range"
                          min="30"
                          max="18000"
                          step="10"
                          value={bandHighHz}
                          disabled={!removeFrequencyBand}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            setBandHighHz(Math.max(next, bandLowHz + 10));
                          }}
                        />
                        <span className="range-value">{bandHighHz}Hz</span>
                      </div>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Removal Strength</label>
                      <div className="range-row">
                        <input
                          type="range"
                          min="1"
                          max="100"
                          step="1"
                          value={bandStrength}
                          disabled={!removeFrequencyBand}
                          onChange={(e) => setBandStrength(Number(e.target.value))}
                        />
                        <span className="range-value">{bandStrength}%</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {[
                        { label: "Low Rumble", low: 20, high: 140, strength: 70 },
                        { label: "Boxy Mids", low: 250, high: 900, strength: 55 },
                        { label: "Harsh Highs", low: 4000, high: 9000, strength: 45 },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          className="btn-ghost"
                          disabled={!removeFrequencyBand}
                          onClick={() => {
                            setBandLowHz(preset.low);
                            setBandHighHz(preset.high);
                            setBandStrength(preset.strength);
                          }}
                          style={{ padding: "5px 10px", fontSize: 11 }}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </OptionCard>

              <OptionCard title="Output Level" hint="Use this when the cleaned result feels too quiet compared with the original.">
                <ToggleRow
                  checked={normalize}
                  onChange={setNormalize}
                  title="Normalize loudness"
                  hint="Brings the selected region to a steadier listening level."
                />
              </OptionCard>
            </div>

            <div style={{
              marginTop: 14,
              padding: "10px 14px",
              background: "rgba(201,125,58,0.06)",
              borderRadius: 8,
              border: "1px solid rgba(201,125,58,0.15)",
              fontSize: 12,
              color: "var(--muted)",
              lineHeight: 1.7,
            }}>
              <strong style={{ color: "var(--text)" }}>Selected enhancement:</strong> {selectedSummary}
            </div>

            <div style={{ marginTop: 16 }}>
              <FormatPicker value={format} onChange={setFormat} />
            </div>
          </div>
            </>
          )}

          {panelMode === "effects" && (
            <>
              <div className="section" style={{ marginBottom: 0 }}>
                <p className="section-label">Apply To</p>
                <div style={{
                  padding: "10px 14px",
                  background: "rgba(107,97,185,0.08)",
                  borderRadius: 8,
                  border: "1px solid rgba(107,97,185,0.18)",
                  fontSize: 12,
                  color: "var(--muted)",
                  lineHeight: 1.7,
                }}>
                  <strong style={{ color: "var(--text)" }}>
                    {hasSelection ? `${fmtSeconds(selection.start)} → ${fmtSeconds(selection.end)}` : "Select a waveform region"}
                  </strong>
                  <div style={{ marginTop: 4 }}>
                    Use the same waveform selection to decide where the effect should be added.
                  </div>
                </div>
                <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
                  <RangeField
                    label="Selection Start"
                    value={selection.start}
                    onChange={(value) => setSelection((prev) => ({
                      start: Math.max(0, Math.min(value, prev.end)),
                      end: prev.end,
                    }))}
                    min={0}
                    max={inputAsset.duration || 0}
                  />
                  <RangeField
                    label="Selection End"
                    value={selection.end}
                    onChange={(value) => setSelection((prev) => ({
                      start: prev.start,
                      end: Math.max(prev.start, Math.min(value, inputAsset.duration || 0)),
                    }))}
                    min={0}
                    max={inputAsset.duration || 0}
                  />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => inputAsset.duration && setSelection({ start: 0, end: inputAsset.duration })}
                    style={{ fontSize: 11, padding: "5px 10px" }}
                  >
                    Use Full Track
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      const current = inputAudioRef.current?.currentTime || 0;
                      const end = Math.min(inputAsset.duration || 0, current + 3);
                      setSelection({ start: current, end });
                    }}
                    style={{ fontSize: 11, padding: "5px 10px" }}
                  >
                    Mark 3s From Cursor
                  </button>
                </div>
              </div>

              <div className="section" style={{ marginBottom: 0 }}>
                <p className="section-label">Effect Controls</p>
                <div style={{ display: "grid", gap: 12 }}>
                  {activeEffect === "eq" && (
                  <OptionCard title="EQ Lift" hint="Brighten and open up the selected audio with a gentle presence and air boost.">
                    <ToggleRow
                      checked={addEqLift}
                      onChange={setAddEqLift}
                      title="Add vocal/instrument lift"
                      hint="Reduces a little low-mid heaviness and adds clarity in the upper mids and highs."
                    />
                    <div style={{ marginTop: 12, opacity: addEqLift ? 1 : 0.45 }}>
                      <div className="range-row">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={eqAmount}
                          disabled={!addEqLift}
                          onChange={(e) => setEqAmount(Number(e.target.value))}
                        />
                        <span className="range-value">{eqAmount}%</span>
                      </div>
                    </div>
                  </OptionCard>
                  )}

                  {activeEffect === "compressor" && (
                  <OptionCard title="Compressor" hint="Smooths loud and soft sections so the selected phrase sits more evenly.">
                    <ToggleRow
                      checked={addCompressor}
                      onChange={setAddCompressor}
                      title="Apply dynamics compression"
                      hint="Useful for rehearsal vocals, spoken announcements, and uneven live recordings."
                    />
                    <div style={{ marginTop: 12, opacity: addCompressor ? 1 : 0.45 }}>
                      <div className="range-row">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={compressorAmount}
                          disabled={!addCompressor}
                          onChange={(e) => setCompressorAmount(Number(e.target.value))}
                        />
                        <span className="range-value">{compressorAmount}%</span>
                      </div>
                    </div>
                  </OptionCard>
                  )}

                  {activeEffect === "limiter" && (
                  <OptionCard title="Limiter" hint="Controls peaks and keeps the selected audio from jumping out too hard.">
                    <ToggleRow
                      checked={addLimiter}
                      onChange={setAddLimiter}
                      title="Limit loud peaks"
                      hint="A good finishing tool after strong enhancement or vocal processing."
                    />
                    <div style={{ marginTop: 12, opacity: addLimiter ? 1 : 0.45 }}>
                      <div className="range-row">
                        <input
                          type="range"
                          min="-6"
                          max="-0.5"
                          step="0.1"
                          value={limiterCeilingDb}
                          disabled={!addLimiter}
                          onChange={(e) => setLimiterCeilingDb(Number(e.target.value))}
                        />
                        <span className="range-value">{limiterCeilingDb.toFixed(1)}dB</span>
                      </div>
                    </div>
                  </OptionCard>
                  )}

                  {activeEffect === "widen" && (
                  <OptionCard title="Stereo Widen" hint="Makes accompaniment or pads feel broader and more spacious.">
                    <ToggleRow
                      checked={addStereoWiden}
                      onChange={setAddStereoWiden}
                      title="Expand stereo width"
                      hint="Works best on already-stereo material; use gently on vocals."
                    />
                    <div style={{ marginTop: 12, opacity: addStereoWiden ? 1 : 0.45 }}>
                      <div className="range-row">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={stereoWidenAmount}
                          disabled={!addStereoWiden}
                          onChange={(e) => setStereoWidenAmount(Number(e.target.value))}
                        />
                        <span className="range-value">{stereoWidenAmount}%</span>
                      </div>
                    </div>
                  </OptionCard>
                  )}

                  {activeEffect === "telephone" && (
                  <OptionCard title="Telephone / Radio" hint="Creates a narrow-band stylized voice effect for intros, skits, or creative transitions.">
                    <ToggleRow
                      checked={addTelephone}
                      onChange={setAddTelephone}
                      title="Apply telephone tone"
                      hint="Cuts lows and highs, boosts the mid band, and adds a little grit."
                    />
                    <div style={{ marginTop: 12, opacity: addTelephone ? 1 : 0.45 }}>
                      <div className="range-row">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={telephoneAmount}
                          disabled={!addTelephone}
                          onChange={(e) => setTelephoneAmount(Number(e.target.value))}
                        />
                        <span className="range-value">{telephoneAmount}%</span>
                      </div>
                    </div>
                  </OptionCard>
                  )}

                  {activeEffect === "tremolo" && (
                  <OptionCard title="Tremolo" hint="Adds rhythmic volume movement to the selected region.">
                    <ToggleRow
                      checked={addTremolo}
                      onChange={setAddTremolo}
                      title="Apply tremolo pulse"
                      hint="Useful for texture, drone movement, or stylized sustained notes."
                    />
                    <div style={{ opacity: addTremolo ? 1 : 0.45, display: "grid", gap: 12, marginTop: 12 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>Rate</label>
                        <div className="range-row">
                          <input type="range" min="0.2" max="12" step="0.1" value={tremoloRateHz} disabled={!addTremolo} onChange={(e) => setTremoloRateHz(Number(e.target.value))} />
                          <span className="range-value">{tremoloRateHz.toFixed(1)}Hz</span>
                        </div>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>Depth</label>
                        <div className="range-row">
                          <input type="range" min="0" max="100" step="1" value={tremoloDepth} disabled={!addTremolo} onChange={(e) => setTremoloDepth(Number(e.target.value))} />
                          <span className="range-value">{tremoloDepth}%</span>
                        </div>
                      </div>
                    </div>
                  </OptionCard>
                  )}

                  {activeEffect === "phaser" && (
                  <OptionCard title="Phaser" hint="Adds a sweeping, swirling colour to the selected audio.">
                    <ToggleRow
                      checked={addPhaser}
                      onChange={setAddPhaser}
                      title="Apply phaser sweep"
                      hint="Good for synths, pads, and creative vocal passages."
                    />
                    <div style={{ opacity: addPhaser ? 1 : 0.45, display: "grid", gap: 12, marginTop: 12 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>Rate</label>
                        <div className="range-row">
                          <input type="range" min="0.1" max="2" step="0.05" value={phaserRateHz} disabled={!addPhaser} onChange={(e) => setPhaserRateHz(Number(e.target.value))} />
                          <span className="range-value">{phaserRateHz.toFixed(2)}Hz</span>
                        </div>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>Depth</label>
                        <div className="range-row">
                          <input type="range" min="0" max="100" step="1" value={phaserDepth} disabled={!addPhaser} onChange={(e) => setPhaserDepth(Number(e.target.value))} />
                          <span className="range-value">{phaserDepth}%</span>
                        </div>
                      </div>
                    </div>
                  </OptionCard>
                  )}

                  {activeEffect === "flanger" && (
                  <OptionCard title="Flanger" hint="Creates a tighter, jet-like moving comb effect.">
                    <ToggleRow
                      checked={addFlanger}
                      onChange={setAddFlanger}
                      title="Apply flanger motion"
                      hint="Stronger and more metallic than chorus, great for creative sections."
                    />
                    <div style={{ opacity: addFlanger ? 1 : 0.45, display: "grid", gap: 12, marginTop: 12 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>Speed</label>
                        <div className="range-row">
                          <input type="range" min="0.1" max="3" step="0.05" value={flangerSpeedHz} disabled={!addFlanger} onChange={(e) => setFlangerSpeedHz(Number(e.target.value))} />
                          <span className="range-value">{flangerSpeedHz.toFixed(2)}Hz</span>
                        </div>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>Depth</label>
                        <div className="range-row">
                          <input type="range" min="0" max="100" step="1" value={flangerDepth} disabled={!addFlanger} onChange={(e) => setFlangerDepth(Number(e.target.value))} />
                          <span className="range-value">{flangerDepth}%</span>
                        </div>
                      </div>
                    </div>
                  </OptionCard>
                  )}

                  {activeEffect === "saturation" && (
                  <OptionCard title="Warm Saturation" hint="Adds a little harmonic warmth and density without going fully distorted.">
                    <ToggleRow
                      checked={addSaturation}
                      onChange={setAddSaturation}
                      title="Apply soft saturation"
                      hint="Useful for vocals, solo instruments, and old-radio style colour."
                    />
                    <div style={{ marginTop: 12, opacity: addSaturation ? 1 : 0.45 }}>
                      <div className="range-row">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={saturationAmount}
                          disabled={!addSaturation}
                          onChange={(e) => setSaturationAmount(Number(e.target.value))}
                        />
                        <span className="range-value">{saturationAmount}%</span>
                      </div>
                    </div>
                  </OptionCard>
                  )}

                  {activeEffect === "reverse-reverb" && (
                  <OptionCard title="Reverse Reverb" hint="Creates a swelling lead-in tail that rises into the selected phrase.">
                    <ToggleRow
                      checked={addReverseReverb}
                      onChange={setAddReverseReverb}
                      title="Apply reverse reverb swell"
                      hint="Best for transitions, vocal pickups, and dramatic phrase entrances."
                    />
                    <div style={{ marginTop: 12, opacity: addReverseReverb ? 1 : 0.45 }}>
                      <div className="range-row">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={reverseReverbAmount}
                          disabled={!addReverseReverb}
                          onChange={(e) => setReverseReverbAmount(Number(e.target.value))}
                        />
                        <span className="range-value">{reverseReverbAmount}%</span>
                      </div>
                    </div>
                  </OptionCard>
                  )}

                  {activeEffect === "reverb" && (
                  <OptionCard title="Reverb" hint="Add space and tail so vocals or instruments feel less dry.">
                    <ToggleRow
                      checked={addReverb}
                      onChange={setAddReverb}
                      title="Add room reverb"
                      hint="Creates a small-to-medium ambience around the selected audio."
                    />
                    <div style={{ marginTop: 12, opacity: addReverb ? 1 : 0.45 }}>
                      <div className="range-row">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={reverbAmount}
                          disabled={!addReverb}
                          onChange={(e) => setReverbAmount(Number(e.target.value))}
                        />
                        <span className="range-value">{reverbAmount}%</span>
                      </div>
                    </div>
                  </OptionCard>
                  )}

                  {activeEffect === "echo" && (
                  <OptionCard title="Echo / Delay" hint="Useful for ambient tails, call-and-response flavour, or a slightly rhythmic repeat.">
                    <ToggleRow
                      checked={addEcho}
                      onChange={setAddEcho}
                      title="Add echo repeats"
                      hint="Creates one or more repeats behind the selected phrase."
                    />
                    <div style={{ opacity: addEcho ? 1 : 0.45, display: "grid", gap: 12, marginTop: 12 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>Delay Time</label>
                        <div className="range-row">
                          <input type="range" min="60" max="900" step="10" value={echoDelayMs} disabled={!addEcho} onChange={(e) => setEchoDelayMs(Number(e.target.value))} />
                          <span className="range-value">{echoDelayMs}ms</span>
                        </div>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>Feedback</label>
                        <div className="range-row">
                          <input type="range" min="5" max="90" step="1" value={echoFeedback} disabled={!addEcho} onChange={(e) => setEchoFeedback(Number(e.target.value))} />
                          <span className="range-value">{echoFeedback}%</span>
                        </div>
                      </div>
                    </div>
                  </OptionCard>
                  )}

                  {activeEffect === "chorus" && (
                  <OptionCard title="Chorus / Width" hint="Thicken the selected part and make it feel wider without changing the source performance.">
                    <ToggleRow
                      checked={addChorus}
                      onChange={setAddChorus}
                      title="Add chorus width"
                      hint="A subtle doubling-style effect that can help vocals and melodic lines feel fuller."
                    />
                    <div style={{ marginTop: 12, opacity: addChorus ? 1 : 0.45 }}>
                      <div className="range-row">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={chorusDepth}
                          disabled={!addChorus}
                          onChange={(e) => setChorusDepth(Number(e.target.value))}
                        />
                        <span className="range-value">{chorusDepth}%</span>
                      </div>
                    </div>
                  </OptionCard>
                  )}
                </div>

                <div style={{
                  marginTop: 14,
                  padding: "10px 14px",
                  background: "rgba(201,125,58,0.06)",
                  borderRadius: 8,
                  border: "1px solid rgba(201,125,58,0.15)",
                  fontSize: 12,
                  color: "var(--muted)",
                  lineHeight: 1.7,
                }}>
                  <strong style={{ color: "var(--text)" }}>Selected effects:</strong> {selectedSummary}
                </div>

                <div style={{ marginTop: 16 }}>
                  <FormatPicker value={format} onChange={setFormat} />
                </div>
              </div>
            </>
          )}

          {(status === "processing" || status === "error") && (
            <JobStatus
              status={status}
              progress={progress}
              results={[]}
              error={error}
              onDismiss={reset}
              onSaveToLibrary={onSaveToLibrary}
            />
          )}
          </div>

          <div style={{
            flexShrink: 0,
            padding: "14px 16px 16px",
            borderTop: "1px solid var(--border)",
            background: "linear-gradient(180deg, rgba(0,0,0,0), var(--surface-glass))",
          }}>
            <button
              className="btn-primary"
              type="button"
              onClick={handleSubmit}
              disabled={!file || !hasAnyEffect || !hasSelection || status === "processing"}
              style={{ width: "100%" }}
            >
              {status === "processing"
                ? (panelMode === "effects" ? "Adding effects…" : "Enhancing audio…")
                : (panelMode === "effects" ? "✦ Add Effect" : "✦ Apply Enhancement")}
            </button>
            {!hasAnyEffect && file && (
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                {panelMode === "effects"
                  ? "Turn on at least one effect option to process this track."
                  : "Turn on at least one enhancement option to process this track."}
              </p>
            )}
            {hasAnyEffect && file && !hasSelection && (
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                Select a non-empty region in the waveform before processing.
              </p>
            )}
          </div>
        </aside>

        <div style={{
          display: "grid",
          gap: 18,
          minHeight: 0,
          overflowY: "auto",
          padding: "2px 4px 8px 1px",
        }}>
          <InputAnalysisPanel
            audioUrl={inputAsset.audioUrl}
            waveData={inputAsset.waveData}
            duration={inputAsset.duration}
            selection={selection}
            setSelection={setSelection}
            playhead={inputPlayhead}
            setPlayhead={setInputPlayhead}
            audioRef={inputAudioRef}
            accentColor="#c97d3a"
            spectrumData={spectrumData}
            spectrumLoading={spectrumLoading}
            viewMode={viewMode}
            setViewMode={setViewMode}
            spectrumZoom={spectrumZoom}
            setSpectrumZoom={setSpectrumZoom}
            removeFrequencyBand={removeFrequencyBand}
            bandLowHz={bandLowHz}
            bandHighHz={bandHighHz}
            setBandLowHz={setBandLowHz}
            setBandHighHz={setBandHighHz}
          />

          <AudioWavePanel
            title="Output"
            audioUrl={outputAsset.audioUrl}
            waveData={outputAsset.waveData}
            duration={outputAsset.duration}
            selection={outputAsset.duration > 0 ? {
              start: Math.min(selection.start, outputAsset.duration),
              end: Math.min(selection.end, outputAsset.duration),
            } : null}
            setSelection={null}
            playhead={outputPlayhead}
            setPlayhead={setOutputPlayhead}
            audioRef={outputAudioRef}
            accentColor="#8b4ea3"
            footer={outputResult ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <SaveToLibraryButton
                  filename={outputResult.filename}
                  displayName={outputResult.filename}
                  onSaveToLibrary={onSaveToLibrary}
                  style={{ fontSize: 12, padding: "6px 12px" }}
                />
                <a
                  href={`${API_BASE}/download/${outputResult.filename}`}
                  download={outputResult.filename}
                  className="btn-ghost"
                  style={{ textDecoration: "none", fontSize: 12, padding: "6px 12px" }}
                >
                  Download
                </a>
                {onAddToWorkshop && (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={addOutputToWorkshop}
                    style={{ fontSize: 12, padding: "6px 12px" }}
                  >
                    Add to Workshop
                  </button>
                )}
              </div>
            ) : null}
          />
        </div>
      </div>
    </div>
  );
}
