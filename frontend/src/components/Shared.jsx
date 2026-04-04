import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../config";

// ── FILE DROP ZONE ─────────────────────────────────────────────────────────

export function DropZone({ onFile, accept = "audio/*", label = "Drop audio file here" }) {
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState(null);

  const handleChange = (e) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); onFile(f); }
  };

  return (
    <div
      className={`dropzone ${drag ? "dragover" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) { setFile(f); onFile(f); }
      }}
    >
      <input type="file" accept={accept} onChange={handleChange} />
      <span className="drop-icon">🎵</span>
      <p className="drop-title">{label}</p>
      <p className="drop-hint">MP3, WAV, FLAC, M4A supported</p>
      {file && (
        <div className="file-selected">
          ✓ {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
        </div>
      )}
    </div>
  );
}

// ── AUDIO PREVIEW PLAYER ───────────────────────────────────────────────────
// Shown inline next to every result — plays directly in browser

export function AudioPreview({ filename, label, audioRef, onInteracted }) {
  const url = `${API_BASE}/download/${filename}`;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        src={url}
        aria-label={`${label} preview`}
        onPlay={onInteracted}
        onSeeked={onInteracted}
        style={{ flex: 1, minWidth: 0, height: 36 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
        <a href={url} download={filename} style={{
          fontSize: 11, padding: "4px 10px",
          background: "rgba(201,125,58,0.1)", border: "1px solid rgba(201,125,58,0.3)",
          borderRadius: 6, color: "var(--accent)", textDecoration: "none", textAlign: "center",
        }}>↓</a>
      </div>
    </div>
  );
}

export function UploadedAudioPreview({ file, label = "Uploaded Track" }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!file || !url) return null;

  return (
    <div
      className="section"
      style={{ marginTop: 14, padding: "12px 14px" }}
    >
      <p className="section-label" style={{ marginBottom: 10 }}>{label}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <audio
          controls
          preload="metadata"
          src={url}
          style={{ width: "100%", height: 40 }}
        />
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {file.name}
        </div>
      </div>
    </div>
  );
}

// ── JOB STATUS ────────────────────────────────────────────────────────────

export function ResultsPanel({ results, onAddToWorkshop, title = "✓ Ready" }) {
  const [selected, setSelected] = useState({});
  const [importing, setImporting] = useState(false);
  const [playingSelected, setPlayingSelected] = useState(false);
  const [anchorFilename, setAnchorFilename] = useState(null);
  const audioRefs = useRef({});

  useEffect(() => {
    if (results.length > 0) {
      setSelected(Object.fromEntries(results.map((r) => [r.filename, true])));
      setAnchorFilename(results[0].filename);
    } else {
      setSelected({});
      setAnchorFilename(null);
    }
    setImporting(false);
    setPlayingSelected(false);
  }, [results]);

  if (!results.length) return null;

  const selectable = !!onAddToWorkshop;
  const selectedResults = results.filter((r) => selected[r.filename]);
  const allSelected = results.length > 0 && selectedResults.length === results.length;

  const toggleSelected = (filename) => {
    setSelected((prev) => ({ ...prev, [filename]: !prev[filename] }));
  };

  const setAllSelected = (value) => {
    setSelected(Object.fromEntries(results.map((r) => [r.filename, value])));
  };

  const addSelectedToWorkshop = async () => {
    if (!onAddToWorkshop || selectedResults.length === 0 || importing) return;
    setImporting(true);
    try {
      await onAddToWorkshop(selectedResults);
    } finally {
      setImporting(false);
    }
  };

  const selectedAudioEls = selectedResults
    .map((result) => audioRefs.current[result.filename])
    .filter(Boolean);

  const playSelected = async () => {
    if (selectedAudioEls.length === 0) return;
    const anchorAudio = (anchorFilename && audioRefs.current[anchorFilename] && selected[anchorFilename])
      ? audioRefs.current[anchorFilename]
      : selectedAudioEls[0];
    const anchorTime = anchorAudio?.currentTime || 0;
    selectedAudioEls.forEach((audio) => {
      audio.currentTime = anchorTime;
    });
    try {
      await Promise.all(selectedAudioEls.map((audio) => audio.play()));
      setPlayingSelected(true);
    } catch (error) {
      console.error("Could not play selected previews together", error);
    }
  };

  const pauseSelected = () => {
    selectedAudioEls.forEach((audio) => audio.pause());
    setPlayingSelected(false);
  };

  return (
    <div className="status-box" style={{ marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap" }}>
        <p className="section-label" style={{ marginBottom: 0 }}>{title}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn-ghost"
            type="button"
            disabled={selectedResults.length === 0}
            onClick={playingSelected ? pauseSelected : playSelected}
            style={{ fontSize: 11, padding: "5px 10px" }}
          >
            {playingSelected ? "Pause selected" : `Play ${selectedResults.length || ""} selected`}
          </button>
          {selectable && (
            <>
            <button
              className="btn-ghost"
              type="button"
              onClick={() => setAllSelected(!allSelected)}
              style={{ fontSize: 11, padding: "5px 10px" }}
            >
              {allSelected ? "Clear all" : "Select all"}
            </button>
            <button
              className="btn-primary"
              type="button"
              disabled={selectedResults.length === 0 || importing}
              onClick={addSelectedToWorkshop}
              style={{ fontSize: 11, padding: "5px 12px" }}
            >
              {importing ? "Adding…" : `Add ${selectedResults.length || ""} to Workshop`}
            </button>
            </>
          )}
        </div>
      </div>
      <div className="results-list">
        {results.map((r, i) => (
          <div key={i} className="result-item" style={{ flexDirection:"column", gap:8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
              <label className="result-label" style={{ display: "flex", alignItems: "center", gap: 8, cursor: selectable ? "pointer" : "default" }}>
                {selectable && (
                  <input
                    type="checkbox"
                    checked={!!selected[r.filename]}
                    onChange={() => toggleSelected(r.filename)}
                    style={{ accentColor: "var(--accent)" }}
                  />
                )}
                <span className="result-icon">🎧</span>
                {r.label}
              </label>
              {selectable && (
                <button
                  className="btn-ghost"
                  type="button"
                  onClick={() => onAddToWorkshop([r])}
                  style={{ fontSize: 11, padding: "5px 10px" }}
                >
                  Add to Workshop
                </button>
              )}
            </div>
            <AudioPreview
              filename={r.filename}
              label={r.label}
              onInteracted={() => setAnchorFilename(r.filename)}
              audioRef={(node) => {
                if (node) audioRefs.current[r.filename] = node;
                else delete audioRefs.current[r.filename];
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function JobStatus({ status, progress, results, error, downloadUrl, onAddToWorkshop, onDismiss }) {

  if (!status) return null;

  if (status === "error") {
    return (
      <div className="error-box" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span>⚠</span>
          <span style={{ minWidth: 0 }}>{error}</span>
        </div>
        {onDismiss && (
          <button
            type="button"
            className="btn-ghost"
            onClick={onDismiss}
            style={{ padding: "4px 10px", fontSize: 11, flexShrink: 0 }}
          >
            Dismiss
          </button>
        )}
      </div>
    );
  }

  if (status === "processing") {
    return (
      <div className="status-box">
        <div className="status-processing">
          <div className="spinner" />
          <span>Processing in background… you can keep using other tools.</span>
        </div>
        <div className="progress-bar-wrap">
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
    );
  }

  if (status === "done" && results.length > 0) {
    return <ResultsPanel results={results} onAddToWorkshop={onAddToWorkshop} />;
  }

  return null;
}

// ── FORMAT PICKER ─────────────────────────────────────────────────────────

export function FormatPicker({ value, onChange }) {
  return (
    <div className="form-group">
      <label>Output Format</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="mp3">MP3 (smaller, universal)</option>
        <option value="wav">WAV (lossless)</option>
      </select>
    </div>
  );
}
