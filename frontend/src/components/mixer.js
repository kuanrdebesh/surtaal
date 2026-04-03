// mixer.js
// Single source of truth for all audio playback in Surtaal.
// Stored on window to survive Vite hot reloads.
// AudioContext is created lazily on first user gesture (browser autoplay policy).

class Mixer {
  constructor() {
    this.ctx     = null;
    this.master  = null;
    this.tracks  = new Map(); // id -> {buffer, gainNode, source, vol, muted, solo, offset}
    this._t0     = 0;
    this._off    = 0;
    this.playing = false;
  }

  // ── AudioContext bootstrap ─────────────────────────────────────────────────
  // Call this synchronously inside every click handler that touches audio.
  // Browser autoplay policy: AudioContext can only be resumed/created during
  // a synchronous user gesture. Never await before calling this.

  boot() {
    if (!this.ctx) {
      this.ctx    = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      console.log('[Mixer] AudioContext created, state:', this.ctx.state);
    }

    // If context was suspended (browser autoplay policy), resume it.
    // This MUST be called synchronously in a click handler.
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => {
        console.log('[Mixer] AudioContext resumed, state:', this.ctx.state);
      });
    }

    // If context was closed (e.g. by browser after inactivity), recreate it
    // and reconnect all gain nodes.
    if (this.ctx.state === 'closed') {
      console.log('[Mixer] AudioContext was closed, recreating...');
      this.ctx    = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      // Reconnect all gain nodes to new context
      this.tracks.forEach((t, id) => {
        if (!t.buffer) return;
        const gain = this.ctx.createGain();
        gain.connect(this.master);
        gain.gain.value = t.muted ? 0 : t.vol;
        t.gainNode = gain;
        t.source   = null;
      });
    }

    return this.ctx;
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  async load(id, file) {
    // Boot context — can be called async here since we're not playing
    if (!this.ctx) {
      this.ctx    = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    const ab  = await file.arrayBuffer();
    const buf = await this.ctx.decodeAudioData(ab);

    // Reuse existing gain node if present, else create new one
    const existing = this.tracks.get(id) || {};
    let gainNode = existing.gainNode;
    if (!gainNode || gainNode.context !== this.ctx) {
      gainNode = this.ctx.createGain();
      gainNode.connect(this.master);
    }

    const vol   = existing.vol   ?? 1;
    const muted = existing.muted ?? false;
    gainNode.gain.value = muted ? 0 : vol;

    this.tracks.set(id, {
      buffer: buf,
      gainNode,
      source: null,
      vol,
      muted,
      solo:   existing.solo   ?? false,
      offset: existing.offset ?? 0,
    });

    console.log(`[Mixer] Loaded track ${id}, duration: ${buf.duration.toFixed(1)}s`);
    return buf;
  }

  remove(id) {
    const t = this.tracks.get(id);
    if (!t) return;
    try { t.source?.stop(); } catch {}
    try { t.gainNode?.disconnect(); } catch {}
    this.tracks.delete(id);
  }

  // ── Gain control ──────────────────────────────────────────────────────────

  _recalcGains() {
    const anySolo = [...this.tracks.values()].some(x => x.solo);
    this.tracks.forEach(t => {
      if (!t.gainNode) return;
      const active = !anySolo || t.solo;
      t.gainNode.gain.value = (!active || t.muted) ? 0 : t.vol;
    });
  }

  setVol(id, v)    { const t = this.tracks.get(id); if (t) t.vol    = v; this._recalcGains(); }
  setMute(id, v)   { const t = this.tracks.get(id); if (t) t.muted  = v; this._recalcGains(); }
  setSolo(id, v)   { const t = this.tracks.get(id); if (t) t.solo   = v; this._recalcGains(); }
  setOffset(id, v) { const t = this.tracks.get(id); if (t) t.offset = v; }
  setMasterVol(v)  { if (this.master) this.master.gain.value = v; }

  // ── Transport ─────────────────────────────────────────────────────────────
  // play() MUST be called synchronously from a click handler.
  // Do NOT put any await before calling play().

  _stopSources() {
    this.tracks.forEach(t => {
      try { t.source?.stop(); } catch {}
      t.source = null;
    });
  }

  _startPlayback(seekTo, filterIds = null) {
    const ctx = this.boot(); // synchronous — resumes AudioContext immediately
    this._stopSources();

    const off = seekTo ?? this._off;
    this._t0   = ctx.currentTime - off;
    this.playing = true;
    const allowedIds = filterIds ? new Set(filterIds) : null;

    const anySolo = [...this.tracks.values()].some(x => x.solo);
    let started = 0;

    this.tracks.forEach((t, id) => {
      if (allowedIds && !allowedIds.has(id)) return;
      if (!t.buffer) return;

      // Ensure gain node belongs to current context
      if (!t.gainNode || t.gainNode.context !== ctx) {
        t.gainNode = ctx.createGain();
        t.gainNode.connect(this.master);
      }

      const src  = ctx.createBufferSource();
      src.buffer = t.buffer;
      src.connect(t.gainNode);

      const trackOff = t.offset ?? 0;
      const delay    = Math.max(0, trackOff - off);
      const srcStart = Math.max(0, off - trackOff);

      src.start(ctx.currentTime + delay, srcStart);
      t.source = src;
      started++;
    });

    this._recalcGains();
    console.log(`[Mixer] play() called, offset=${off.toFixed(2)}, tracks started=${started}, ctx state=${ctx.state}`);
  }

  play(seekTo) {
    this._startPlayback(seekTo, null);
  }

  playSelected(ids, seekTo) {
    this._startPlayback(seekTo, ids);
  }

  pause() {
    if (!this.playing) return;
    this._off    = this.ctx.currentTime - this._t0;
    this._stopSources();
    this.playing = false;
    console.log(`[Mixer] paused at ${this._off.toFixed(2)}s`);
  }

  stop() {
    this._stopSources();
    this.playing = false;
    this._off    = 0;
  }

  seek(t) {
    this._off = t;
    if (this.playing) this.play(t);
  }

  get currentTime() {
    if (!this.ctx) return 0;
    if (this.playing) return this.ctx.currentTime - this._t0;
    return this._off;
  }

  // ── Debug ─────────────────────────────────────────────────────────────────

  debug() {
    console.log('=== Mixer Debug ===');
    console.log('ctx state:', this.ctx?.state ?? 'no context');
    console.log('playing:', this.playing);
    console.log('currentTime:', this.currentTime.toFixed(2));
    console.log('tracks:', this.tracks.size);
    this.tracks.forEach((t, id) => {
      console.log(`  track ${id}: buffer=${!!t.buffer}, gainNode=${!!t.gainNode}, vol=${t.vol}, muted=${t.muted}`);
    });
    console.log('==================');
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
// We store on window so Vite hot-reloads don't lose the loaded audio buffers.
// On each module load we check if the existing instance's AudioContext is still
// valid. If the context was closed by the browser, we reset so a fresh one
// gets created on next user gesture.

if (window._surtaal_mixer) {
  const existing = window._surtaal_mixer;
  if (existing.ctx?.state === 'closed') {
    console.log('[Mixer] Existing context was closed, resetting mixer');
    window._surtaal_mixer = new Mixer();
  } else {
    console.log('[Mixer] Reusing existing mixer, ctx state:', existing.ctx?.state ?? 'none');
  }
} else {
  window._surtaal_mixer = new Mixer();
}

export const mixer = window._surtaal_mixer;

// Expose debug helper globally
window.surtaalDebug = () => mixer.debug();
