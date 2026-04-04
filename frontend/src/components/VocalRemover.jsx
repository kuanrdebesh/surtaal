import { useState } from "react";
import { DropZone, JobStatus, UploadedAudioPreview } from "./Shared";
import { useJob } from "../useJob";

const QUALITY_OPTIONS = [
  {
    value: "fast",
    label: "Fast",
    desc: "Default. Uses a lighter single-model path with more aggressive speed settings for local karaoke generation.",
  },
  {
    value: "best",
    label: "Best Quality",
    desc: "Slower, but usually cleaner vocal suppression.",
  },
];

export default function VocalRemover({ onAddToWorkshop }) {
  const [file, setFile] = useState(null);
  const [quality, setQuality] = useState("fast");
  const { status, progress, results, error, submit, downloadUrl, reset } = useJob({
    jobKey: "vocal",
    label: "Vocal Remover",
  });

  const handleSubmit = () => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("quality", quality);
    submit("/api/vocal-remove", fd);
  };

  return (
    <div className="tool-card">
      <div className="tool-header">
        <h2 className="tool-title">Vocal Remover</h2>
        <p className="tool-subtitle">
          Remove vocals from any song to create a clean karaoke backing track. Perfect for practice sessions and live performances.
        </p>
      </div>

      <div className="section">
        <p className="section-label">Upload Song</p>
        <DropZone onFile={setFile} label="Drop the song you want karaoke for" />
        <UploadedAudioPreview file={file} label="Preview Upload" />
      </div>

      <div className="section" style={{ background: "rgba(139,78,163,0.06)", borderColor: "rgba(139,78,163,0.2)" }}>
        <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
          🎤 This uses AI-based source separation to isolate and remove the lead vocals. Results work best with professionally mixed studio recordings. Songs with heavy reverb or live recordings may retain some vocal trace.
        </p>
      </div>

      <div className="section">
        <p className="section-label">Processing Speed</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {QUALITY_OPTIONS.map((opt) => {
            const active = quality === opt.value;
            return (
              <label
                key={opt.value}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: `1px solid ${active ? "rgba(139,78,163,0.4)" : "var(--border)"}`,
                  background: active ? "rgba(139,78,163,0.08)" : "var(--bg3)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="vocal-quality"
                  value={opt.value}
                  checked={active}
                  onChange={() => setQuality(opt.value)}
                  style={{ marginTop: 2, accentColor: "var(--accent)" }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: active ? "var(--accent)" : "var(--text)" }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                    {opt.desc}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <button
        className="btn-primary"
        title="Remove vocals and generate karaoke backing track"
        onClick={handleSubmit}
        disabled={!file || status === "processing"}
      >
        {status === "processing" ? "Removing vocals…" : "♬ Remove Vocals"}
      </button>

      <JobStatus
        status={status}
        progress={progress}
        results={results}
        error={error}
        downloadUrl={downloadUrl}
        onAddToWorkshop={onAddToWorkshop}
        onDismiss={reset}
      />
    </div>
  );
}
