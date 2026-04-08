import { useState, useRef, useCallback, useEffect } from "react";
import { API_BASE } from "./config";

export function useJob(options = {}) {
  const { jobKey, label } = options;
  const [status, setStatus] = useState(null); // null | 'processing' | 'done' | 'error'
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [canceling, setCanceling] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!jobKey || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("surtaal-job", {
      detail: { jobKey, label, status, progress, error, results, jobId, canceling },
    }));
  }, [jobKey, label, status, progress, error, results, jobId, canceling]);

  const reset = useCallback(() => {
    setStatus(null);
    setProgress(0);
    setResults([]);
    setError(null);
    setJobId(null);
    setCanceling(false);
    clearInterval(pollRef.current);
  }, []);

  const pollJob = useCallback((jobId) => {
    setStatus("processing");
    setProgress(5);

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/job/${jobId}`);
        const data = await res.json();

        if (data.progress) setProgress(data.progress);

        if (data.status === "done") {
          clearInterval(pollRef.current);
          setCanceling(false);
          setStatus("done");
          setProgress(100);
          let rawFiles = data.files || data.file;
          let safeFiles = [];

          if (rawFiles) {
            if (typeof rawFiles === "string") {
              // Backend sent a single string (like a zip filename)
              safeFiles = [{ filename: rawFiles, label: "extracted_audio" }];
            } else if (Array.isArray(rawFiles)) {
              // Ensure all items are objects
              safeFiles = rawFiles.filter(Boolean).map(item => 
                typeof item === "string" ? { filename: item, label: item } : item
              );
            } else if (typeof rawFiles === "object") {
              // Backend sent a dictionary { "vocals": "vocals.mp3" }
              safeFiles = Object.entries(rawFiles).map(([k, v]) => {
                if (typeof v === "string") return { label: k, filename: v };
                if (typeof v === "object" && v !== null) return { label: k, ...(v.filename ? v : { filename: v.file || k }) };
                return { label: k, value: v };
              });
            }
          }

          setResults(safeFiles);
        } else if (data.status === "cancelled") {
          clearInterval(pollRef.current);
          setCanceling(false);
          setStatus("cancelled");
          setError(data.message || "Operation cancelled.");
        } else if (data.status === "error") {
          clearInterval(pollRef.current);
          setCanceling(false);
          setStatus("error");
          setError(data.message || "Processing failed");
        }
      } catch (e) {
        clearInterval(pollRef.current);
        setCanceling(false);
        setStatus("error");
        setError("Cannot reach backend. Is it running?");
      }
    }, 1200);
  }, []);

  const submit = useCallback(async (endpoint, formData) => {
    reset();
    setStatus("processing");
    setProgress(2);
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        setCanceling(false);
        setStatus("error");
        setError(err.detail || "Request failed");
        return;
      }
      const data = await res.json();
      if (data.job_id) {
        setJobId(data.job_id);
        pollJob(data.job_id);
      } else if (data.bpm !== undefined) {
        setCanceling(false);
        setStatus("done");
        setResults([{ bpm: data.bpm }]);
      } else {
        setCanceling(false);
        setStatus("error");
        setError("The backend returned an unexpected response.");
      }
      return data;
    } catch (e) {
      setCanceling(false);
      setStatus("error");
      setError("Cannot reach backend. Make sure the server is running on port 8000.");
    }
  }, [pollJob, reset]);

  const cancel = useCallback(async () => {
    if (!jobId || status !== "processing" || canceling) return;
    setCanceling(true);
    try {
      await fetch(`${API_BASE}/job/${jobId}/cancel`, { method: "POST" });
    } catch (e) {
      setCanceling(false);
      setStatus("error");
      setError("Could not cancel the current operation.");
    }
  }, [jobId, status, canceling]);

  const downloadUrl = (filename) => `${API_BASE}/download/${filename}`;

  return { status, progress, results, error, submit, reset, downloadUrl, cancel, canceling, jobId };
}
