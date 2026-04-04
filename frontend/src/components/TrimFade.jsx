import { useState } from "react";
import { DropZone, JobStatus, FormatPicker } from "./Shared";
import { useJob } from "../useJob";

function timeToMs(min, sec) {
  return (parseInt(min) * 60 + parseInt(sec)) * 1000;
}

export default function TrimFade() {
  const [file, setFile] = useState(null);
  const [startMin, setStartMin] = useState(0);
  const [startSec, setStartSec] = useState(0);
  const [useEnd, setUseEnd] = useState(false);
  const [endMin, setEndMin] = useState(3);
  const [endSec, setEndSec] = useState(30);
  const [fadeInMs, setFadeInMs] = useState(500);
  const [fadeOutMs, setFadeOutMs] = useState(1000);
  const [format, setFormat] = useState("mp3");
  const { status, progress, results, error, submit, downloadUrl, reset } = useJob();

  const handleSubmit = () => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("start_ms", timeToMs(startMin, startSec));
    if (useEnd) fd.append("end_ms", timeToMs(endMin, endSec));
    fd.append("fade_in_ms", fadeInMs);
    fd.append("fade_out_ms", fadeOutMs);
    fd.append("output_format", format);
    submit("/api/trim-fade", fd);
  };

  const TimeInput = ({ minVal, secVal, onMin, onSec, label }) => (
    <div className="form-group">
      <label>{label}</label>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="number"
          min="0"
          max="99"
          value={minVal}
          onChange={(e) => onMin(e.target.value)}
          style={{ width: 64 }}
        />
        <span style={{ color: "var(--muted)" }}>m</span>
        <input
          type="number"
          min="0"
          max="59"
          value={secVal}
          onChange={(e) => onSec(e.target.value)}
          style={{ width: 64 }}
        />
        <span style={{ color: "var(--muted)" }}>s</span>
      </div>
    </div>
  );

  return (
    <div className="tool-card">
      <div className="tool-header">
        <h2 className="tool-title">Trim & Fade</h2>
        <p className="tool-subtitle">
          Cut a section of a song and add smooth fade in/out — great for extracting the antara, cutting intros, or preparing clips for a medley.
        </p>
      </div>

      <div className="section">
        <p className="section-label">Upload Audio</p>
        <DropZone onFile={setFile} label="Drop the track to trim" />
      </div>

      <div className="section">
        <p className="section-label">Trim Points</p>
        <div className="controls-grid">
          <TimeInput
            label="Start Time"
            minVal={startMin}
            secVal={startSec}
            onMin={setStartMin}
            onSec={setStartSec}
          />
          <div className="form-group">
            <label>End Point</label>
            <div className="toggle-row" style={{ marginBottom: 8 }}>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={useEnd}
                  onChange={(e) => setUseEnd(e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
              <span style={{ fontSize: 12 }}>{useEnd ? "Custom end time" : "Use full track"}</span>
            </div>
            {useEnd && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={endMin}
                  onChange={(e) => setEndMin(e.target.value)}
                  style={{ width: 64 }}
                />
                <span style={{ color: "var(--muted)" }}>m</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={endSec}
                  onChange={(e) => setEndSec(e.target.value)}
                  style={{ width: 64 }}
                />
                <span style={{ color: "var(--muted)" }}>s</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="section">
        <p className="section-label">Fade Settings</p>
        <div className="controls-grid">
          <div className="form-group">
            <label>Fade In Duration</label>
            <div className="range-row">
              <input
                type="range"
                min="0"
                max="5000"
                step="100"
                value={fadeInMs}
                onChange={(e) => setFadeInMs(Number(e.target.value))}
              />
              <span className="range-value">{(fadeInMs / 1000).toFixed(1)}s</span>
            </div>
          </div>
          <div className="form-group">
            <label>Fade Out Duration</label>
            <div className="range-row">
              <input
                type="range"
                min="0"
                max="5000"
                step="100"
                value={fadeOutMs}
                onChange={(e) => setFadeOutMs(Number(e.target.value))}
              />
              <span className="range-value">{(fadeOutMs / 1000).toFixed(1)}s</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <FormatPicker value={format} onChange={setFormat} />
        </div>
      </div>

      <button
        className="btn-primary"
        onClick={handleSubmit}
        disabled={!file || status === "processing"}
      >
        {status === "processing" ? "Processing…" : "◁▷ Trim & Export"}
      </button>

      <JobStatus
        status={status}
        progress={progress}
        results={results}
        error={error}
        downloadUrl={downloadUrl}
        onDismiss={reset}
      />
    </div>
  );
}
