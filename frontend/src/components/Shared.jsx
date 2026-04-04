import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../config";

async function fetchLibraryItems() {
  const response = await fetch(`${API_BASE}/api/library`);
  if (!response.ok) throw new Error("Could not load library");
  const data = await response.json();
  return data.items || [];
}

async function deleteLibraryItem(itemId) {
  const fd = new FormData();
  fd.append("item_id", itemId);
  const response = await fetch(`${API_BASE}/api/library/delete`, {
    method: "POST",
    body: fd,
  });
  if (!response.ok) throw new Error("Could not delete library item");
  return response.json();
}

async function libraryItemToFile(item) {
  const response = await fetch(`${API_BASE}/download/${item.filename}`);
  if (!response.ok) throw new Error(`Could not load ${item.display_name || item.filename}`);
  const blob = await response.blob();
  return new File([blob], item.display_name || item.filename, {
    type: blob.type || "audio/mpeg",
  });
}

export async function saveExistingToLibrary(filename, displayName) {
  const fd = new FormData();
  fd.append("filename", filename);
  if (displayName) fd.append("display_name", displayName);
  const response = await fetch(`${API_BASE}/api/library/save-existing`, {
    method: "POST",
    body: fd,
  });
  if (!response.ok) throw new Error("Could not save to library");
  return response.json();
}

export async function saveFileToLibrary(file, displayName) {
  const fd = new FormData();
  fd.append("file", file);
  if (displayName) fd.append("display_name", displayName);
  const response = await fetch(`${API_BASE}/api/library/upload`, {
    method: "POST",
    body: fd,
  });
  if (!response.ok) throw new Error("Could not save file to library");
  return response.json();
}

// ── FILE DROP ZONE ─────────────────────────────────────────────────────────

