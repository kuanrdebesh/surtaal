import { useState, useRef } from "react";
import { JobStatus, FormatPicker } from "./Shared";
import { useJob } from "../useJob";

export default function MedleyBuilder() {
  const [files, setFiles] = useState([]);
  const [fadeMs, setFadeMs] = useState(2000);
  const [crossfade, setCrossfade] = useState(true);
  const [format, setFormat] = useState("mp3");
  const inputRef = useRef();
  const { status, progress, results, error, submit, downloadUrl, reset } = useJob();

  const addFiles = (newFiles) => {
    const arr = Array.from(newFiles).map((f) => ({ file: f, id: Math.random().toString(36).slice(2) }));
    setFiles((prev) => [...prev, ...arr]);
  };

  const removeFile = (id) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const moveUp = (i) => {
    if (i === 0) return;
    setFiles((prev) => {
      const arr = [...prev];
      [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      return arr;
    });
  };

  const moveDown = (i) => {
    setFiles((prev) => {
      if (i === prev.length - 1) return prev;
      const arr = [...prev];
      [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
      return arr;
    });
  };

  const handleSubmit = () => {
    if (files.length < 2) return;
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f.file));
    fd.append("fade_duration", fadeMs / 1000);
    fd.append("crossfade", crossfade);
    fd.append("output_format", format);
    submit("/api/stitch", fd);
  };

  return (
    <div className="tool-card">
      <div className="tool-header">
        <h2 className="tool-title">Medley Builder</h2>
        <p className="tool-subtitle">
          Arrange multiple songs into a seamless medley with crossfades and transitions — perfect for talent shows and stage performances.
        </p>
      </div>

      <div className="section">
        <p className="section-label">Song Lineup</p>

        <div
          className="dropzone"
          style={{ padding: "20px 24px" }}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        >
          <input
            type="file"
            accept="audio/*"
            multiple
            ref={inputRef}
            style={{ display: "none" }}
            onChange={(e) => addFiles(e.target.files)}
          />
          <span className="drop-icon" style={{ fontSize: 24 }}>⊕</span>
          <p className="drop-title" style={{ fontSize: 13 }}>Click or drop songs to add to the lineup</p>
          <p className="drop-hint">You can add multiple files at once</p>
        </div>

        {files.length > 0 && (
          <div className="file-list" style={{ marginTop: 14 }}>
            {files.map((f, i) => (
              <div key={f.id} className="file-list-item">
                <span style={{ color: "var(--accent)", fontSize: 11, fontWeight: 600, minWidth: 20 }}>
                  {i + 1}
                </span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.file.name}
                </span>
                <span style={{ color: "var(--muted)", fontSize: 11 }}>
                  {(f.file.size / 1024 / 1024).toFixed(1)}MB
                </span>
                <div style={{ display: "flex", gap: 2 }}>
                  <button
                    className="remove-btn"
                    onClick={() => moveUp(i)}
                    title="Move up"
                    style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: "2px 5px" }}
                  >↑</button>
                  <button
                    className="remove-btn"
                    onClick={() => moveDown(i)}
                    title="Move down"
                    style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: "2px 5px" }}
                  >↓</button>
                  <button className="remove-btn" onClick={() => removeFile(f.id)} title="Remove">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {files.length < 2 && (
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
            Add at least 2 songs to build a medley.
          </p>
        )}
      </div>

      <div className="section">
        <p className="section-label">Transition Settings</p>

        <div className="form-group" style={{ marginBottom: 16 }}>
          <label>Fade / Crossfade Duration</label>
          <div className="range-row">
            <input
              type="range"
              min="0"
              max="6000"
              step="500"
              value={fadeMs}
              onChange={(e) => setFadeMs(Number(e.target.value))}
            />
            <span className="range-value">{(fadeMs / 1000).toFixed(1)}s</span>
          </div>
        </div>

        <div className="toggle-row">
          <label className="toggle">
            <input
              type="checkbox"
              checked={crossfade}
              onChange={(e) => setCrossfade(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
          <span>Crossfade (songs overlap during transition)</span>
        </div>

        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>
          {crossfade
            ? "✓ Crossfade: end of one song fades out while next fades in — smooth DJ-style transition"
            : "Sequential: each song ends, then next begins with fade-in"}
        </p>

        <div style={{ marginTop: 16 }}>
          <FormatPicker value={format} onChange={setFormat} />
        </div>
      </div>

      <button
        className="btn-primary"
        onClick={handleSubmit}
        disabled={files.length < 2 || status === "processing"}
      >
        {status === "processing" ? "Building medley…" : `⊕ Build Medley (${files.length} songs)`}
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
