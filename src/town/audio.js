// Procedural lo-fi ambience via Web Audio — no asset files. A slow jazzy
// ii–V–I–vi loop on a soft electric-piano pad, a round sub bass, a brushed
// kick/hat groove, gentle "wow" flutter and vinyl crackle, all run through a
// warm low-pass. Smooth and relaxing, kept low in the mix.
// Must be started from a user gesture (autoplay policy).

export function createAudio() {
  let ctx = null, master = null, warm = null, started = false, muted = false;
  let noiseBuf = null, schedTimer = null;

  const BPM = 72;
  const beat = 60 / BPM;       // ~0.833s
  const eighth = beat / 2;
  let step = 0, nextTime = 0;

  // ii–V–I–vi in C: Dm7 · G7 · Cmaj7 · Am7. pad = voiced chord, bass = root.
  const PROG = [
    { pad: [293.66, 349.23, 440.00, 523.25], bass: 73.42 },
    { pad: [392.00, 493.88, 587.33, 698.46], bass: 98.00 },
    { pad: [261.63, 329.63, 392.00, 493.88], bass: 65.41 },
    { pad: [220.00, 261.63, 329.63, 392.00], bass: 55.00 },
  ];

  function makeNoise() {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function padChord(freqs, t, dur) {
    const g = ctx.createGain(); g.connect(master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.10, t + 0.5);          // soft swell
    g.gain.setTargetAtTime(0.0001, t + dur - 0.7, 0.3);          // gentle release
    for (const f of freqs) {
      for (const det of [-4, 4]) {                                // detuned pair = warmth
        const o = ctx.createOscillator(); o.type = 'triangle';
        o.frequency.value = f; o.detune.value = det;
        const og = ctx.createGain(); og.gain.value = 0.24 / freqs.length;
        o.connect(og).connect(g); o.start(t); o.stop(t + dur + 0.1);
      }
    }
  }

  function bassNote(f, t, dur) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = ctx.createGain(); g.connect(master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.06);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.6, 0.4);
    o.connect(g); o.start(t); o.stop(t + dur + 0.1);
  }

  function kick(t) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
    const g = ctx.createGain(); g.connect(master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); o.start(t); o.stop(t + 0.2);
  }

  function hat(t, vel) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = ctx.createGain(); g.connect(master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(hp).connect(g); s.start(t); s.stop(t + 0.06);
  }

  function scheduleStep(i, t) {
    const inBar = i % 8;
    if (inBar === 0) {
      const c = PROG[Math.floor(i / 8) % PROG.length];
      padChord(c.pad, t, beat * 4 * 0.98);
      bassNote(c.bass, t, beat * 2);
      bassNote(c.bass, t + beat * 2, beat * 2);
    }
    if (inBar === 0 || inBar === 4) kick(t);            // beats 1 & 3
    hat(t, inBar % 2 === 1 ? 0.05 : 0.022);             // soft swing-ish hats
  }

  function scheduler() {
    while (nextTime < ctx.currentTime + 0.12) {
      scheduleStep(step, nextTime);
      nextTime += eighth; step++;
    }
  }

  function startMusic() {
    step = 0; nextTime = ctx.currentTime + 0.15;
    schedTimer = setInterval(scheduler, 25);
    // vinyl crackle bed
    const cr = ctx.createBufferSource(); cr.buffer = noiseBuf; cr.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500;
    const cg = ctx.createGain(); cg.gain.value = 0.014;
    cr.connect(hp).connect(cg).connect(master); cr.start();
  }

  function start() {
    if (started) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5;
    warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 2200; warm.Q.value = 0.4;
    master.connect(warm).connect(ctx.destination);
    // slow "wow" flutter on the warmth filter
    const wlfo = ctx.createOscillator(); wlfo.type = 'sine'; wlfo.frequency.value = 0.07;
    const wg = ctx.createGain(); wg.gain.value = 320;
    wlfo.connect(wg).connect(warm.frequency); wlfo.start();
    noiseBuf = makeNoise();
    started = true;
    startMusic();
  }

  function footstep(i = 0) {
    if (!started || muted) return;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300 + (i % 2) * 80; bp.Q.value = 1.2;
    const g = ctx.createGain(); const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.10, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    src.connect(bp).connect(g).connect(master); src.start(t); src.stop(t + 0.16);
  }

  function blip(kind) {
    if (!started || muted) return;
    const o = ctx.createOscillator(); o.type = 'sine';
    const g = ctx.createGain(); const t = ctx.currentTime;
    const f = kind === 'close' ? 360 : 560;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(kind === 'close' ? 240 : 760, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.10, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.2);
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.linearRampToValueAtTime(m ? 0 : 0.5, ctx.currentTime + 0.2);
  }

  return {
    start, footstep, ui: blip,
    toggle() { setMuted(!muted); return muted; },
    get muted() { return muted; },
  };
}
