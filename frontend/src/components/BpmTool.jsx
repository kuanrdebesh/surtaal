import { useState } from "react";
import { DropZone, JobStatus, FormatPicker, UploadedAudioPreview, LibraryPickerButton } from "./Shared";
import { API_BASE } from "../config";
import { useJob } from "../useJob";

function BpmBadge({ value, label, dim, accent = "var(--accent)" }) {
  return (
    <div style={{ textAlign: "center", opacity: dim ? 0.45 : 1, transition: "opacity 0.3s" }}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
      <div style={{
        background: dim ? "var(--bg3)" : "rgba(201,125,58,0.12)",
        border: `1px solid ${dim ? "var(--border)" : "rgba(201,125,58,0.35)"}`,
        borderRadius: 10,
        padding: "10px 18px",
        display: "inline-block",
        minWidth: 96,
      }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: dim ? "var(--muted)" : accent }}>
          {value ?? "—"}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
          BPM
        </div>
      </div>
    </div>
  );
}

export default function BpmTool({ libraryItems, onSaveToLibrary }) {
  const [file, setFile] = useState(null);
  const [detectedBpm, setDetectedBpm] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [factor, setFactor] = useState(1.0);
  const [format, setFormat] = useState("mp3");
  const { status, progress, results, error, submit, downloadUrl, reset } = useJob({
    jobKey: "bpm",
    label: "BPM & Tempo",
  });

  const detectBpm = async () => {
    if (!file) return;
    setDetecting(true);
    setDetectedBpm(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/api/detect-bpm`, { method: "POST", body: fd });
      const data = await res.json();
      setDetectedBpm(data.bpm);
    } catch {
      setDetectedBpm("Error");
    } finally {
      setDetecting(false);
    }
  };

  const handleTempo = () => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("factor", factor);
    fd.append("output_format", format);
    if (targetBpm) fd.append("target_bpm", String(targetBpm));
    submit("/api/tempo-change", fd);
  };

  const targetBpm = detectedBpm ? Math.round(detectedBpm * factor) : null;
  const pctChange = Math.round((factor - 1) * 100);
  const previewBpm = detectedBpm && factor !== 1 ? targetBpm : null;

  return (
    <div className="tool-card">
      <div className="tool-header">
        <h2 className="tool-title">BPM & Tempo</h2>
        <p className="tool-subtitle">
          Detect the beat of any track, then speed it up or slow it down while preserving the pitch — great for matching taal to your practice speed.
        </p>
      </div>

      <div className="section">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <p className="section-label" style={{ marginBottom: 0 }}>Upload Audio</p>
          <LibraryPickerButton onPickFile={(f) => { setFile(f); setDetectedBpm(null); }} libraryItems={libraryItems} />
        </div>
        <DropZone onFile={(f) => { setFile(f); setDetectedBpm(null); }} label="Drop the track to analyze" />
        <UploadedAudioPreview file={file} label="Preview Upload" />
      </div>

      {/* BPM Detection */}
      <div className="section">
        <p className="section-label">Beat Detection</p>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button
            className="btn-primary"
            title="Analyse the track and detect beats per minute"
            onClick={detectBpm}
            disabled={!file || detecting}
            style={{ flex: "0 0 auto" }}
          >
            {detecting ? "Analyzing…" : "◈ Detect BPM"}
          </button>
          {detecting && <div className="spinner" />}
        </div>

        {detectedBpm && detectedBpm !== "Error" && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, padding: "8px 0", flexWrap: "wrap" }}>
            <BpmBadge value={Math.round(detectedBpm)} label="Original BPM" dim={false} accent="var(--accent)" />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, color: "var(--muted)" }}>→</div>
              {factor !== 1 && (
                <div style={{ fontSize: 11, color: "#3a8bc9", marginTop: 2, fontFamily: "'DM Mono', monospace" }}>
                  {pctChange > 0 ? "+" : ""}{pctChange}%
                </div>
              )}
            </div>
            <BpmBadge value={previewBpm ?? "—"} label="New BPM" dim={!previewBpm} accent="#3a8bc9" />
          </div>
        )}
        {detectedBpm === "Error" && (
          <p style={{ color: "var(--error)", marginTop: 10, fontSize: 13 }}>Could not detect BPM. Try a cleaner track.</p>
        )}
      </div>

      {/* Tempo Change */}
      <div className="section">
        <p className="section-label">Tempo Adjustment</p>
        <div className="form-group">
          <label>Speed Factor</label>
          <div className="range-row">
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.05"
              value={factor}
              onChange={(e) => setFactor(Number(e.target.value))}
            />
            <span className="range-value">×{factor.toFixed(2)}</span>
          </div>
          <p style={{ fontSize: 12, color: "var(--accent)", marginTop: 6 }}>
            {factor === 1 ? "No change" : factor > 1
              ? `${pctChange}% faster`
              : `${Math.abs(pctChange)}% slower`}
          </p>
        </div>

        {/* Quick presets */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {[0.75, 0.9, 1.0, 1.1, 1.25].map(f => (
            <button
              key={f}
              className="btn-ghost"
              onClick={() => setFactor(f)} title={f === 1 ? 'Original speed' : `Set speed to ${f}x`}
              style={{ padding: "5px 12px", fontSize: 12, borderColor: factor === f ? "var(--accent)" : undefined, color: factor === f ? "var(--accent)" : undefined }}
            >
              {f === 1 ? "Original" : `×${f}`}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 16 }}>
          <FormatPicker value={format} onChange={setFormat} />
        </div>
      </div>

      <button
        className="btn-primary"
        title="Apply tempo change and export"
        onClick={handleTempo}
        disabled={!file || status === "processing" || factor === 1}
      >
        {status === "processing" ? "Adjusting tempo…" : "◈ Apply Tempo Change"}
      </button>

      <JobStatus
        status={status}
        progress={progress}
        results={results}
        error={error}
        downloadUrl={downloadUrl}
        onDismiss={reset}
        onSaveToLibrary={onSaveToLibrary}
      />
    </div>
  );
}
