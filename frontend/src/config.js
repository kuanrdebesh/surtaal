const FALLBACK_API_BASE = "http://127.0.0.1:8000";

function runtimeApiBase() {
  if (typeof window === "undefined") return null;
  if (window.surtaalDesktop?.apiBase) return window.surtaalDesktop.apiBase;
  if (window.__SURTAAL_API__) return window.__SURTAAL_API__;
  return null;
}

export const API_BASE =
  runtimeApiBase() ||
  import.meta.env.VITE_API_BASE ||
  FALLBACK_API_BASE;
