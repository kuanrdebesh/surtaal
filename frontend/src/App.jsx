import { useEffect, useState } from "react";
import StemSeparator from "./components/StemSeparator";
import VocalRemover from "./components/VocalRemover";
import PitchShifter from "./components/PitchShifter";
import BpmTool from "./components/BpmTool";
import AudioCleanup from "./components/AudioCleanup";
import Workshop from "./components/Workshop";
import { mixer } from "./components/mixer";
import { LibraryManagerButton } from "./components/Shared";
import { API_BASE } from "./config";
import "./App.css";

const LOGO_SRC = "./surtaal-mark.svg";

const TOOLS = [
  { id: "stem",     label: "Stem Separator", icon: "⟁", desc: "Split into vocals & instruments" },
  { id: "vocal",    label: "Vocal Remover",  icon: "♬", desc: "Create karaoke backing tracks" },
  { id: "pitch",    label: "Pitch Shift",    icon: "♯", desc: "Change key without changing tempo" },
  { id: "bpm",      label: "BPM & Tempo",    icon: "◈", desc: "Detect & adjust track speed" },
  { id: "cleanup",  label: "Audio Enhancement",  icon: "✦", desc: "Clean, polish & add effects" },
  { id: "workshop", label: "Audio Workshop", icon: "◁▷", desc: "Trim, fade & build medleys" },
  { id: "help",     label: "How To Use",     icon: "?", desc: "Open the built-in guide" },
];

function initialToolFromUrl() {
  if (typeof window === "undefined") return "stem";
  const params = new URLSearchParams(window.location.search);
  const tool = params.get("tool");
  return TOOLS.some((item) => item.id === tool) ? tool : "stem";
}

// Per-tool state that survives tab switches
// Detect non-Chrome browsers
function isChrome() {
  const ua = navigator.userAgent;
  return /Chrome/.test(ua) && /Google Inc/.test(navigator.vendor);
}

const INITIAL_TOOL_STATE = {
  stem:  { file: null, results: [], status: null, progress: 0, error: null, stems: "2", engine: "demucs" },
  vocal: { file: null, results: [], status: null, progress: 0, error: null },
  pitch: { file: null, results: [], status: null, progress: 0, error: null, semitones: 0, cents: 0, format: "mp3", detectedKey: null },
  bpm:   { file: null, results: [], status: null, progress: 0, error: null, detectedBpm: null, factor: 1.0, format: "mp3" },
};

function initialTheme() {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem("surtaal-theme");
  return stored === "light" || stored === "dark" ? stored : "dark";
}

function initialSidebarCollapsed() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem("surtaal-sidebar-collapsed") === "true";
}