export function DropZone({ onFile, accept = "audio/*", label = "Drop audio file here", compact = false }) {
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState(null);

  const handleChange = (e) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); onFile(f); }
  };

  return (
    <div
      className={`dropzone ${drag ? "dragover" : ""}`}
      style={compact ? { minHeight: 0, padding: "16px 14px" } : undefined}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) { setFile(f); onFile(f); }
      }}
    >
      <input type="file" accept={accept} onChange={handleChange} />
      <span className="drop-icon" style={compact ? { fontSize: 18, marginBottom: 6 } : undefined}>🎵</span>
      <p className="drop-title" style={compact ? { fontSize: 14, marginBottom: 4 } : undefined}>{label}</p>
      <p className="drop-hint" style={compact ? { fontSize: 11 } : undefined}>MP3, WAV, FLAC, M4A supported</p>
      {file && (
        <div className="file-selected" style={compact ? { marginTop: 10, fontSize: 11 } : undefined}>
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

function TextEntryModal({
  title,
  subtitle,
  initialValue = "",
  confirmLabel = "Save",
  onConfirm,
  onClose,
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef(null);

  useEffect(() => {
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, []);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    await onConfirm(trimmed);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(5, 8, 14, 0.66)",
        display: "grid",
        placeItems: "center",
        zIndex: 1100,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(440px, 100%)",
          borderRadius: 18,
          border: "1px solid var(--border)",
          background: "var(--bg2)",
          boxShadow: "var(--shadow-lg)",
          padding: 18,
          display: "grid",
          gap: 14,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 13, color: "var(--muted)" }}>{subtitle}</div>}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onClose?.();
          }}
          style={{
            width: "100%",
            background: "var(--bg3)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            color: "var(--text)",
            padding: "11px 12px",
            fontSize: 14,
            outline: "none",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn-ghost" onClick={onClose} style={{ padding: "6px 12px", fontSize: 12 }}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={submit} style={{ padding: "6px 12px", fontSize: 12 }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function LibraryModal({ mode = "pick", onPickFile, onClose, items: externalItems = null, onDeleteLibraryItem = null, onRenameLibraryItem = null }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pickingId, setPickingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [renameItemState, setRenameItemState] = useState(null);

  const refresh = () => {
    if (externalItems) {
      setItems(externalItems);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    fetchLibraryItems()
      .then((next) => setItems(next))
      .catch((err) => setError(err.message || "Could not load library"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, [externalItems]);

  const pickItem = async (item) => {
    if (!onPickFile) return;
    setPickingId(item.id);
    try {
      const file = externalItems ? item.file : await libraryItemToFile(item);
      await onPickFile(file, item);
      onClose?.();
    } catch (err) {
      setError(err.message || "Could not load selected audio");
    } finally {
      setPickingId(null);
    }
  };

  const removeItem = async (item) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${item.display_name || item.filename}" from the library?`)) return;
    setDeletingId(item.id);
    try {
      if (externalItems && onDeleteLibraryItem) {
        await onDeleteLibraryItem(item.id);
      } else {
        await deleteLibraryItem(item.id);
      }
      setItems((prev) => prev.filter((entry) => entry.id !== item.id));
    } catch (err) {
      setError(err.message || "Could not delete library item");
    } finally {
      setDeletingId(null);
    }
  };

  const renameItem = async (item, nextName) => {
    if (!onRenameLibraryItem) return;
    try {
      await onRenameLibraryItem(item.id, nextName);
      setItems((prev) => prev.map((entry) => (
        entry.id === item.id ? { ...entry, display_name: nextName } : entry
      )));
      setRenameItemState(null);
    } catch (err) {
      setError(err.message || "Could not rename library item");
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(5, 8, 14, 0.66)",
          display: "grid",
          placeItems: "center",
          zIndex: 1000,
          padding: 20,
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "min(760px, 100%)",
            maxHeight: "min(76vh, 760px)",
            overflow: "hidden",
            borderRadius: 18,
            border: "1px solid var(--border)",
            background: "var(--bg2)",
            boxShadow: "var(--shadow-lg)",
            display: "flex",
            flexDirection: "column",
          }}
        >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 18px", borderBottom: "1px solid var(--border)" }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
              Saved Library
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
              {mode === "pick"
                ? "Pick any saved audio and load it into the current tool."
                : "Review, load, and delete saved audio assets."}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn-ghost" onClick={refresh} style={{ padding: "5px 10px", fontSize: 11 }}>
              Refresh
            </button>
            <button type="button" className="btn-ghost" onClick={onClose} style={{ padding: "5px 10px", fontSize: 11 }}>
              Close
            </button>
          </div>
        </div>

        <div style={{ overflowY: "auto", padding: 16, display: "grid", gap: 10 }}>
          {loading && <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading library…</div>}
          {!loading && error && <div className="error-box">{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              Nothing saved yet. Save an output from any tool or from Workshop export first.
            </div>
          )}
          {!loading && !error && items.map((item) => (
            <div
              key={item.id}
              onClick={mode === "pick" && onPickFile ? () => pickItem(item) : undefined}
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--bg3)",
                color: "var(--text)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                cursor: mode === "pick" && onPickFile ? "pointer" : "default",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.display_name || item.filename}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {item.source_kind || "saved"} · {item.created_at ? new Date(item.created_at).toLocaleString() : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {onPickFile && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={(e) => { e.stopPropagation(); pickItem(item); }}
                    disabled={pickingId === item.id}
                    style={{ padding: "5px 10px", fontSize: 11 }}
                  >
                    {pickingId === item.id ? "Loading…" : "Use"}
                  </button>
                )}
                {mode === "manage" && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={(e) => { e.stopPropagation(); setRenameItemState(item); }}
                    style={{ padding: "5px 10px", fontSize: 11 }}
                  >
                    Rename
                  </button>
                )}
                {mode === "manage" && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={(e) => { e.stopPropagation(); removeItem(item); }}
                    disabled={deletingId === item.id}
                    style={{ padding: "5px 10px", fontSize: 11, color: deletingId === item.id ? "var(--muted)" : "var(--error)" }}
                  >
                    {deletingId === item.id ? "Deleting…" : "Delete"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        </div>
      </div>
      {renameItemState && (
        <TextEntryModal
          title="Rename Library Item"
          subtitle="Update the display name for this session library entry."
          initialValue={renameItemState.display_name || renameItemState.filename || "audio"}
          confirmLabel="Rename"
          onClose={() => setRenameItemState(null)}
          onConfirm={(nextName) => renameItem(renameItemState, nextName)}
        />
      )}
    </>
  );
}

export function LibraryPickerButton({ onPickFile, label = "From Library", className = "btn-ghost", style, libraryItems = null, disabled = false }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={(e) => {
          if (disabled) return;
          e.stopPropagation();
          setOpen(true);
        }}
        disabled={disabled}
        style={style}
      >
        {label}
      </button>
      {open && <LibraryModal mode="pick" items={libraryItems} onPickFile={onPickFile} onClose={() => setOpen(false)} />}
    </>
  );
}

export function LibraryManagerButton({ label = "Library", className = "help-button", style, onPickFile = null, libraryItems = null, onDeleteLibraryItem = null, onRenameLibraryItem = null }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} style={style}>
        {label}
      </button>
      {open && <LibraryModal mode="manage" items={libraryItems} onDeleteLibraryItem={onDeleteLibraryItem} onRenameLibraryItem={onRenameLibraryItem} onPickFile={onPickFile} onClose={() => setOpen(false)} />}
    </>
  );
}

