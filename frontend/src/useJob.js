import { useState, useRef, useCallback, useEffect } from "react";
import { API_BASE } from "./config";

export function useJob(options = {}) {
  const { jobKey, label } = options;
  const [status, setStatus] = useState(null); // null | 'processing' | 'done' | 'error'
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!jobKey || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("surtaal-job", {
      detail: { jobKey, label, status, progress, error, results },
    }));
  }, [jobKey, label, status, progress, error, results]);

  const reset = useCallback(() => {
    setStatus(null);
    setProgress(0);
    setResults([]);
    setError(null);
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
          setStatus("done");
          setProgress(100);
          setResults(data.files || []);
        } else if (data.status === "error") {
          clearInterval(pollRef.current);
          setStatus("error");
          setError(data.message || "Processing failed");
        }
      } catch (e) {
        clearInterval(pollRef.current);
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
        setStatus("error");
        setError(err.detail || "Request failed");
        return;
      }
      const data = await res.json();
      if (data.job_id) {
        pollJob(data.job_id);
      } else if (data.bpm !== undefined) {
        setStatus("done");
        setResults([{ bpm: data.bpm }]);
      } else {
        setStatus("error");
        setError("The backend returned an unexpected response.");
      }
      return data;
    } catch (e) {
      setStatus("error");
      setError("Cannot reach backend. Make sure the server is running on port 8000.");
    }
  }, [pollJob, reset]);

  const downloadUrl = (filename) => `${API_BASE}/download/${filename}`;

  return { status, progress, results, error, submit, reset, downloadUrl };
}
