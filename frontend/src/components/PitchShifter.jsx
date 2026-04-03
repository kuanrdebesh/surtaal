import { useState } from "react";
import { DropZone, JobStatus, FormatPicker, UploadedAudioPreview } from "./Shared";
import { useJob } from "../useJob";

const API = "http://localhost:8000";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SWARA_NAMES = ["Sa", "Re♭", "Re", "Ga♭", "Ga", "Ma", "Ma#", "Pa", "Dha♭", "Dha", "Ni♭", "Ni"];

function transposeKey(key, semitones) {
  const idx = NOTE_NAMES.indexOf(key);
  if (idx === -1) return key;
  return NOTE_NAMES[((idx + semitones) % 12 + 12) % 12];
}

function toSwara(key) {
  const idx = NOTE_NAMES.indexOf(key);
  return idx >= 0 ? SWARA_NAMES[idx] : key;
}

function KeyBadge({ keyName, mode, label, dim }) {
  return (
    <div style={{ textAlign: "center", opacity: dim ? 0.45 : 1, transition: "opacity 0.3s" }}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
      <div style={{
        background: dim ? "var(--bg3)" : "linear-gradient(135deg, rgba(201,125,58,0.18), rgba(139,78,163,0.12))",
        border: `1px solid ${dim ? "var(--border)" : "rgba(201,125,58,0.35)"}`,
        borderRadius: 10, padding: "10px 18px", display: "inline-block", minWidth: 90,
      }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: dim ? "var(--muted)" : "var(--accent)" }}>
          {keyName}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
          {mode} · {toSwara(keyName)}
        </div>
      </div>
    </div>
  );
}

