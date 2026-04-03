import { useEffect, useMemo, useState } from "react";
import { DropZone, JobStatus, ResultsPanel, UploadedAudioPreview } from "./Shared";
import { useJob } from "../useJob";

const STEM_GROUPS = [
  {
    key: "2",
    label: "2-Stem Fast Lane",
    desc: "Best when you only want vocals or the full backing track.",
    stems: [
      { value: "vocals", label: "Vocals", icon: "🎤" },
      { value: "no_vocals", label: "Backing", icon: "🎼" },
    ],
  },
  {
    key: "4",
    label: "4-Stem Band Split",
    desc: "Use this for core band layers like drums and bass.",
    stems: [
      { value: "drums", label: "Drums", icon: "🥁" },
      { value: "bass", label: "Bass", icon: "🎸" },
      { value: "other", label: "Other", icon: "🎻" },
    ],
  },
  {
    key: "6",
    label: "6-Stem Extended",
    desc: "Needed for guitar and piano. Slowest, highest effort.",
    stems: [
      { value: "guitar", label: "Guitar", icon: "🎵" },
      { value: "piano", label: "Piano", icon: "🎹" },
    ],
  },
];

const STEM_META = Object.fromEntries(
  STEM_GROUPS.flatMap((group) =>
    group.stems.map((stem) => [stem.value, { ...stem, group: group.key }])
  )
);

const QUALITY_OPTIONS = [
  {
    value: "fast",
    label: "Fast",
    desc: "Default. Uses the lightest local model path available for your selected targets.",
  },
  {
    value: "best",
    label: "Best Quality",
    desc: "Slower, but cleaner separation for difficult mixes.",
  },
];

const displayStemLabel = (value) => STEM_META[value]?.label || value.replace(/_/g, " ");

const normalizeResultKey = (label) => label.trim().toLowerCase().replace(/\s+/g, "_");

