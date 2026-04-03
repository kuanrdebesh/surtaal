// waveform.js — Pre-compute once, draw fast with energy colour + RMS body

const themeVar = (name, fallback) => {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
};

export function buildWaveData(audioBuffer, resolution = 1500) {
  const ch   = audioBuffer.getChannelData(0);
  const len  = ch.length;
  const step = Math.max(1, Math.floor(len / resolution));
  const actual = Math.ceil(len / step);
  const peaks = new Float32Array(actual);
  const rms   = new Float32Array(actual);

  for (let b = 0; b < actual; b++) {
    const s = b * step;
    const e = Math.min(s + step, len);
    let mx = 0, sq = 0;
    for (let i = s; i < e; i++) {
      const v = ch[i] < 0 ? -ch[i] : ch[i];
      if (v > mx) mx = v;
      sq += v * v;
    }
    peaks[b] = mx;
    rms[b]   = Math.sqrt(sq / (e - s));
  }
  return { peaks, rms, resolution: actual, duration: audioBuffer.duration };
}

// Energy colour — cool blue (quiet) → saffron (mid) → red (peak)
function energyColor(e, alpha) {
  let r, g, b;
  // Boost: clamp e to 0.1 minimum so even quiet sections show colour
  const ev = Math.max(e, 0.05);
  if (ev < 0.3) {
    const t = ev / 0.3;
    // Cool blue → teal
    r = ~~(30  + t * 180); g = ~~(120 - t * 60);  b = ~~(220 - t * 160);
  } else if (ev < 0.65) {
    const t = (ev - 0.3) / 0.35;
    // Teal → warm saffron
    r = ~~(80  + t * 150); g = ~~(100 + t * 30);  b = ~~(50  - t * 20);
  } else {
    const t = (ev - 0.65) / 0.35;
    // Saffron → hot red
    r = ~~(210 + t * 40);  g = ~~(120 - t * 60);  b = ~~(30  - t * 20);
  }
  return `rgba(${r},${g},${b},${alpha})`;
}