export default function PitchShifter() {
  const [file, setFile] = useState(null);
  const [semitones, setSemitones] = useState(0);
  const [cents, setCents] = useState(0);
  const [format, setFormat] = useState("mp3");
  const [detectedKey, setDetectedKey] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const { status, progress, results, error, submit, downloadUrl } = useJob({
    jobKey: "pitch",
    label: "Pitch Shift",
  });

  const totalSemitones = semitones + cents / 100;
  const noChange = semitones === 0 && cents === 0;

  const detectKey = async (f) => {
    if (!f) return;
    setDetecting(true);
    setDetectedKey(null);
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await fetch(`${API}/api/detect-key`, { method: "POST", body: fd });
      const data = await res.json();
      setDetectedKey(data);
    } catch {
      setDetectedKey({ key: "?", mode: "unknown", confidence: 0 });
    } finally {
      setDetecting(false);
    }
  };

  const handleFile = (f) => { setFile(f); detectKey(f); };

  const handleSubmit = () => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("semitones", totalSemitones);
    fd.append("output_format", format);
    submit("/api/pitch-shift", fd);
  };

  const newKey = detectedKey && detectedKey.key !== "?" ? transposeKey(detectedKey.key, semitones) : "—";

  return (
    <div className="tool-card">
      <div className="tool-header">
        <h2 className="tool-title">Pitch Shift</h2>
        <p className="tool-subtitle">
          Change the key of any backing track to match your voice — without changing the tempo or feel of the song.
        </p>
      </div>

      <div className="section">
        <p className="section-label">Upload Audio</p>
        <DropZone onFile={handleFile} label="Drop a track — key will be detected automatically" />
        <UploadedAudioPreview file={file} label="Preview Upload" />
        {detecting && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, color: "var(--muted)", fontSize: 13 }}>
            <div className="spinner" style={{ width: 14, height: 14 }} /> Detecting key…
          </div>
        )}
      </div>

      <div className="section">
        <p className="section-label">Key</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, padding: "8px 0" }}>
          <KeyBadge keyName={detectedKey?.key || "—"} mode={detectedKey?.mode || ""} label="Original Key" dim={!detectedKey || detectedKey.key === "?"} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, color: "var(--muted)" }}>→</div>
            {!noChange && (
              <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 2, fontFamily: "'DM Mono', monospace" }}>
                {semitones > 0 ? "+" : ""}{semitones}st {cents !== 0 ? `${cents > 0 ? "+" : ""}${cents}¢` : ""}
              </div>
            )}
          </div>
          <KeyBadge keyName={detectedKey && !noChange ? newKey : "—"} mode={detectedKey?.mode || ""} label="New Key" dim={!detectedKey || noChange} />
        </div>
        {detectedKey && detectedKey.confidence > 0 && (
          <p style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", marginTop: 6 }}>
            Key confidence: {Math.round(detectedKey.confidence * 100)}%
            {detectedKey.confidence < 0.5 && " — low, result may vary"}
          </p>
        )}
      </div>

      <div className="section">
        <p className="section-label">Pitch Adjustment</p>

        <div className="form-group" style={{ marginBottom: 20 }}>
          <label>Semitones (coarse) &nbsp;
            <span style={{ color: "var(--accent)", fontFamily: "'DM Mono', monospace", fontSize: 13 }}>
              {semitones > 0 ? "+" : ""}{semitones} st
            </span>
          </label>
          <div className="range-row">
            <input type="range" min="-12" max="12" step="1" value={semitones}
              onChange={(e) => setSemitones(Number(e.target.value))} />
            <input type="number" min="-12" max="12" value={semitones}
              onChange={(e) => setSemitones(Math.max(-12, Math.min(12, Number(e.target.value))))}
              style={{ width: 56, textAlign: "center" }} />
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 20 }}>
          <label>Cents (fine-tune) &nbsp;
            <span style={{ color: "var(--accent2)", fontFamily: "'DM Mono', monospace", fontSize: 13 }}>
              {cents > 0 ? "+" : ""}{cents} ¢
            </span>
          </label>
          <div className="range-row">
            <input type="range" min="-100" max="100" step="1" value={cents}
              onChange={(e) => setCents(Number(e.target.value))} />
            <input type="number" min="-100" max="100" value={cents}
              onChange={(e) => setCents(Math.max(-100, Math.min(100, Number(e.target.value))))}
              style={{ width: 56, textAlign: "center" }} />
          </div>
          <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            100 cents = 1 semitone. Use for shruti micro-tonal fine-tuning.
          </p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Quick Intervals</p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[{label:"−1 oct",st:-12},{label:"−5th",st:-7},{label:"−4th",st:-5},{label:"0",st:0},{label:"+4th",st:5},{label:"+5th",st:7},{label:"+1 oct",st:12}].map(({ label, st }) => (
              <button key={st} className="btn-ghost"
                onClick={() => { setSemitones(st); setCents(0); }} title={`Jump to ${label} interval`}
                style={{ padding:"5px 11px", fontSize:12, borderColor: semitones===st&&cents===0 ? "var(--accent)" : undefined, color: semitones===st&&cents===0 ? "var(--accent)" : undefined }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {!noChange && (
          <button className="btn-ghost" title="Reset pitch to original key" style={{ fontSize:12, padding:"5px 12px", marginBottom: 16 }}
            onClick={() => { setSemitones(0); setCents(0); }}>
            ↺ Reset to original
          </button>
        )}

        <FormatPicker value={format} onChange={setFormat} />

        <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(201,125,58,0.06)", borderRadius: 8, border: "1px solid rgba(201,125,58,0.15)" }}>
          <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
            💡 <strong style={{ color: "var(--text)" }}>Shruti tip:</strong> Indian classical music uses microtones between Western semitones. If a track sounds slightly sharp or flat, use cents (try ±20–50¢) for precise shruti matching.
          </p>
        </div>
      </div>

      <button className="btn-primary" title="Apply pitch shift and export" onClick={handleSubmit} disabled={!file || status === "processing" || noChange}>
        {status === "processing" ? "Shifting pitch…" : "♯ Apply Pitch Shift"}
      </button>
      {noChange && file && <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Adjust semitones or cents to enable processing.</p>}

      <JobStatus status={status} progress={progress} results={results} error={error} downloadUrl={downloadUrl} />
    </div>
  );
}
