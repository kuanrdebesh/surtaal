// Mock AudioContext
class MockAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 100; }
  createGain() { return { connect: () => {}, gain: { value: 1 }, context: this }; }
  createBufferSource() { 
    return { 
      connect: () => {}, 
      start: (when, off, dur) => console.log(`[AudioNode.start] when=${when}, offset=${off}, duration=${dur}`),
      stop: (when) => console.log(`[AudioNode.stop] when=${when}`)
    }; 
  }
}

// Load Mixer
import fs from 'fs';
let code = fs.readFileSync('/Users/debeshkuanr/Documents/Music_Program/surtaal/frontend/src/components/mixer.js', 'utf8');

// strip 'export' and 'import'
code = code.replace(/export /g, '').replace(/import .*;/g, '');
code += `
const mixer = new Mixer();
mixer.ctx = new MockAudioContext();
mixer.master = mixer.ctx.createGain();

// Simulate adding track
mixer.setClips('track1', [
  { id: 'clip1', buffer: { duration: 100 }, startOffset: 0, trimStart: 0, trimEnd: 10, duration: 100 },
  { id: 'clip2', buffer: { duration: 100 }, startOffset: 15, trimStart: 10, trimEnd: 20, duration: 100 }
]);

// Simulate playhead at 10 (paused)
mixer._off = 10;
mixer.playing = false;

// Play
console.log("PLAYING FROM 10:");
mixer.play(10);
`;

fs.writeFileSync('/tmp/test_mixer.mjs', code);
node /tmp/test_mixer.mjs