export function drawWave(canvas, wd, opts) {
  if (!canvas || !wd) return;
  const {
    trimStart = 0, trimEnd = wd.duration,
    selStart, selEnd,
    startOffset = 0,
    playhead = 0,
    zoom, scrollLeft,
    color, taal, bpm, TAALS,
  } = opts;

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  if (W === 0 || H === 0) return;
  const mid = H / 2;
  const canvasBg = themeVar('--canvas-bg', '#0d0d11');
  const gridWeak = themeVar('--canvas-grid', 'rgba(255,255,255,0.055)');
  const gridStrong = themeVar('--canvas-grid-strong', 'rgba(201,125,58,0.38)');
  const gridLabel = themeVar('--canvas-grid-label', 'rgba(201,125,58,0.5)');
  const accent = themeVar('--accent', '#c97d3a');
  const playheadColor = themeVar('--canvas-playhead', '#ffffff');

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = canvasBg;
  ctx.fillRect(0, 0, W, H);

  // ── Taal grid ────────────────────────────────────────────────────────────────
  if (taal && bpm > 0 && TAALS) {
    const T = TAALS.find(x => x.name === taal);
    if (T) {
      const spb       = 60 / bpm;
      const cycleSec  = spb * T.beats;
      const totalSec  = (W + scrollLeft) / zoom + 2;
      let cycleStart  = 0;
      while (cycleStart * zoom - scrollLeft < W) {
        let cum = 0;
        T.vibhag.forEach((v, vi) => {
          for (let b = 0; b < v; b++) {
            const beatSec = cycleStart + (cum + b) * spb;
            const px      = beatSec * zoom - scrollLeft;
            if (px < -2 || px > W + 2) continue;
            const isSam = cum + b === 0;
            const isVib = b === 0;
            ctx.strokeStyle = isSam ? accent
              : isVib ? gridStrong
              : gridWeak;
            ctx.lineWidth = isSam ? 2 : isVib ? 1 : 0.5;
            ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
            if (isSam || isVib) {
              ctx.fillStyle = isSam ? accent : gridLabel;
              ctx.font = '9px monospace';
              ctx.fillText(isSam ? 'Sam' : `V${vi + 1}`, px + 3, 10);
            }
          }
          cum += v;
        });
        cycleStart += cycleSec;
        if (cycleStart > totalSec + cycleSec) break;
      }
    }
  }

  // ── Trim shading ─────────────────────────────────────────────────────────────
  const tx0 = (startOffset + trimStart) * zoom - scrollLeft;
  const tx1 = (startOffset + trimEnd)   * zoom - scrollLeft;
  ctx.fillStyle = 'rgba(0,0,0,0.52)';
  if (tx0 > 0) ctx.fillRect(0, 0, Math.min(tx0, W), H);
  if (tx1 < W) ctx.fillRect(Math.max(tx1, 0), 0, W - Math.max(tx1, 0), H);

  // ── Selection highlight ───────────────────────────────────────────────────────
  if (selStart != null && selEnd != null && selEnd > selStart) {
    const sx0 = Math.max(0, (startOffset + selStart) * zoom - scrollLeft);
    const sx1 = Math.min(W, (startOffset + selEnd)   * zoom - scrollLeft);
    ctx.fillStyle = 'rgba(139,78,163,0.25)';
    ctx.fillRect(sx0, 0, sx1 - sx0, H);
    ctx.strokeStyle = '#8b4ea3'; ctx.lineWidth = 1;
    ctx.strokeRect(sx0, 0, sx1 - sx0, H);
  }

  // ── Waveform — peak (dim) + RMS (bright), mirrored top & bottom ─────────────
  const inTrimRegion = (sec) => sec >= trimStart && sec <= trimEnd;

  for (let px = 0; px < W; px++) {
    const sec = (px + scrollLeft) / zoom - startOffset;
    if (sec < 0 || sec > wd.duration) continue;
    const bi   = Math.min(~~(sec / wd.duration * wd.resolution), wd.resolution - 1);
    const p    = wd.peaks[bi] || 0;
    const rv   = wd.rms[bi]   || 0;
    const inT  = inTrimRegion(sec);

    if (inT) {
      // Peak layer — dim, full height (top + bottom mirrored)
      ctx.fillStyle = energyColor(rv, 0.28);
      ctx.fillRect(px, mid - p * mid * 0.97, 1, p * mid * 1.94);
      // RMS layer — bright, the musical "body"
      ctx.fillStyle = energyColor(rv, 0.95);
      ctx.fillRect(px, mid - rv * mid * 0.94, 1, rv * mid * 1.88);
    } else {
      // Outside trim — flat grey, no energy colour
      ctx.fillStyle = 'rgba(42,37,85,0.55)';
      ctx.fillRect(px, mid - p * mid * 0.97, 1, p * mid * 1.94);
      ctx.fillStyle = 'rgba(58,53,117,0.6)';
      ctx.fillRect(px, mid - rv * mid * 0.94, 1, rv * mid * 1.88);
    }
  }

  // ── Centre zero line ──────────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth   = 0.5;
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();

  // ── Transient markers (green dots at bottom) ──────────────────────────────────
  // Detect transients from peak data and mark them
  if (wd.peaks) {
    const step = Math.max(1, ~~(wd.resolution / (wd.duration * zoom)));
    let prevP = 0;
    for (let bi = step; bi < wd.resolution; bi += step) {
      const p  = wd.peaks[bi] || 0;
      const pp = wd.peaks[bi - step] || 0;
      if (p - pp > 0.14) {
        const sec = (bi / wd.resolution) * wd.duration;
        const px  = (startOffset + sec) * zoom - scrollLeft;
        if (px >= 0 && px <= W && inTrimRegion(sec)) {
          ctx.strokeStyle = 'rgba(76,175,61,0.65)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(px, H - 11); ctx.lineTo(px, H - 2); ctx.stroke();
          ctx.fillStyle = 'rgba(76,175,61,0.75)';
          ctx.beginPath(); ctx.arc(px, H - 12, 2.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  // ── Trim handles ──────────────────────────────────────────────────────────────
  [[tx0, color, true], [tx1, '#8b4ea3', false]].forEach(([x, c, left]) => {
    if (x < -8 || x > W + 8) return;
    ctx.fillStyle = c;
    ctx.fillRect(x - 2, 0, 4, H);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    if (left) { ctx.lineTo(x + 10, 0); ctx.lineTo(x, 16); }
    else       { ctx.lineTo(x - 10, 0); ctx.lineTo(x, 16); }
    ctx.fill();
  });

  // ── Playhead ──────────────────────────────────────────────────────────────────
  const ph = (startOffset + playhead) * zoom - scrollLeft;
  if (ph >= 0 && ph <= W) {
    ctx.fillStyle = playheadColor;
    ctx.fillRect(ph - 1, 0, 2, H);
    ctx.beginPath(); ctx.arc(ph, 5, 5, 0, Math.PI * 2); ctx.fill();
  }
}

export function drawRuler(canvas, zoom, scroll) {
  if (!canvas || canvas.width === 0) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const rulerBg = themeVar('--canvas-ruler-bg', '#12121a');
  const tickColor = themeVar('--canvas-ruler-tick', '#3a3555');
  const textColor = themeVar('--canvas-ruler-text', '#5a5470');
  const lineColor = themeVar('--canvas-ruler-line', '#22203a');
  ctx.fillStyle = rulerBg; ctx.fillRect(0, 0, W, H);

  const spp  = 1 / zoom;
  const tick = spp > 10 ? 60 : spp > 3 ? 10 : spp > 1 ? 5 : spp < 0.04 ? 0.1 : 1;
  let t = Math.floor((scroll / zoom) / tick) * tick;

  ctx.font = '9px monospace';
  while (t * zoom - scroll < W) {
    const x = t * zoom - scroll;
    if (x >= 0) {
      ctx.fillStyle = tickColor; ctx.fillRect(x, H - 7, 1, 7);
      ctx.fillStyle = textColor;
      const m = Math.floor(t / 60);
      const s = (t % 60).toFixed(spp < 0.1 ? 1 : 0).padStart(spp < 0.1 ? 4 : 2, '0');
      ctx.fillText(`${m}:${s}`, x + 3, H - 9);
    }
    t += tick;
  }
  ctx.strokeStyle = lineColor; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, H - 1); ctx.lineTo(W, H - 1); ctx.stroke();
}