export default function StemSeparator({ onAddToWorkshop }) {
  const [file, setFile] = useState(null);
  const [quality, setQuality] = useState("fast");
  const [requestedStems, setRequestedStems] = useState([]);
  const [collectedResults, setCollectedResults] = useState([]);
  const { status, progress, results, error, submit, reset } = useJob({
    jobKey: "stem",
    label: "Stem Separator",
  });

  const extractedKeys = useMemo(
    () => new Set(collectedResults.map((result) => normalizeResultKey(result.label))),
    [collectedResults]
  );

  useEffect(() => {
    setCollectedResults([]);
    setRequestedStems([]);
    reset();
  }, [file, reset]);

  useEffect(() => {
    if (status !== "done" || results.length === 0) return;
    setCollectedResults((prev) => {
      const next = [...prev];
      results.forEach((result) => {
        const key = normalizeResultKey(result.label);
        const index = next.findIndex((item) => normalizeResultKey(item.label) === key);
        if (index >= 0) next[index] = result;
        else next.push(result);
      });
      return next;
    });
    setRequestedStems([]);
  }, [status, results]);

  const selectableStems = useMemo(
    () =>
      STEM_GROUPS.map((group) => ({
        ...group,
        stems: group.stems.map((stem) => ({
          ...stem,
          disabled:
            extractedKeys.has(stem.value) ||
            (stem.value === "no_vocals" && requestedStems.some((item) => ["drums", "bass", "other", "guitar", "piano"].includes(item))) ||
            (stem.value !== "vocals" && stem.value !== "no_vocals" && requestedStems.includes("no_vocals")),
          selected: requestedStems.includes(stem.value),
        })),
      })),
    [extractedKeys, requestedStems]
  );

  const requiredFamily = useMemo(() => {
    if (requestedStems.some((stem) => ["guitar", "piano"].includes(stem))) return "6";
    if (requestedStems.some((stem) => ["drums", "bass", "other"].includes(stem))) return "4";
    return requestedStems.length > 0 ? "2" : null;
  }, [requestedStems]);

  const sixStemRequired = requiredFamily === "6";

  useEffect(() => {
    if (sixStemRequired) {
      setQuality("best");
    }
  }, [sixStemRequired]);

  const toggleStem = (stem) => {
    if (extractedKeys.has(stem)) return;
    setRequestedStems((prev) =>
      prev.includes(stem) ? prev.filter((item) => item !== stem) : [...prev, stem]
    );
  };

  const handleSubmit = () => {
    if (!file || requestedStems.length === 0) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("engine", "demucs");
    fd.append("quality", quality);
    fd.append("target_stems", requestedStems.join(","));
    if (requiredFamily) fd.append("stems", requiredFamily);
    submit("/api/stem-separate", fd);
  };

  const clearExtracted = () => {
    setCollectedResults([]);
    setRequestedStems([]);
    reset();
  };

  const buttonLabel =
    requestedStems.length === 0
      ? "Choose stem(s) to extract"
      : requestedStems.length === 1
        ? `Extract ${displayStemLabel(requestedStems[0])}`
        : `Extract ${requestedStems.length} Stems`;

  return (
    <div className="tool-card">
      <div className="tool-header">
        <h2 className="tool-title">Stem Separator</h2>
        <p className="tool-subtitle">
          Choose only the stems you want, and keep building a custom stem set without re-extracting the ones you already have.
        </p>
      </div>

      <div className="section">
        <p className="section-label">Upload Audio</p>
        <DropZone onFile={setFile} label="Drop your song here" />
        <UploadedAudioPreview file={file} label="Preview Upload" />
      </div>

      <div className="section">
        <p className="section-label">Choose Stems To Extract</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {selectableStems.map((group) => (
            <div
              key={group.key}
              style={{
                padding: "14px 16px",
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--bg3)",
              }}
            >
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", marginBottom: 4 }}>
                  {group.label}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                  {group.desc}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {group.stems.map((stem) => {
                  const disabled = stem.disabled;
                  const active = stem.selected;
                  return (
                    <button
                      key={stem.value}
                      type="button"
                      onClick={() => toggleStem(stem.value)}
                      disabled={disabled}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 999,
                        border: `1px solid ${active ? "rgba(201,125,58,0.45)" : "var(--border)"}`,
                        background: active ? "rgba(201,125,58,0.1)" : "rgba(255,255,255,0.03)",
                        color: disabled ? "var(--muted)" : active ? "var(--accent)" : "var(--text)",
                        cursor: disabled ? "not-allowed" : "pointer",
                        opacity: disabled ? 0.55 : 1,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {stem.icon} {stem.label}{disabled ? " ✓" : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(201,125,58,0.06)", borderRadius: 8, border: "1px solid rgba(201,125,58,0.15)" }}>
          <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
            <strong style={{ color: "var(--text)" }}>Current request:</strong>{" "}
            {requestedStems.length > 0 ? requestedStems.map(displayStemLabel).join(", ") : "Nothing selected yet."}
            {requiredFamily && (
              <>
                {" "}This selection uses the <strong style={{ color: "var(--text)" }}>{requiredFamily}-stem</strong> extraction path.
              </>
            )}
            {requestedStems.includes("no_vocals") && (
              <>
                {" "}Backing can be combined with Vocals, but not with individual band stems.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="section">
        <p className="section-label">Processing Speed</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {QUALITY_OPTIONS.map((opt) => {
            const disabled = sixStemRequired && opt.value === "fast";
            const active = quality === opt.value || (sixStemRequired && opt.value === "best");
            return (
              <label
                key={opt.value}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: `1px solid ${active ? "rgba(201,125,58,0.45)" : "var(--border)"}`,
                  background: active ? "rgba(201,125,58,0.06)" : "var(--bg3)",
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.55 : 1,
                }}
              >
                <input
                  type="radio"
                  name="quality"
                  value={opt.value}
                  checked={active}
                  disabled={disabled}
                  onChange={() => setQuality(opt.value)}
                  style={{ marginTop: 2, accentColor: "var(--accent)" }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: active ? "var(--accent)" : "var(--text)" }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                    {disabled ? "Selections that include guitar or piano use the 6-source model." : opt.desc}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          className="btn-primary"
          title="Extract only the selected stems"
          onClick={handleSubmit}
          disabled={!file || requestedStems.length === 0 || status === "processing"}
        >
          {status === "processing" ? "Extracting stems…" : `⟁ ${buttonLabel}`}
        </button>
        {collectedResults.length > 0 && (
          <button
            className="btn-ghost"
            type="button"
            onClick={clearExtracted}
          >
            Clear extracted stems
          </button>
        )}
      </div>

      <JobStatus
        status={status}
        progress={progress}
        results={[]}
        error={error}
        onAddToWorkshop={onAddToWorkshop}
      />

      <ResultsPanel
        results={collectedResults}
        onAddToWorkshop={onAddToWorkshop}
        title="✓ Extracted Stems"
      />
    </div>
  );
}
