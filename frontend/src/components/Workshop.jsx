/**
 * Workshop.jsx — Clip-based DAW
 * Data model: Track has multiple Clips. Each clip is an independent region
 * on the timeline with its own trimStart/trimEnd/startOffset.
 * Split creates two clips on the same track, not two tracks.
 */
import { useState, useEffect, useRef } from 'react';
import { mixer } from './mixer.js';
import { buildWaveData, drawWave, drawRuler } from './waveform.js';
import { API_BASE } from "../config";

const LEFT_W  = 200;
const TRACK_H = 260;  // track row height (matches panel)
const PANEL_H = 260;  // left panel height (taller for pitch/tempo controls)
const TAALS   = [
  { name: 'Teentaal',  beats: 16, vibhag: [4,4,4,4] },
  { name: 'Ektaal',    beats: 12, vibhag: [2,2,2,2,2,2] },
  { name: 'Jhaptaal',  beats: 10, vibhag: [2,3,2,3] },
  { name: 'Rupak',     beats: 7,  vibhag: [3,2,2] },
  { name: 'Keherwa',   beats: 8,  vibhag: [4,4] },
  { name: 'Dadra',     beats: 6,  vibhag: [3,3] },
  { name: 'Chaurtaal', beats: 12, vibhag: [4,4,2,2] },
];
const COLORS = ['#c97d3a','#8b4ea3','#3a8bc9','#4caf7d','#e05c5c','#c9a73a','#3ac9b4','#a33a6b'];
let _uid = 0;
const uid = () => ++_uid;

const fmt = (s) => {
  if (!isFinite(s)||isNaN(s)) return '0:00';
  return `${Math.floor(s/60)}:${(s%60).toFixed(1).padStart(4,'0')}`;
};

const themeVar = (name, fallback) => {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
};

// Clipboard
let clipboard = null;

// ─────────────────────────────────────────────────────────────────────────────
// Data helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeClip(overrides = {}) {
  return {
    id:          uid(),
    fileId:      null,   // references track.fileId
    waveData:    null,
    buffer:      null,
    duration:    0,
    trimStart:   0,
    trimEnd:     0,
    startOffset: 0,      // position on timeline (seconds)
    selStart:    null,
    selEnd:      null,
    ...overrides,
  };
}

function makeTrack(overrides = {}) {
  return {
    id:       uid(),
    name:     'Empty Track',
    file:     null,
    volume:   1,
    muted:    false,
    solo:     false,
    fadeIn:   0,
    fadeOut:  0,
    clips:    [],        // array of clips
    ...overrides,
  };
}