export default function App() {
  const [active, setActive] = useState(initialToolFromUrl);
  const [theme, setTheme] = useState(initialTheme);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);
  const [libraryItems, setLibraryItems] = useState([]);

  // Workshop tracks lifted to App level — survive tab switches
  const [showBrowserWarn, setShowBrowserWarn] = useState(!isChrome());

  const [workshopTracks, setWorkshopTracks]     = useState([]);
  const [workshopZoom,   setWorkshopZoom]       = useState(15); // 15px/sec default — auto-fit overrides on first track load
  const [workshopTaal,   setWorkshopTaal]       = useState("Teentaal");
  const [workshopBpm,    setWorkshopBpm]        = useState(120);
  const [workshopShowTaal, setWorkshopShowTaal] = useState(false);
  const [workshopMasterVol, setWorkshopMasterVol] = useState(1);
  const [workshopImportBatch, setWorkshopImportBatch] = useState(null);
  const [backgroundJobs, setBackgroundJobs] = useState({});

  // Per-tool persisted state
  const [toolState, setToolState] = useState(INITIAL_TOOL_STATE);

  const updateToolState = (tool, updates) => {
    setToolState(prev => ({ ...prev, [tool]: { ...prev[tool], ...updates } }));
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("surtaal-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("surtaal-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    const onJob = (event) => {
      const job = event.detail;
      if (!job?.jobKey) return;
      setBackgroundJobs((prev) => {
        const next = { ...prev };
        if (!job.status) {
          delete next[job.jobKey];
          return next;
        }
        next[job.jobKey] = {
          ...prev[job.jobKey],
          ...job,
          updatedAt: Date.now(),
        };
        return next;
      });
    };

    window.addEventListener("surtaal-job", onJob);
    return () => window.removeEventListener("surtaal-job", onJob);
  }, []);

  useEffect(() => {
    const sections = document.querySelectorAll("[data-tool-section]");
    sections.forEach((section) => {
      const sectionId = section.getAttribute("data-tool-section");
      if (sectionId === active) return;
      section.querySelectorAll("audio").forEach((audio) => {
        audio.pause();
      });
    });

    if (active !== "workshop" && mixer.playing) {
      mixer.pause();
    }
  }, [active]);

  const addResultsToWorkshop = async (results) => {
    const files = await Promise.all(
      results.map(async (result) => {
        const response = await fetch(`${API_BASE}/download/${result.filename}`);
        if (!response.ok) {
          throw new Error(`Could not load ${result.filename}`);
        }
        const blob = await response.blob();
        return new File([blob], result.filename, {
          type: blob.type || "audio/mpeg",
        });
      })
    );

    setWorkshopImportBatch({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      files,
    });
    setActive("workshop");
  };

  const saveItemToLibrary = async ({ filename, displayName, file, sourceKind = "session" }) => {
    let nextFile = file;
    if (!nextFile && filename) {
      const response = await fetch(`${API_BASE}/download/${filename}`);
      if (!response.ok) throw new Error(`Could not load ${filename}`);
      const blob = await response.blob();
      nextFile = new File([blob], displayName || filename, {
        type: blob.type || "audio/mpeg",
      });
    }
    if (!nextFile) throw new Error("No audio available to save");
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      display_name: displayName || nextFile.name,
      filename: filename || nextFile.name,
      source_kind: sourceKind,
      created_at: new Date().toISOString(),
      file: nextFile,
    };
    setLibraryItems((prev) => [item, ...prev]);
    return item;
  };

  const deleteLibraryItem = async (itemId) => {
    setLibraryItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  const renameLibraryItem = async (itemId, displayName) => {
    setLibraryItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, display_name: displayName, file: item.file ? new File([item.file], displayName, { type: item.file.type || "audio/mpeg" }) : item.file } : item))
    );
  };

  const dismissJob = (jobKey) => {
    setBackgroundJobs((prev) => {
      const next = { ...prev };
      delete next[jobKey];
      return next;
    });
  };

  const cancelBackgroundJob = async (job) => {
    if (!job?.jobId || job.status !== "processing" || job.canceling) return;
    setBackgroundJobs((prev) => ({
      ...prev,
      [job.jobKey]: {
        ...prev[job.jobKey],
        canceling: true,
      },
    }));
    try {
      await fetch(`${API_BASE}/job/${job.jobId}/cancel`, { method: "POST" });
    } catch (error) {
      setBackgroundJobs((prev) => ({
        ...prev,
        [job.jobKey]: {
          ...prev[job.jobKey],
          canceling: false,
          status: "error",
          error: "Could not cancel the current operation.",
          updatedAt: Date.now(),
        },
      }));
    }
  };

  const backgroundJobList = Object.values(backgroundJobs).sort((a, b) => {
    const order = { processing: 0, cancelled: 1, error: 2, done: 3 };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });

  const helpUrl = "how-to-use.html";

  return (
    <div className={`app ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <header className="header">
        <div className="logo-block">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={sidebarCollapsed}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            ☰
          </button>
          <img className="logo-mark" src={LOGO_SRC} alt="SurTaal logo" />
          <div>
            <h1 className="logo-text">SurTaal</h1>
            <p className="logo-sub">Audio Studio for Indian Performers</p>
          </div>
        </div>
        <div className="header-actions">
          <LibraryManagerButton libraryItems={libraryItems} onDeleteLibraryItem={deleteLibraryItem} onRenameLibraryItem={renameLibraryItem} />
          <button
            type="button"
            className="help-button"
            onClick={() => setActive("help")}
          >
            Help
          </button>
          <div className="theme-toggle-group" aria-label="Theme selector">
            <button
              type="button"
              className={`theme-toggle ${theme === "light" ? "active" : ""}`}
              onClick={() => setTheme("light")}
            >
              Day
            </button>
            <button
              type="button"
              className={`theme-toggle ${theme === "dark" ? "active" : ""}`}
              onClick={() => setTheme("dark")}
            >
              Night
            </button>
          </div>
          <div className="header-badge">Phase 1 · Free · Local</div>
        </div>
      </header>

      <nav className="sidenav">
        {TOOLS.map(t => (
          <button
            key={t.id}
            className={`nav-item ${active === t.id ? "active" : ""}`}
            onClick={() => setActive(t.id)}
            aria-label={t.label}
            title={sidebarCollapsed ? t.label : undefined}
            data-tooltip={t.label}
          >
            <span className="nav-icon">{t.icon}</span>
            <div className="nav-label">
              <span className="nav-title">{t.label}</span>
              <span className="nav-desc">{t.desc}</span>
            </div>
          </button>
        ))}
      </nav>

      {showBrowserWarn && (
        <div style={{
          gridColumn: "1 / -1",
          background: "rgba(201,125,58,0.12)",
          borderBottom: "1px solid rgba(201,125,58,0.35)",
          padding: "10px 20px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 13,
          color: "var(--text)",
          zIndex: 10,
        }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span>
            <strong>Use Chrome for best experience.</strong>
            {" "}Safari has known Web Audio bugs that cause silent playback.
            Surtaal works best in Google Chrome.
          </span>
          <button
            onClick={() => setShowBrowserWarn(false)}
            style={{
              marginLeft: "auto", background: "none", border: "1px solid var(--border)",
              borderRadius: 6, color: "var(--muted)", cursor: "pointer",
              padding: "3px 10px", fontSize: 12, flexShrink: 0,
            }}>
            Dismiss
          </button>
        </div>
      )}

      <main className="content" style={active === "workshop" ? { padding: 0, overflow: "hidden" } : {}}>
        {/* Keep all tools mounted but hidden — state is preserved */}
        <div data-tool-section="stem" style={{ display: active === "stem"     ? "block" : "none", height: "100%" }}>
          <StemSeparator
            state={toolState.stem}
            setState={u => updateToolState("stem", u)}
            onAddToWorkshop={addResultsToWorkshop}
            libraryItems={libraryItems}
            onSaveToLibrary={saveItemToLibrary}
          />
        </div>
        <div data-tool-section="vocal" style={{ display: active === "vocal"    ? "block" : "none", height: "100%" }}>
          <VocalRemover
            state={toolState.vocal}
            setState={u => updateToolState("vocal", u)}
            onAddToWorkshop={addResultsToWorkshop}
            libraryItems={libraryItems}
            onSaveToLibrary={saveItemToLibrary}
          />
        </div>
        <div data-tool-section="pitch" style={{ display: active === "pitch"    ? "block" : "none", height: "100%" }}>
          <PitchShifter
            state={toolState.pitch}
            setState={u => updateToolState("pitch", u)}
            libraryItems={libraryItems}
            onSaveToLibrary={saveItemToLibrary}
            onAddToWorkshop={addResultsToWorkshop}
          />
        </div>
        <div data-tool-section="bpm" style={{ display: active === "bpm"      ? "block" : "none", height: "100%" }}>
          <BpmTool       state={toolState.bpm}   setState={u => updateToolState("bpm", u)} libraryItems={libraryItems} onSaveToLibrary={saveItemToLibrary} />
        </div>
        <div data-tool-section="cleanup" style={{ display: active === "cleanup" ? "block" : "none", height: "100%" }}>
          <AudioCleanup onAddToWorkshop={addResultsToWorkshop} libraryItems={libraryItems} onSaveToLibrary={saveItemToLibrary} />
        </div>
        <div data-tool-section="workshop" style={{ display: active === "workshop" ? "flex" : "none", height: "100%", flexDirection: "column" }}>
          <Workshop
            tracks={workshopTracks}           setTracks={setWorkshopTracks}
            zoom={workshopZoom}               setZoom={setWorkshopZoom}
            taal={workshopTaal}               setTaal={setWorkshopTaal}
            bpm={workshopBpm}                 setBpm={setWorkshopBpm}
            showTaal={workshopShowTaal}       setShowTaal={setWorkshopShowTaal}
            masterVol={workshopMasterVol}     setMasterVol={setWorkshopMasterVol}
            importBatch={workshopImportBatch}
            libraryItems={libraryItems}
            onSaveToLibrary={saveItemToLibrary}
          />
        </div>
        <div data-tool-section="help" style={{ display: active === "help" ? "flex" : "none", height: "100%" }}>
          <section className="help-embed-card">
            <div className="help-embed-header">
              <div>
                <h2 className="help-embed-title">Surtaal Guide</h2>
                <p className="help-embed-subtitle">
                  The full how-to-use guide is available right here inside the app.
                </p>
              </div>
              <a
                className="help-open-link"
                href={helpUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open in New Tab
              </a>
            </div>
            <iframe
              className="help-embed-frame"
              src={helpUrl}
              title="Surtaal help guide"
            />
          </section>
        </div>
      </main>

      {backgroundJobList.length > 0 && (
        <div style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          width: 340,
          maxWidth: "calc(100vw - 32px)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          zIndex: 40,
        }}>
          {backgroundJobList.map((job) => (
            <div
              key={job.jobKey}
              style={{
                background: "var(--surface-overlay)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                boxShadow: "var(--shadow-lg)",
                padding: "12px 14px",
                backdropFilter: "blur(10px)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{job.label}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    {job.status === "processing" && (job.canceling ? "Cancelling current operation…" : "Running in background — keep working.")}
                    {job.status === "done" && "Finished. Open the tool to review results."}
                    {job.status === "cancelled" && (job.error || "Operation cancelled.")}
                    {job.status === "error" && (job.error || "Job failed. Open the tool for details.")}
                  </div>
                </div>
                <button
                  className="btn-ghost"
                  type="button"
                  onClick={() => {
                    setActive(job.jobKey);
                    dismissJob(job.jobKey);
                  }}
                  style={{ fontSize: 11, padding: "5px 10px" }}
                >
                  Open
                </button>
                {job.status === "processing" && (
                  <button
                    className="btn-ghost"
                    type="button"
                    onClick={() => cancelBackgroundJob(job)}
                    disabled={job.canceling}
                    style={{ fontSize: 11, padding: "5px 10px" }}
                  >
                    {job.canceling ? "Cancelling…" : "Cancel"}
                  </button>
                )}
                {job.status !== "processing" && (
                  <button
                    type="button"
                    onClick={() => dismissJob(job.jobKey)}
                    style={{
                      border: "none",
                      background: "none",
                      color: "var(--muted)",
                      cursor: "pointer",
                      fontSize: 15,
                      lineHeight: 1,
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>

              {job.status === "processing" && (
                <>
                  <div style={{
                    height: 5,
                    background: "rgba(255,255,255,0.06)",
                    borderRadius: 999,
                    overflow: "hidden",
                    marginBottom: 6,
                  }}>
                    <div style={{
                      width: `${job.progress || 0}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, var(--accent), #8b4ea3)",
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>
                    {Math.max(0, Math.min(100, job.progress || 0))}%
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