export function SaveToLibraryButton({ filename, displayName, file, label = "Save to Library", className = "btn-ghost", style, promptForName = true, onSaveToLibrary = null }) {
  const [state, setState] = useState("idle");
  const [open, setOpen] = useState(false);

  const doSave = async (chosenName) => {
    if (state === "saving") return;
    setState("saving");
    try {
      if (onSaveToLibrary) {
        await onSaveToLibrary({ filename, displayName: chosenName, file });
      } else if (file) {
        await saveFileToLibrary(file, chosenName);
      } else if (filename) {
        await saveExistingToLibrary(filename, chosenName);
      }
      setState("saved");
      window.setTimeout(() => setState("idle"), 1800);
    } catch (error) {
      console.error("Could not save to library", error);
      setState("error");
      window.setTimeout(() => setState("idle"), 2200);
    }
  };

  const onSave = async () => {
    if (state === "saving") return;
    const chosenName = displayName || filename || file?.name || "audio";
    if (promptForName) {
      setOpen(true);
      return;
    }
    await doSave(chosenName);
  };

  const buttonLabel = state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Retry Save" : label;

  return (
    <>
      <button type="button" className={className} onClick={onSave} style={style}>
        {buttonLabel}
      </button>
      {open && (
        <TextEntryModal
          title="Save To Library"
          subtitle="Choose a name for this audio in the current session library."
          initialValue={displayName || filename || file?.name || "audio"}
          confirmLabel="Save"
          onClose={() => setOpen(false)}
          onConfirm={async (nextName) => {
            setOpen(false);
            await doSave(nextName);
          }}
        />
      )}
    </>
  );
}

// ── JOB STATUS ────────────────────────────────────────────────────────────

export function ResultsPanel({ results, onAddToWorkshop, title = "✓ Ready", onSaveToLibrary = null }) {
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

  const saveSelectedToLibrary = async () => {
    for (const result of selectedResults) {
      if (onSaveToLibrary) await onSaveToLibrary({ filename: result.filename, displayName: result.filename });
      else await saveExistingToLibrary(result.filename, result.filename);
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
            {onSaveToLibrary && (
              <button
                className="btn-ghost"
                type="button"
                disabled={selectedResults.length === 0}
                onClick={saveSelectedToLibrary}
                style={{ fontSize: 11, padding: "5px 10px" }}
              >
                Save {selectedResults.length || ""} to Library
              </button>
            )}
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
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <SaveToLibraryButton
                    filename={r.filename}
                    displayName={r.filename}
                    onSaveToLibrary={onSaveToLibrary}
                    style={{ fontSize: 11, padding: "5px 10px" }}
                  />
                  <button
                    className="btn-ghost"
                    type="button"
                    onClick={() => onAddToWorkshop([r])}
                    style={{ fontSize: 11, padding: "5px 10px" }}
                  >
                    Add to Workshop
                  </button>
                </div>
              )}
              {!selectable && (
                <SaveToLibraryButton
                  filename={r.filename}
                  displayName={r.filename}
                  onSaveToLibrary={onSaveToLibrary}
                  style={{ fontSize: 11, padding: "5px 10px" }}
                />
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

export function JobStatus({ status, progress, results, error, downloadUrl, onAddToWorkshop, onDismiss, onSaveToLibrary, onCancel, canceling = false }) {

  if (!status) return null;

  if (status === "error" || status === "cancelled") {
    return (
      <div className="error-box" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span>⚠</span>
          <span style={{ minWidth: 0 }}>{status === "cancelled" ? (error || "Operation cancelled.") : error}</span>
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
        <div className="status-processing" style={{ justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="spinner" />
            <span>{canceling ? "Cancelling current operation…" : "Processing in background… you can keep using other tools."}</span>
          </div>
          {onCancel && (
            <button
              type="button"
              className="btn-ghost"
              onClick={onCancel}
              disabled={canceling}
              style={{ padding: "4px 10px", fontSize: 11, flexShrink: 0 }}
            >
              {canceling ? "Cancelling…" : "Cancel"}
            </button>
          )}
        </div>
        <div className="progress-bar-wrap">
          <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
    );
  }

  if (status === "done" && results.length > 0) {
    return <ResultsPanel results={results} onAddToWorkshop={onAddToWorkshop} onSaveToLibrary={onSaveToLibrary} />;
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