function isEmptyTrack(track) {
  return !track.file && (!track.clips || track.clips.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pitch & Tempo panel (embedded in track panel)
// ─────────────────────────────────────────────────────────────────────────────

const NOTE_NAMES  = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SWARA_NAMES = ['Sa','Re♭','Re','Ga♭','Ga','Ma','Ma#','Pa','Dha♭','Dha','Ni♭','Ni'];

function PitchTempoControls({ track, onReplaceClip }) {
  const [semitones, setSemitones]     = useState(0);
  const [tempoFactor, setTempoFactor] = useState(1.0);
  const [status, setStatus]           = useState(null);
  const [detectedKey, setDetectedKey] = useState(null);
  const [detecting, setDetecting]     = useState(false);
  const pollRef = useRef();

  // Reset button to "Apply Changes" when sliders move after a completed apply
  const handleSemitones = (v) => {
    setSemitones(v);
    if (status === 'done') setStatus(null);
  };
  const handleTempo = (v) => {
    setTempoFactor(v);
    if (status === 'done') setStatus(null);
  };

  const detectKey = async () => {
    if (!track.file) return;
    setDetecting(true);
    const fd = new FormData();
    fd.append('file', track.file);
    try {
      const r    = await fetch(`${API_BASE}/api/detect-key`, { method: 'POST', body: fd });
      const data = await r.json();
      setDetectedKey(data);
    } catch {}
    setDetecting(false);
  };

  const newKey = detectedKey
    ? NOTE_NAMES[(NOTE_NAMES.indexOf(detectedKey.key) + semitones + 1200) % 12]
    : null;

  // Wait for a job and return the processed file
  const waitForJob = (jobId) => new Promise((resolve, reject) => {
    const iv = setInterval(async () => {
      try {
        const j = await fetch(`${API_BASE}/job/${jobId}`).then(x => x.json());
        if (j.status === 'done') {
          clearInterval(iv);
          const filename = j.files?.[0]?.filename;
          if (!filename) { reject(new Error('no file')); return; }
          const blob = await fetch(`${API_BASE}/download/${filename}`).then(r => r.blob());
          resolve(new File([blob], filename, { type: 'audio/mpeg' }));
        }
        if (j.status === 'error') { clearInterval(iv); reject(new Error('job failed')); }
      } catch(e) { clearInterval(iv); reject(e); }
    }, 1000);
  });

  const apply = async () => {
    if (!track.file) return;
    if (semitones === 0 && tempoFactor === 1.0) return;
    setStatus('busy');
    try {
      // Start with the original file, chain operations
      let currentFile = track.file;

      // Step 1: pitch shift
      if (semitones !== 0) {
        const fd = new FormData();
        fd.append('file', currentFile);
        fd.append('semitones', semitones);
        fd.append('output_format', 'mp3');
        const { job_id } = await fetch(`${API_BASE}/api/pitch-shift`, { method:'POST', body:fd }).then(r=>r.json());
        currentFile = await waitForJob(job_id);
      }

      // Step 2: tempo change on the result of step 1
      if (tempoFactor !== 1.0) {
        const fd = new FormData();
        fd.append('file', currentFile);
        fd.append('factor', tempoFactor);
        fd.append('output_format', 'mp3');
        const { job_id } = await fetch(`${API_BASE}/api/tempo-change`, { method:'POST', body:fd }).then(r=>r.json());
        currentFile = await waitForJob(job_id);
      }

      // Replace clip with final chained result
      await onReplaceClip(track.id, currentFile);

      // Update key display to reflect applied shift
      if (detectedKey && semitones !== 0) {
        const idx = (NOTE_NAMES.indexOf(detectedKey.key) + semitones + 1200) % 12;
        setDetectedKey({ ...detectedKey, key: NOTE_NAMES[idx] });
      }
      setSemitones(0);
      setTempoFactor(1.0);
      setStatus('done');
    } catch(e) { console.error('Apply failed:', e); setStatus('error'); }
  };



  const noChange = semitones === 0 && tempoFactor === 1.0;

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
      {/* Key detection */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <button onClick={detectKey} disabled={detecting || !track.file}
          style={{ fontSize: 8, padding: '2px 6px', border: '1px solid var(--border)',
            borderRadius: 3, cursor: 'pointer', background: 'transparent',
            color: 'var(--muted)', flexShrink: 0 }}>
          {detecting ? '...' : '🎵 Detect Key'}
        </button>
        {detectedKey && (
          <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace' }}>
            {detectedKey.key} {detectedKey.mode}
            {newKey && semitones !== 0 && ` → ${newKey}`}
          </span>
        )}
      </div>

      {/* Semitone slider */}
      <div style={{ marginBottom: 5 }}>
        <div style={{ fontSize: 8, color: 'var(--muted)', marginBottom: 1 }}>
          Key {semitones > 0 ? '+' : ''}{semitones} st
          {detectedKey && semitones !== 0 && (
            <span style={{ color: 'var(--accent)' }}> ({detectedKey.key}→{newKey})</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type='range' min={-12} max={12} step={1} value={semitones}
            onChange={e => handleSemitones(Number(e.target.value))}
            style={{ flex: 1, height: 2, accentColor: 'var(--accent)' }}/>
          <span style={{ fontSize: 8, color: 'var(--accent)', width: 16, textAlign: 'right',
            fontFamily: 'monospace' }}>{semitones > 0 ? '+' : ''}{semitones}</span>
        </div>
      </div>

      {/* Tempo slider */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 8, color: 'var(--muted)', marginBottom: 1 }}>
          Tempo ×{tempoFactor.toFixed(2)}
          {tempoFactor !== 1 && (
            <span style={{ color: '#3a8bc9' }}>
              {' '}({tempoFactor > 1 ? '+' : ''}{Math.round((tempoFactor-1)*100)}%)
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type='range' min={0.5} max={2.0} step={0.05} value={tempoFactor}
            onChange={e => handleTempo(Number(e.target.value))}
            style={{ flex: 1, height: 2, accentColor: '#3a8bc9' }}/>
          <span style={{ fontSize: 8, color: '#3a8bc9', width: 24, textAlign: 'right',
            fontFamily: 'monospace' }}>×{tempoFactor.toFixed(1)}</span>
        </div>
      </div>

      {/* Apply button */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button onClick={apply} disabled={noChange || status === 'busy' || !track.file}
          title='Apply pitch/tempo changes and replace clip'
          style={{ flex: 1, fontSize: 8, padding: '3px 0', border: '1px solid',
            borderRadius: 3, cursor: noChange ? 'not-allowed' : 'pointer',
            borderColor: noChange ? 'var(--border)' : 'var(--accent)',
            background: noChange ? 'transparent' : 'rgba(201,125,58,0.1)',
            color: status === 'busy' ? 'var(--accent)'
                 : status === 'error' ? '#e05c5c'
                 : noChange ? 'var(--muted)' : 'var(--accent)' }}>
          {status === 'busy' ? 'Processing…'
           : status === 'done' ? '✓ Applied'
           : status === 'error' ? '⚠ Failed'
           : 'Apply Changes'}
        </button>
        {!noChange && (
          <button onClick={() => { setSemitones(0); setTempoFactor(1.0); setStatus(null); setDetectedKey(null); }}
            title='Reset to original'
            style={{ fontSize: 8, padding: '3px 5px', border: '1px solid var(--border)',
              borderRadius: 3, cursor: 'pointer', background: 'transparent',
              color: 'var(--muted)' }}>↺</button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Track left panel
// ─────────────────────────────────────────────────────────────────────────────

function TrackPanel({ track, color, selected, playSelected, onTogglePlaySelected, onSelect, onUpdate, onRemove, onReplaceClip }) {
  return (
    <div onClick={onSelect} style={{
      width: LEFT_W, height: PANEL_H, boxSizing: 'border-box',
      borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
      borderLeft: `3px solid ${selected ? color : 'transparent'}`,
      background: selected ? `${color}11` : 'var(--bg2)',
      padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6,
      cursor: 'pointer', flexShrink: 0, overflowY: 'auto', overflowX: 'hidden',
    }}>
      {/* Name */}
      <div style={{ display:'flex', alignItems:'center', gap:5 }}>
        <input
          type='checkbox'
          checked={playSelected}
          onChange={e=>{e.stopPropagation(); onTogglePlaySelected();}}
          onClick={e=>e.stopPropagation()}
          title='Include this track in Play Selected'
          style={{ accentColor: color, margin: 0, flexShrink: 0 }}
        />
        <div style={{ width:7, height:7, borderRadius:'50%', background:color, flexShrink:0 }}/>
        <span style={{ flex:1, fontSize:11, fontWeight:600, overflow:'hidden',
          textOverflow:'ellipsis', whiteSpace:'nowrap',
          color: selected ? color : 'var(--text)' }} title={track.name}>
          {track.name}
        </span>
        <button onClick={e=>{e.stopPropagation();onRemove();}}
          style={{ background:'none', border:'none', color:'var(--muted)',
            cursor:'pointer', fontSize:13, lineHeight:1, padding:0, flexShrink:0 }}>×</button>
      </div>

      {/* Volume */}
      <div style={{ display:'flex', alignItems:'center', gap:5 }}>
        <span style={{ fontSize:9, color:'var(--muted)', width:18, flexShrink:0 }}>Vol</span>
        <input type='range' min={0} max={1} step={0.01} value={track.volume}
          onClick={e=>e.stopPropagation()}
          onChange={e=>{const v=Number(e.target.value);onUpdate({volume:v});mixer.setVol(track.id,v);}}
          style={{ flex:1, height:2, accentColor:color }}/>
        <span style={{ fontSize:9, color:'var(--muted)', width:26, textAlign:'right', flexShrink:0 }}>
          {Math.round(track.volume*100)}%</span>
      </div>

      {/* M / S */}
      <div style={{ display:'flex', gap:4, alignItems:'center' }}>
        {[['M','muted','#e05c5c'],['S','solo','#c97d3a']].map(([lbl,key,col])=>(
          <button key={key} onClick={e=>{
            e.stopPropagation();
            const v=!track[key]; onUpdate({[key]:v});
            key==='muted' ? mixer.setMute(track.id,v) : mixer.setSolo(track.id,v);
          }} style={{
            width:22, height:19, fontSize:9, fontWeight:700, border:'1px solid',
            borderRadius:3, cursor:'pointer', flexShrink:0,
            borderColor: track[key]?col:'var(--border)',
            background:  track[key]?col+'22':'transparent',
            color:       track[key]?col:'var(--muted)',
          }}>{lbl}</button>
        ))}
        <span style={{ fontSize:9, color:'var(--muted)', marginLeft:'auto',
          fontFamily:'monospace', flexShrink:0 }}>
          {track.clips.length} clip{track.clips.length!==1?'s':''}
        </span>
      </div>

      {/* Fade */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
        {[['Fade in','fadeIn'],['Fade out','fadeOut']].map(([lbl,key])=>(
          <div key={key} style={{ minWidth:0 }}>
            <div style={{ fontSize:8, color:'var(--muted)', marginBottom:1 }}>
              {lbl} {(track[key]||0).toFixed(1)}s
            </div>
            <input type='range' min={0} max={8} step={0.1} value={track[key]||0}
              onClick={e=>e.stopPropagation()}
              onChange={e=>onUpdate({[key]:Number(e.target.value)})}
              style={{ width:'100%', height:2 }}/>
          </div>
        ))}
      </div>

      {/* Pitch & Tempo */}
      <PitchTempoControls track={track} onReplaceClip={onReplaceClip}/>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Clip rendered on canvas row
// ─────────────────────────────────────────────────────────────────────────────

function drawTrackRow(canvas, track, clips, zoom, scroll, playhead, taal, bpm, color, selectedClipId) {
  if (!canvas || canvas.width === 0) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const canvasBg = themeVar('--canvas-bg', '#0d0d11');
  const gridWeak = themeVar('--canvas-grid', 'rgba(255,255,255,0.05)');
  const gridStrong = themeVar('--canvas-grid-strong', 'rgba(201,125,58,0.35)');
  const gridLabel = themeVar('--canvas-grid-label', 'rgba(201,125,58,0.45)');
  const accent = themeVar('--accent', '#c97d3a');
  const playheadColor = themeVar('--canvas-playhead', '#ffffff');
  ctx.fillStyle = canvasBg;
  ctx.fillRect(0, 0, W, H);

  // Taal grid (behind everything)
  if (taal && bpm > 0) {
    const T = TAALS.find(x=>x.name===taal);
    if (T) {
      const spb        = 60 / bpm;                    // seconds per beat
      const cycleBeats = T.beats;                      // total beats per cycle
      const cycleSec   = spb * cycleBeats;             // seconds per full cycle
      const totalSec   = (W + scroll) / zoom + 2;      // seconds visible + buffer

      // Repeat grid across entire visible timeline
      let cycleStart = 0;
      while (cycleStart * zoom - scroll < W) {
        let cum = 0;
        T.vibhag.forEach((v, vi) => {
          for (let b = 0; b < v; b++) {
            const beatSec = cycleStart + (cum + b) * spb;
            const px      = beatSec * zoom - scroll;
            if (px < -2 || px > W + 2) { cum += (b === v-1 ? v : 0); continue; }
            const isSam = cum + b === 0;
            const isVib = b === 0;
            ctx.strokeStyle = isSam ? accent : isVib ? gridStrong : gridWeak;
            ctx.lineWidth   = isSam ? 2 : isVib ? 1 : 0.5;
            ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
            if (isSam || isVib) {
              ctx.fillStyle = isSam ? accent : gridLabel;
              ctx.font = '9px monospace';
              ctx.fillText(isSam ? 'Sam' : `V${vi+1}`, px + 3, 10);
            }
          }
          cum += v;
        });
        cycleStart += cycleSec;
        if (cycleStart > totalSec + cycleSec) break; // safety
      }
    }
  }

  // Draw each clip
  clips.forEach(clip => {
    if (!clip.waveData) {
      // Placeholder
      const x0 = clip.startOffset*zoom - scroll;
      const x1 = (clip.startOffset+(clip.trimEnd-clip.trimStart))*zoom - scroll;
      if (x1<0||x0>W) return;
      ctx.fillStyle = color+'22';
      ctx.fillRect(Math.max(0,x0), 2, Math.min(W,x1)-Math.max(0,x0), H-4);
      ctx.fillStyle = color+'88';
      ctx.font='11px sans-serif';
      ctx.fillText('Loading…', Math.max(0,x0)+8, H/2+4);
      return;
    }

    const { peaks, rms, resolution, duration } = clip.waveData;
    const clipDur = clip.trimEnd - clip.trimStart;
    const cx0 = clip.startOffset*zoom - scroll;
    const cx1 = cx0 + clipDur*zoom;
    if (cx1<0||cx0>W) return;

    const isSel = clip.id === selectedClipId;
    // Clip background
    ctx.fillStyle = isSel ? color+'18' : color+'0a';
    ctx.fillRect(Math.max(0,cx0), 0, Math.min(W,cx1)-Math.max(0,cx0), H);

    // Waveform bars
    const mid = H/2;
    for (let px=Math.max(0,Math.floor(cx0)); px<Math.min(W,Math.ceil(cx1)); px++) {
      const sec = (px+scroll)/zoom - clip.startOffset + clip.trimStart;
      if (sec<clip.trimStart||sec>clip.trimEnd) continue;
      const bi = Math.min(Math.floor((sec/duration)*resolution), resolution-1);
      const p  = peaks[bi]||0, r = rms[bi]||0;
      ctx.fillStyle = color+'55';
      ctx.fillRect(px, mid-p*mid*0.9, 1, p*mid*1.8);
      ctx.fillStyle = color;
      ctx.fillRect(px, mid-r*mid*0.88, 1, r*mid*1.76);
    }

    // Selection highlight
    if (isSel && clip.selStart!=null && clip.selEnd!=null && clip.selEnd>clip.selStart) {
      const sx0 = Math.max(0, (clip.startOffset+clip.selStart-clip.trimStart)*zoom-scroll);
      const sx1 = Math.min(W, (clip.startOffset+clip.selEnd-clip.trimStart)*zoom-scroll);
      ctx.fillStyle = 'rgba(139,78,163,0.3)';
      ctx.fillRect(sx0, 0, sx1-sx0, H);
      ctx.strokeStyle = '#8b4ea3'; ctx.lineWidth=1;
      ctx.strokeRect(sx0, 0, sx1-sx0, H);
    }

    // Clip border
    ctx.strokeStyle = isSel ? color : color+'66';
    ctx.lineWidth   = isSel ? 2 : 1;
    const bx0 = Math.max(0,cx0), bx1 = Math.min(W,cx1);
    ctx.strokeRect(bx0, 1, bx1-bx0, H-2);

    // Clip label
    ctx.fillStyle = color+'cc';
    ctx.font = '9px sans-serif';
    const labelX = Math.max(bx0+4, 4);
    if (labelX < bx1-10) ctx.fillText(clip.id, labelX, H-5);
  });

  // Playhead
  const ph = playhead*zoom - scroll;
  if (ph>=0&&ph<=W) {
    ctx.fillStyle = playheadColor; ctx.fillRect(ph-1,0,2,H);
    ctx.beginPath(); ctx.arc(ph,5,5,0,Math.PI*2); ctx.fill();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit bar
// ─────────────────────────────────────────────────────────────────────────────

function EditBar({ selTrack, selClip, onSplit, onCopy, onPaste, onDeleteClip, onDeleteTrack, onAddBlank, onCopyToTrack }) {
  const hasSel = selClip?.selStart!=null && selClip?.selEnd!=null && selClip.selEnd>selClip.selStart;
  return (
    <div style={{ padding:'5px 12px', borderBottom:'1px solid var(--border)',
      background:'var(--editbar-bg)', display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', flexShrink:0 }}>
      {selTrack ? (
        <span style={{ fontSize:10, color:'var(--accent)', marginRight:4 }}>✦ {selTrack.name}</span>
      ) : (
        <span style={{ fontSize:10, color:'var(--muted)' }}>Click a track to select</span>
      )}
      {[
        { lbl:'Split clip',    icon:'✂', fn:onSplit,       dis:!selClip },
        { lbl:'Copy sel.',     icon:'⎘', fn:onCopy,        dis:!hasSel },
        { lbl:'Paste',         icon:'⏵', fn:onPaste,       dis:!clipboard },
        { lbl:'Delete clip',   icon:'⊟', fn:onDeleteClip,  dis:!selClip },
        { lbl:'Copy to new track', icon:'⊞', fn:onCopyToTrack, dis:!selClip },
        { lbl:'Delete track',      icon:'🗑', fn:onDeleteTrack,  dis:!selTrack },
        { lbl:'Add blank track',   icon:'+',  fn:onAddBlank,    dis:false },
      ].map(({lbl,icon,fn,dis})=>(
        <button key={lbl} onClick={fn} disabled={dis} title={lbl}
          style={{ padding:'3px 8px', fontSize:10, border:'1px solid var(--border)',
            borderRadius:4, cursor:dis?'not-allowed':'pointer', background:'transparent',
            color:dis?'var(--muted)':'var(--text)', opacity:dis?0.4:1,
            display:'flex', alignItems:'center', gap:3 }}>
          {icon} {lbl}
        </button>
      ))}
      {hasSel && (
        <span style={{ fontSize:9, color:'var(--muted)', marginLeft:4 }}>
          {fmt(selClip.selStart)}→{fmt(selClip.selEnd)} ({fmt(selClip.selEnd-selClip.selStart)})
        </span>
      )}
      <span style={{ fontSize:9, color:'var(--muted)', marginLeft:'auto' }}>
        drag=select · ⌥+drag=move clip · handles=trim
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Export panel
// ─────────────────────────────────────────────────────────────────────────────

function ExportPanel({ tracks }) {
  const [fmt2, setFmt2] = useState('mp3');
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [prog,   setProg]   = useState(0);

  const anySolo = tracks.some(t=>t.solo);
  const active  = tracks.filter(t=>!t.muted&&(!anySolo||t.solo)&&t.clips.some(c=>c.buffer));

  const doExport = async () => {
    if (!active.length) return;
    setStatus('busy'); setResult(null); setProg(0);
    const fd = new FormData();
    // Export first clip of each active track (simplified — full mix via backend)
    active.forEach(t => {
      const c = t.clips.find(c=>c.buffer);
      if (!c) return;
      fd.append('files',        t.file);
      fd.append('trim_starts',  c.trimStart);
      fd.append('trim_ends',    c.trimEnd);
      fd.append('fade_ins',     t.fadeIn||0);
      fd.append('fade_outs',    t.fadeOut||0);
      fd.append('volumes',      t.volume);
      fd.append('time_offsets', c.startOffset||0);
    });
    fd.append('output_format', fmt2);
    try {
      const r    = await fetch(`${API_BASE}/api/mix-export`,{method:'POST',body:fd});
      const data = await r.json();
      const poll = setInterval(async()=>{
        const j = await fetch(`${API_BASE}/job/${data.job_id}`).then(x=>x.json());
        if (j.progress) setProg(j.progress);
        if (j.status==='done') { clearInterval(poll); setStatus('done'); setResult(j.files?.[0]); }
        if (j.status==='error') { clearInterval(poll); setStatus('err'); }
      },1000);
    } catch { setStatus('err'); }
  };

  return (
    <div style={{ padding:'7px 14px', borderTop:'1px solid var(--border)',
      background:'var(--bg2)', flexShrink:0 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
        <span style={{ fontSize:11, color:'var(--muted)' }}>
          Export · {active.length} track{active.length!==1?'s':''}
          {tracks.some(t=>t.muted)&&<span style={{color:'#e05c5c',marginLeft:5}}>
            ({tracks.filter(t=>t.muted).length} muted)</span>}
        </span>
        <select value={fmt2} onChange={e=>setFmt2(e.target.value)}
          style={{ background:'var(--bg3)', border:'1px solid var(--border)',
            borderRadius:5, color:'var(--text)', padding:'3px 7px', fontSize:11 }}>
          <option value='mp3'>MP3</option>
          <option value='wav'>WAV</option>
        </select>
        <button className='btn-primary' onClick={doExport}
          disabled={status==='busy'||!active.length}
          style={{ padding:'5px 14px', fontSize:11 }}>
          {status==='busy'?'Rendering…':'↓ Export Mix'}
        </button>
        {status==='busy'&&(
          <div style={{ flex:1, minWidth:80, height:3, background:'var(--border)', borderRadius:3, overflow:'hidden' }}>
            <div style={{ height:'100%', width:`${prog}%`,
              background:'linear-gradient(90deg,var(--accent),#8b4ea3)', transition:'width 0.4s' }}/>
          </div>
        )}
        {status==='done'&&result&&(
          <>
            <audio controls src={`${API_BASE}/download/${result.filename}`} style={{ height:26, flex:1, minWidth:140 }}/>
            <a className='download-btn' href={`${API_BASE}/download/${result.filename}`}
              download={result.filename} style={{ fontSize:10, padding:'4px 10px' }}>↓ Save</a>
          </>
        )}
        {status==='err'&&<span style={{ color:'var(--error)', fontSize:11 }}>Export failed.</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main DAW
// ─────────────────────────────────────────────────────────────────────────────

export default function Workshop({
  tracks, setTracks, zoom, setZoom,
  taal, setTaal, bpm, setBpm,
  showTaal, setShowTaal, masterVol, setMasterVol,
  importBatch,
}) {
  const [playing,     setPlaying]     = useState(false);
  const [toolMode,    setToolMode]    = useState('select'); // 'select'|'hand'|'cursor'
  const [timeLabel,   setTimeLabel]   = useState('0:00');
  const [selectedTId, setSelectedTId] = useState(null);
  const [selectedCId, setSelectedCId] = useState(null);
  const [pendingProj, setPendingProj] = useState(null);
  const [playSelectedIds, setPlaySelectedIds] = useState([]);

  // Spacebar play/pause
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space') return;
      // Don't intercept if user is typing in an input
      if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
      e.preventDefault();
      if (mixer.playing) { mixer.pause(); setPlaying(false); }
      else if (playSelectedIds.length) {
        mixer.playSelected(playSelectedIds); setPlaying(true);
      } else {
        mixer.play(); setPlaying(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playSelectedIds]);

  const zoomRef     = useRef(zoom);
  const toolModeRef = useRef('select');
  const scrollRef   = useRef(0);
  const tracksRef   = useRef(tracks);
  const showTaalRef = useRef(showTaal);
  const taalRef     = useRef(taal);
  const bpmRef      = useRef(bpm);
  const waveRefs    = useRef({});   // trackId -> canvas
  const rulerRef    = useRef(null);
  const scrollEl    = useRef(null);
  const dragRef     = useRef(null);
  const fileRef     = useRef(null);
  const projRef     = useRef(null);
  const dragIdxRef  = useRef(null);
  const importRef   = useRef(null);

  useEffect(()=>{ zoomRef.current=zoom; },[zoom]);
  useEffect(()=>{ toolModeRef.current=toolMode; },[toolMode]);
  useEffect(()=>{ tracksRef.current=tracks; },[tracks]);
  useEffect(()=>{ showTaalRef.current=showTaal; },[showTaal]);
  useEffect(()=>{ taalRef.current=taal; },[taal]);
  useEffect(()=>{ bpmRef.current=bpm; },[bpm]);

  // Canvas sizing via ResizeObserver
  const sizeCanvas = (canvas, h) => {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const w    = Math.max(rect.width||800, 200);
    if (canvas.width!==Math.round(w)) canvas.width = Math.round(w);
    if (canvas.height!==h)            canvas.height = h;
  };

  useEffect(()=>{
    const obs = new ResizeObserver(()=>{
      sizeCanvas(rulerRef.current, 24);
      tracksRef.current.forEach(t=>sizeCanvas(waveRefs.current[t.id], TRACK_H));
    });
    if (scrollEl.current) obs.observe(scrollEl.current);
    return ()=>obs.disconnect();
  },[]);

  // Single RAF loop
  useEffect(()=>{
    let frame;
    const loop = ()=>{
      const ph     = mixer.currentTime;
      const zoom   = zoomRef.current;
      const scroll = scrollRef.current;
      const ts     = tracksRef.current;
      setTimeLabel(fmt(ph));
      drawRuler(rulerRef.current, zoom, scroll);
      ts.forEach((t,i)=>{
        const c = waveRefs.current[t.id];
        if (!c) return;
        const selClipId = selectedCId;
        drawTrackRow(c, t, t.clips, zoom, scroll, ph,
          showTaalRef.current?taalRef.current:null,
          bpmRef.current, COLORS[i%COLORS.length], selClipId);
      });
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return ()=>cancelAnimationFrame(frame);
  },[selectedCId]);

  // ── Load audio file into a clip ─────────────────────────────────────────

  const loadFileIntoTrack = async (trackId, file, clipOverrides={}) => {
    const buf = await mixer.load(trackId, file);
    setPlaySelectedIds((prev) => (prev.includes(trackId) ? prev : [...prev, trackId]));
    const clip = makeClip({
      duration:  buf.duration,
      trimStart: 0,
      trimEnd:   buf.duration,
      buffer:    buf,
      ...clipOverrides,
    });
    // Add clip to track
    setTracks(prev=>prev.map(t=>t.id===trackId
      ? { ...t, file, clips:[...t.clips, clip] }
      : t));
    // Build waveData async
    setTimeout(()=>{
      const wd = buildWaveData(buf, 1500);
      setTracks(prev=>prev.map(t=>t.id===trackId
        ? { ...t, clips: t.clips.map(c=>c.id===clip.id ? {...c, waveData:wd} : c) }
        : t));
    }, 50);
    return { buf, clip };
  };

  const addFiles = async (files) => {
    const blankTrackIds = tracksRef.current
      .filter((track) => isEmptyTrack(track))
      .map((track) => track.id);

    for (const file of Array.from(files || [])) {
      const reuseTrackId = blankTrackIds.shift();
      if (reuseTrackId != null) {
        setTracks((prev) => prev.map((track) => (
          track.id === reuseTrackId ? { ...track, name: file.name } : track
        )));
        try {
          await loadFileIntoTrack(reuseTrackId, file);
        } catch (e) { console.error(e); }
        continue;
      }

      const track = makeTrack({ name: file.name });
      setTracks(prev=>[...prev, track]);
      try {
        await loadFileIntoTrack(track.id, file);
      } catch(e){ console.error(e); }
    }
  };

  const addBlankTrack = () => {
    const track = makeTrack({ name: `Track ${tracks.length+1}` });
    setTracks(prev=>[...prev, track]);
  };

  const updateTrack = (id, updates) => {
    setTracks(prev=>prev.map(t=>t.id===id?{...t,...updates}:t));
  };

  const toggleTrackPlaySelection = (id) => {
    setPlaySelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const updateClip = (trackId, clipId, updates) => {
    setTracks(prev=>prev.map(t=>t.id===trackId
      ? {...t, clips:t.clips.map(c=>c.id===clipId?{...c,...updates}:c)}
      : t));
  };

  const removeTrack = (id) => {
    mixer.remove(id);
    delete waveRefs.current[id];
    setTracks(prev=>prev.filter(t=>t.id!==id));
    setPlaySelectedIds(prev=>prev.filter(item=>item!==id));
    if (selectedTId===id) { setSelectedTId(null); setSelectedCId(null); }
  };

  // ── Replace clip in place (after pitch/tempo processing) ──────────────────
  const replaceClip = async (trackId, newFile) => {
    const track = tracksRef.current.find(t => t.id === trackId);
    if (!track) return;
    try {
      // Stop and fully remove old audio from mixer before loading new one
      const wasPlaying = mixer.playing;
      if (wasPlaying) { mixer.pause(); setPlaying(false); }
      mixer.remove(trackId); // clears old buffer, gain node, source

      const buf = await mixer.load(trackId, newFile);
      setPlaySelectedIds((prev) => (prev.includes(trackId) ? prev : [...prev, trackId]));
      const wd  = buildWaveData(buf, 1500);

      setTracks(prev => prev.map(t => {
        if (t.id !== trackId) return t;
        const clips   = t.clips || [];
        const oldClip = clips[0];
        const newClip = oldClip
          ? { ...oldClip, buffer: buf, waveData: wd, duration: buf.duration,
              trimEnd: Math.min(oldClip.trimEnd, buf.duration) }
          : makeClip({ buffer: buf, waveData: wd, duration: buf.duration, trimEnd: buf.duration });
        return { ...t, file: newFile, clips: [newClip, ...clips.slice(1)] };
      }));

      // Resume playback if it was playing before
      if (wasPlaying) { mixer.play(); setPlaying(true); }
    } catch (e) { console.error('Replace clip failed', e); }
  };

  // ── Transport ───────────────────────────────────────────────────────────

  // MUST be synchronous - browser autoplay requires direct click handler
  const togglePlay = () => {
    if (mixer.playing) {
      mixer.pause();
      setPlaying(false);
    } else {
      if (mixer.playing) mixer.stop();
      if (playSelectedIds.length) mixer.playSelected(playSelectedIds);
      else mixer.play();
      setPlaying(true);
    }
  };
  const stop = ()=>{ mixer.stop(); setPlaying(false); };

  // ── Editing ─────────────────────────────────────────────────────────────

  const selTrack = tracks.find(t=>t.id===selectedTId);
  const selClip  = selTrack?.clips.find(c=>c.id===selectedCId);

  const splitClip = ()=>{
    if (!selTrack||!selClip) return;
    const ph = mixer.currentTime;
    // ph in clip-local time
    const localPh = ph - selClip.startOffset + selClip.trimStart;
    if (localPh<=selClip.trimStart||localPh>=selClip.trimEnd) return;

    // Clip A: original up to split point
    const clipA = { ...selClip, trimEnd: localPh, selStart:null, selEnd:null };
    // Clip B: from split point, placed right after clip A on timeline
    const clipB = makeClip({
      buffer:      selClip.buffer,
      waveData:    selClip.waveData,
      duration:    selClip.duration,
      trimStart:   localPh,
      trimEnd:     selClip.trimEnd,
      startOffset: selClip.startOffset + (localPh - selClip.trimStart),
      selStart:    null,
      selEnd:      null,
    });

    setTracks(prev=>prev.map(t=>t.id===selectedTId
      ? { ...t, clips: t.clips.map(c=>c.id===selectedCId?clipA:c).concat(clipB) }
      : t));
    setSelectedCId(clipB.id);
  };

  const copySelection = ()=>{
    if (!selClip||selClip.selStart==null) return;
    clipboard = {
      buffer:    selClip.buffer,
      waveData:  selClip.waveData,
      duration:  selClip.duration,
      trimStart: selClip.selStart,
      trimEnd:   selClip.selEnd,
      file:      selTrack?.file,
      trackId:   selectedTId,
    };
  };

  const pasteClipboard = ()=>{
    if (!clipboard||!selectedTId) return;
    const ph  = mixer.currentTime;
    const clip = makeClip({
      buffer:      clipboard.buffer,
      waveData:    clipboard.waveData,
      duration:    clipboard.duration,
      trimStart:   clipboard.trimStart,
      trimEnd:     clipboard.trimEnd,
      startOffset: ph,
    });
    setTracks(prev=>prev.map(t=>t.id===selectedTId
      ? { ...t, clips:[...t.clips, clip] }
      : t));
    setSelectedCId(clip.id);
    // reload into mixer if same track
    if (clipboard.file) mixer.load(selectedTId, clipboard.file).catch(()=>{});
  };

  const deleteClip = ()=>{
    if (!selTrack||!selClip) return;
    setTracks(prev=>prev.map(t=>t.id===selectedTId
      ? { ...t, clips:t.clips.filter(c=>c.id!==selectedCId) }
      : t));
    setSelectedCId(null);
  };

  const copyClipToNewTrack = () => {
    if (!selClip || !selTrack) return;
    const newTrack = makeTrack({
      name:   `${selTrack.name} (clip)`,
      file:   selTrack.file,
      volume: selTrack.volume,
    });
    const newClip = makeClip({
      buffer:      selClip.buffer,
      waveData:    selClip.waveData,
      duration:    selClip.duration,
      trimStart:   selClip.trimStart,
      trimEnd:     selClip.trimEnd,
      startOffset: selClip.startOffset,
    });
    newTrack.clips = [newClip];
    setTracks(prev => [...prev, newTrack]);
    if (selTrack.file) mixer.load(newTrack.id, selTrack.file).catch(console.error);
    setSelectedTId(newTrack.id);
    setSelectedCId(newClip.id);
  };

  // ── Mouse handlers ──────────────────────────────────────────────────────

  const makeMouse = (track) => {
    const toSec = (e) => {
      const c    = waveRefs.current[track.id];
      if (!c) return 0;
      const rect = c.getBoundingClientRect();
      const scale = c.width / rect.width;
      return ((e.clientX-rect.left)*scale + scrollRef.current) / zoomRef.current;
    };

    const hitClip = (sec) => {
      return track.clips.find(c=>{
        const end = c.startOffset + (c.trimEnd-c.trimStart);
        return sec>=c.startOffset && sec<=end;
      });
    };

    return {
      onMouseDown: (e)=>{
        e.preventDefault();
        setSelectedTId(track.id);
        const sec  = toSec(e);
        const clip = hitClip(sec);
        const mode = toolModeRef.current;

        // Seek-only mode
        if (mode==='cursor') { mixer.seek(Math.max(0,sec)); return; }

        if (clip) {
          setSelectedCId(clip.id);
          const c    = waveRefs.current[track.id];
          const rect = c.getBoundingClientRect();
          const scale= c.width/rect.width;
          const cx   = (e.clientX-rect.left)*scale;
          const x0   = clip.startOffset*zoomRef.current - scrollRef.current;
          const x1   = (clip.startOffset+(clip.trimEnd-clip.trimStart))*zoomRef.current - scrollRef.current;

          if (mode==='hand' || e.altKey) {
            // Hand tool always moves clip
            dragRef.current={type:'moveClip',trackId:track.id,clipId:clip.id,startX:e.clientX,startVal:clip.startOffset};
          } else if (Math.abs(cx-x0)<10) {
            dragRef.current={type:'trimStart',trackId:track.id,clipId:clip.id,startX:e.clientX,startVal:clip.trimStart};
          } else if (Math.abs(cx-x1)<10) {
            dragRef.current={type:'trimEnd',trackId:track.id,clipId:clip.id,startX:e.clientX,startVal:clip.trimEnd};
          } else {
            // Select mode — draw selection
            const localSec = sec - clip.startOffset + clip.trimStart;
            dragRef.current={type:'select',trackId:track.id,clipId:clip.id,startT:localSec};
            updateClip(track.id, clip.id, {selStart:localSec, selEnd:localSec});
          }
        } else {
          setSelectedCId(null);
          mixer.seek(Math.max(0,sec));
          setPlaying(mixer.playing);
        }
      },

      onMouseMove: (e)=>{
        const dr = dragRef.current;
        if (!dr||dr.trackId!==track.id) return;
        const dx = (e.clientX-dr.startX)/zoomRef.current;
        const clip = track.clips.find(c=>c.id===dr.clipId);
        if (!clip) return;

        if (dr.type==='trimStart') {
          const v=Math.max(0,Math.min(dr.startVal+dx, clip.trimEnd-0.05));
          updateClip(track.id,dr.clipId,{trimStart:v});
        } else if (dr.type==='trimEnd') {
          const v=Math.max(clip.trimStart+0.05,Math.min(dr.startVal+dx,clip.duration));
          updateClip(track.id,dr.clipId,{trimEnd:v});
        } else if (dr.type==='moveClip') {
          const v=Math.max(0,dr.startVal+dx);
          updateClip(track.id,dr.clipId,{startOffset:v});
        } else if (dr.type==='select') {
          const sec     = toSec(e);
          const localT  = sec - clip.startOffset + clip.trimStart;
          const s=Math.min(dr.startT,localT), e2=Math.max(dr.startT,localT);
          updateClip(track.id,dr.clipId,{selStart:s,selEnd:e2});
        }
      },

      onMouseUp: ()=>{ dragRef.current=null; },
    };
  };

  // ── Zoom / scroll ───────────────────────────────────────────────────────

  const onWheel = (e)=>{
    if (!e.ctrlKey&&!e.metaKey) return;
    e.preventDefault();

    const el = scrollEl.current;
    if (!el) return;

    // Time position under cursor before zoom
    const rect     = el.getBoundingClientRect();
    const cursorX  = e.clientX - rect.left;          // px from left edge of scroll area
    const timeSec  = (cursorX + scrollRef.current) / zoomRef.current;

    // New zoom level
    const factor   = e.deltaY < 0 ? 1.12 : 0.89;
    const newZoom  = Math.max(8, Math.min(800, zoomRef.current * factor));
    zoomRef.current = newZoom;
    setZoom(newZoom);

    // Adjust scrollLeft so the same time stays under the cursor
    const newScrollLeft = timeSec * newZoom - cursorX;
    scrollRef.current   = Math.max(0, newScrollLeft);
    el.scrollLeft       = scrollRef.current;
  };
  const onScroll = (e)=>{ scrollRef.current=e.currentTarget.scrollLeft; };

  // ── Project save / load ─────────────────────────────────────────────────

  const saveProject = ()=>{
    const proj={
      version:2, savedAt:new Date().toISOString(),
      zoom, taal, bpm, showTaal, masterVol,
      tracks: tracks.map(t=>({
        name:t.name, volume:t.volume, muted:t.muted,
        solo:t.solo, fadeIn:t.fadeIn||0, fadeOut:t.fadeOut||0,
        clips: t.clips.map(c=>({
          trimStart:c.trimStart, trimEnd:c.trimEnd,
          startOffset:c.startOffset, duration:c.duration,
        })),
      })),
    };
    const a=Object.assign(document.createElement('a'),{
      href:URL.createObjectURL(new Blob([JSON.stringify(proj,null,2)],{type:'application/json'})),
      download:`surtaal-${new Date().toISOString().slice(0,10)}.surtaal`,
    });
    a.click();
  };

  const loadProject = (e)=>{
    const file=e.target.files?.[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try {
        const proj=JSON.parse(ev.target.result);
        setZoom(proj.zoom||80); zoomRef.current=proj.zoom||80;
        setTaal(proj.taal||'Teentaal'); taalRef.current=proj.taal||'Teentaal';
        setBpm(proj.bpm||120); bpmRef.current=proj.bpm||120;
        setShowTaal(proj.showTaal||false);
        setMasterVol(proj.masterVol||1); mixer.setMasterVol(proj.masterVol||1);
        setPendingProj(proj);
      } catch { alert('Invalid project file'); }
    };
    reader.readAsText(file);
    e.target.value='';
  };

  // ── Drag reorder ────────────────────────────────────────────────────────

  const reorder=(from,to)=>{
    setTracks(prev=>{const a=[...prev];const[m]=a.splice(from,1);a.splice(to,0,m);return a;});
  };

  // maxDur: use full audio duration from buffer, not just trimmed region
  // This ensures the timeline is wide enough to show the complete track
  const maxDur = Math.max(60, ...tracks.flatMap(t =>
    t.clips.map(c => (c.startOffset || 0) + (c.duration || (c.trimEnd - c.trimStart)) + 2)
  ));
  const tlWidth = maxDur * zoom + 400;

  useEffect(() => {
    if (!importBatch?.id || importRef.current === importBatch.id) return;
    importRef.current = importBatch.id;
    addFiles(importBatch.files);
  }, [importBatch]);

  useEffect(() => {
    setPlaySelectedIds(prev => prev.filter(id => tracks.some(track => track.id === id)));
  }, [tracks]);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>

      {/* Toolbar */}
      <div style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 12px',
        borderBottom:'1px solid var(--border)', background:'var(--bg2)',
        flexShrink:0, flexWrap:'wrap' }}>

        <button className='btn-primary' onClick={togglePlay} disabled={!tracks.length}
          title={playing?'Pause playback':playSelectedIds.length?'Play checked tracks':'Play all tracks'}
          style={{ padding:'5px 14px', fontSize:12, minWidth:64 }}>
          {playing?'⏸ Pause':'▶ Play'}
        </button>
        <button className='btn-ghost' onClick={stop} title='Stop and return to beginning' style={{ padding:'5px 8px', fontSize:12 }}>⏹</button>
        <span style={{ fontFamily:'monospace', fontSize:13, color:'var(--accent)', minWidth:52 }}>
          {timeLabel}
        </span>

        <div style={{ width:1, height:20, background:'var(--border)' }}/>
        {/* Tool mode */}
        {[
          { id:'select', icon:'⬚', tip:'Select & trim (drag=selection, handles=trim)' },
          { id:'hand',   icon:'✥', tip:'Move clip (drag moves clip on timeline)' },
          { id:'cursor', icon:'↖', tip:'Seek only (click to set playhead)' },
        ].map(({id,icon,tip})=>(
          <button key={id} onClick={()=>setToolMode(id)} title={tip}
            style={{ width:28, height:24, fontSize:13, border:'1px solid',
              borderRadius:4, cursor:'pointer', padding:0,
              borderColor: toolMode===id ? 'var(--accent)' : 'var(--border)',
              background:  toolMode===id ? 'rgba(201,125,58,0.15)' : 'transparent',
              color:       toolMode===id ? 'var(--accent)' : 'var(--muted)' }}>
            {icon}
          </button>
        ))}
        <div style={{ width:1, height:20, background:'var(--border)' }}/>
        <span style={{ fontSize:10, color:'var(--muted)' }}>Zoom</span>
        <button className='btn-ghost' title='Zoom out (or ⌘+scroll)' style={{ padding:'2px 5px', fontSize:11 }}
          onClick={()=>{
            const el=scrollEl.current;
            const centreTime=el?(scrollRef.current+el.clientWidth/2)/zoomRef.current:0;
            const n=Math.max(1,zoomRef.current*0.7); zoomRef.current=n; setZoom(n);
            if(el){const s=centreTime*n-el.clientWidth/2;el.scrollLeft=Math.max(0,s);scrollRef.current=Math.max(0,s);}
          }}>−</button>
        <input type='range' min={1} max={800} value={zoom}
          onChange={e=>{
            const el=scrollEl.current;
            const centreTime=el?(scrollRef.current+el.clientWidth/2)/zoomRef.current:0;
            const n=Number(e.target.value); zoomRef.current=n; setZoom(n);
            if(el){const s=centreTime*n-el.clientWidth/2;el.scrollLeft=Math.max(0,s);scrollRef.current=Math.max(0,s);}
          }}
          style={{ width:60 }}/>
        <button className='btn-ghost' title='Zoom in (or ⌘+scroll)' style={{ padding:'2px 5px', fontSize:11 }}
          onClick={()=>{
            const el=scrollEl.current;
            const centreTime=el?(scrollRef.current+el.clientWidth/2)/zoomRef.current:0;
            const n=Math.min(800,zoomRef.current*1.4); zoomRef.current=n; setZoom(n);
            if(el){const s=centreTime*n-el.clientWidth/2;el.scrollLeft=Math.max(0,s);scrollRef.current=Math.max(0,s);}
          }}>+</button>
        <span style={{ fontSize:9, color:'var(--muted)', fontFamily:'monospace', width:40 }}>{zoom<10?zoom.toFixed(1):Math.round(zoom)}px/s</span>

        <div style={{ width:1, height:20, background:'var(--border)' }}/>
        <span style={{ fontSize:10, color:'var(--muted)' }} title='Master output volume'>Master</span>
        <input type='range' min={0} max={1} step={0.01} value={masterVol}
          onChange={e=>{const v=Number(e.target.value);setMasterVol(v);mixer.setMasterVol(v);}}
          style={{ width:52 }}/>
        <span style={{ fontSize:9, color:'var(--muted)', fontFamily:'monospace' }}>{Math.round(masterVol*100)}%</span>

        <div style={{ width:1, height:20, background:'var(--border)' }}/>
        <label style={{ display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}>
          <span className='toggle'>
            <input type='checkbox' checked={showTaal}
              onChange={e=>{setShowTaal(e.target.checked);showTaalRef.current=e.target.checked;}}/>
            <span className='toggle-slider'/>
          </span>
          <span style={{ fontSize:10, color:'var(--muted)' }} title='Show taal beat grid on waveforms'>Taal</span>
        </label>
        {showTaal&&<>
          <select value={taal} onChange={e=>{setTaal(e.target.value);taalRef.current=e.target.value;}}
            style={{ background:'var(--bg3)', border:'1px solid var(--border)',
              borderRadius:5, color:'var(--text)', padding:'2px 5px', fontSize:10 }}>
            {TAALS.map(t=><option key={t.name} value={t.name}>{t.name} ({t.beats})</option>)}
          </select>
          <input type='number' value={bpm}
            onChange={e=>{const v=Number(e.target.value);setBpm(v);bpmRef.current=v;}}
            style={{ width:42, background:'var(--bg3)', border:'1px solid var(--border)',
              borderRadius:5, color:'var(--text)', padding:'2px 4px', fontSize:10 }}/>
          <span style={{ fontSize:10, color:'var(--muted)' }}>BPM</span>
        </>}

        <div style={{ display:'flex', gap:4, marginLeft:'auto' }}>
          <button className='btn-ghost' onClick={saveProject} disabled={!tracks.length}
            title='Save project settings to .surtaal file'
            style={{ padding:'4px 9px', fontSize:10 }}>💾 Save</button>
          <button className='btn-ghost' onClick={()=>projRef.current?.click()}
            title='Load a previously saved .surtaal project'
            style={{ padding:'4px 9px', fontSize:10 }}>📂 Load</button>
          <input ref={projRef} type='file' accept='.surtaal,application/json'
            style={{ display:'none' }} onChange={loadProject}/>
          <button className='btn-ghost'
            title='Fit all tracks to screen width'
            style={{ padding:'4px 9px', fontSize:10 }}
            onClick={()=>{
              const el = scrollEl.current;
              if (!el || tracksRef.current.length === 0) return;
              // Use full audio duration (not just trimmed length) across all tracks
              const maxD = Math.max(...tracksRef.current.flatMap(t =>
                t.clips.map(c => (c.startOffset || 0) + (c.duration || c.trimEnd))
              ));
              if (!maxD) return;
              // Fit the longest track to the visible container width
              // No minimum — let it go as low as needed to fit the full track
              const fitZoom = Math.max(1, (el.clientWidth - 20) / maxD);
              zoomRef.current = fitZoom; setZoom(fitZoom);
              scrollRef.current = 0; el.scrollLeft = 0;
            }}>⊡ Fit</button>
          <button className='btn-ghost' onClick={()=>fileRef.current?.click()}
            title='Add audio tracks (MP3, WAV, FLAC)'
            style={{ padding:'4px 9px', fontSize:10 }}>+ Add</button>
          <input ref={fileRef} type='file' accept='audio/*' multiple
            style={{ display:'none' }} onChange={e=>{addFiles(e.target.files);e.target.value='';}}/>
        </div>
      </div>

      {/* Edit bar */}
      <EditBar
        selTrack={selTrack} selClip={selClip}
        onSplit={splitClip} onCopy={copySelection}
        onPaste={pasteClipboard} onDeleteClip={deleteClip}
        onDeleteTrack={()=>selTrack&&removeTrack(selTrack.id)}
        onAddBlank={addBlankTrack}
        onCopyToTrack={copyClipToNewTrack}
      />

      {/* Timeline */}
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
        {tracks.length===0 ? (
          <div style={{ flex:1, display:'flex', flexDirection:'column',
            alignItems:'center', justifyContent:'center',
            color:'var(--muted)', gap:10, cursor:'pointer' }}
            onClick={()=>fileRef.current?.click()}
            onDragOver={e=>e.preventDefault()}
            onDrop={e=>{e.preventDefault();addFiles(e.dataTransfer.files);}}>
            <div style={{ fontSize:52, opacity:0.12 }}>𝄞</div>
            <p style={{ fontSize:14, fontWeight:500 }}>Drop audio files to begin</p>
            <p style={{ fontSize:11 }}>⌘+scroll=zoom · drag clip=select · ⌥+drag=move clip</p>
            <button className='btn-primary' style={{ marginTop:4 }}
              onClick={e=>{e.stopPropagation();fileRef.current?.click();}}>+ Add Tracks</button>
          </div>
        ) : (
          <>
            {/* Fixed left panels */}
            <div style={{ width:LEFT_W, flexShrink:0, display:'flex',
              flexDirection:'column', borderRight:'1px solid var(--border)', zIndex:2 }}>
              <div style={{ height:24, background:'var(--canvas-ruler-bg)',
                borderBottom:'1px solid var(--border)',
                display:'flex', alignItems:'center', paddingLeft:10 }}>
                <span style={{ fontSize:8, color:'var(--muted)',
                  textTransform:'uppercase', letterSpacing:'0.08em' }}>Tracks</span>
              </div>
              <div style={{ overflowY:'auto', flex:1 }}>
                {tracks.map((t,i)=>(
                  <TrackPanel key={t.id} track={t} color={COLORS[i%COLORS.length]}
                    selected={t.id===selectedTId}
                    playSelected={playSelectedIds.includes(t.id)}
                    onTogglePlaySelected={()=>toggleTrackPlaySelection(t.id)}
                    onSelect={()=>setSelectedTId(t.id)}
                    onUpdate={u=>updateTrack(t.id,u)}
                    onRemove={()=>removeTrack(t.id)}
                    onReplaceClip={replaceClip}/>
                ))}
                <div style={{ height:32, display:'flex', alignItems:'center', paddingLeft:10 }}>
                  <button onClick={()=>{ if(fileRef.current){fileRef.current.value='';fileRef.current.click();} }}
                    style={{ background:'none', border:'none', color:'var(--muted)',
                      cursor:'pointer', fontSize:11 }}>+ Add track</button>
                </div>
              </div>
            </div>

            {/* Waveform scroll area */}
            <div ref={scrollEl} style={{ flex:1, overflowX:'auto', overflowY:'auto' }}
              onScroll={onScroll} onWheel={onWheel}>
              <div style={{ width:tlWidth }}>
                {/* Ruler */}
                <div style={{ height:24, position:'sticky', top:0, zIndex:3,
                  background:'var(--canvas-ruler-bg)', borderBottom:'1px solid var(--border)' }}>
                  <canvas ref={el=>{rulerRef.current=el;if(el){el.height=24;sizeCanvas(el,24);}}}
                    style={{ width:'100%', height:24, display:'block' }}/>
                </div>

                {/* Track rows */}
                {tracks.map((track,idx)=>{
                  const handlers = makeMouse(track);
                  return (
                    <div key={track.id}
                      draggable
                      onDragStart={()=>{dragIdxRef.current=idx;}}
                      onDragOver={e=>e.preventDefault()}
                      onDrop={()=>{
                        if(dragIdxRef.current!=null&&dragIdxRef.current!==idx)
                          reorder(dragIdxRef.current,idx);
                        dragIdxRef.current=null;
                      }}
                      style={{ height:PANEL_H, minHeight:PANEL_H, borderBottom:'1px solid var(--border)',
                        outline:track.id===selectedTId?`1px solid ${COLORS[idx%COLORS.length]}44`:'none',
                        position:'relative' }}>
                      <canvas
                        ref={el=>{waveRefs.current[track.id]=el;if(el)sizeCanvas(el,TRACK_H);}}
                        style={{ width: scrollEl.current ? scrollEl.current.clientWidth-1 : '100%', height:TRACK_H, display:'block', cursor: toolMode==='hand'?'grab':toolMode==='cursor'?'default':'crosshair', flexShrink:0, position:'sticky', left:0 }}
                        onMouseDown={handlers.onMouseDown}
                        onMouseMove={handlers.onMouseMove}
                        onMouseUp={handlers.onMouseUp}
                        onMouseLeave={handlers.onMouseUp}
                      />
                      {track.clips.length===0&&(
                        <div style={{ position:'absolute', inset:0, display:'flex',
                          alignItems:'center', justifyContent:'center',
                          color:'var(--muted)', fontSize:11, pointerEvents:'none' }}>
                          Empty track — drag audio here or use paste
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      <ExportPanel tracks={tracks}/>

      {/* Taal legend */}
      {showTaal&&tracks.length>0&&(
        <div style={{ padding:'4px 14px', borderTop:'1px solid var(--border)',
          background:'var(--bg2)', display:'flex', alignItems:'center',
          gap:8, flexShrink:0, flexWrap:'wrap' }}>
          <span style={{ fontSize:10, color:'var(--muted)' }}>{taal} · {bpm} BPM</span>
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {TAALS.find(t=>t.name===taal)?.vibhag.map((v,i)=>(
              <span key={i} style={{ fontSize:9, padding:'1px 5px',
                background:i===0?'rgba(201,125,58,0.15)':'rgba(255,255,255,0.03)',
                border:`1px solid ${i===0?'rgba(201,125,58,0.4)':'var(--border)'}`,
                borderRadius:3, color:i===0?'var(--accent)':'var(--muted)' }}>
                {i===0?'Sam':`V${i+1}`}({v})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Project restore modal */}
      {pendingProj&&(
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)',
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
          <div style={{ background:'var(--bg2)', border:'1px solid var(--border)',
            borderRadius:14, padding:24, maxWidth:460, width:'90%' }}>
            <h3 style={{ fontFamily:"'Playfair Display',serif", fontSize:18, marginBottom:8 }}>
              Restore Project
            </h3>
            <p style={{ fontSize:12, color:'var(--muted)', marginBottom:16, lineHeight:1.6 }}>
              {pendingProj.tracks.length} track{pendingProj.tracks.length!==1?'s':''} ·
              saved {new Date(pendingProj.savedAt).toLocaleDateString()}.
              Re-select each audio file to restore.
            </p>
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:16 }}>
              {pendingProj.tracks.map((pt,i)=>(
                <div key={i} style={{ display:'flex', alignItems:'center', gap:8,
                  padding:'8px 12px', background:'var(--bg3)',
                  border:'1px solid var(--border)', borderRadius:7 }}>
                  <span style={{ flex:1, fontSize:11, overflow:'hidden',
                    textOverflow:'ellipsis', whiteSpace:'nowrap' }}>🎵 {pt.name}</span>
                  <label style={{ fontSize:10, padding:'3px 8px', cursor:'pointer',
                    background:'rgba(201,125,58,0.1)', border:'1px solid rgba(201,125,58,0.3)',
                    borderRadius:5, color:'var(--accent)', flexShrink:0 }}>
                    Select
                    <input type='file' accept='audio/*' style={{ display:'none' }}
                      onChange={async e=>{
                        const f=e.target.files?.[0]; if(!f) return;
                        const track=makeTrack({name:pt.name,volume:pt.volume||1,
                          muted:pt.muted||false,solo:pt.solo||false,
                          fadeIn:pt.fadeIn||0,fadeOut:pt.fadeOut||0});
                        setTracks(prev=>[...prev,track]);
                        await loadFileIntoTrack(track.id, f,
                          pt.clips?.[0]||{trimStart:0,trimEnd:pt.clips?.[0]?.duration||0});
                        setPendingProj(prev=>{
                          if(!prev) return null;
                          const ts=prev.tracks.filter((_,j)=>j!==i);
                          return ts.length===0?null:{...prev,tracks:ts};
                        });
                      }}/>
                  </label>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
              <button className='btn-ghost' onClick={()=>setPendingProj(null)}
                style={{ fontSize:11 }}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
