// Procedural ambience via Web Audio — no asset files. A gentle detuned pad +
// slow filter LFO + soft filtered-noise "wind", plus footstep and UI blips.
// Must be started from a user gesture (browser autoplay policy).

export function createAudio() {
  let ctx = null, master = null, started = false, muted = false;
  let noiseBuf = null;

  function makeNoise() {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function startAmbient() {
    // warm detuned pad
    const padGain = ctx.createGain(); padGain.gain.value = 0.0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.6;
    padGain.connect(lp).connect(master);
    const freqs = [110, 110.4, 164.8, 220.2];
    for (const f of freqs) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.07;
      o.connect(g).connect(padGain); o.start();
    }
    padGain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 4); // fade in

    // slow LFO on the filter for movement
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(lp.frequency); lfo.start();

    // soft wind: filtered looping noise
    const wind = ctx.createBufferSource(); wind.buffer = noiseBuf; wind.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 480; wf.Q.value = 0.4;
    const wg = ctx.createGain(); wg.gain.value = 0.025;
    wind.connect(wf).connect(wg).connect(master); wind.start();
    const wlfo = ctx.createOscillator(); wlfo.type = 'sine'; wlfo.frequency.value = 0.08;
    const wlg = ctx.createGain(); wlg.gain.value = 0.018;
    wlfo.connect(wlg).connect(wg.gain); wlfo.start();
  }

  function start() {
    if (started) { if (ctx && ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(ctx.destination);
    noiseBuf = makeNoise();
    startAmbient();
    started = true;
  }

  function footstep(i = 0) {
    if (!started || muted) return;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 320 + (i % 2) * 90; bp.Q.value = 1.2;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    src.connect(bp).connect(g).connect(master);
    src.start(t); src.stop(t + 0.16);
  }

  function blip(kind) {
    if (!started || muted) return;
    const o = ctx.createOscillator(); o.type = 'sine';
    const g = ctx.createGain();
    const t = ctx.currentTime;
    const f = kind === 'close' ? 360 : 560;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(kind === 'close' ? 240 : 760, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.2);
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.linearRampToValueAtTime(m ? 0 : 0.6, ctx.currentTime + 0.15);
  }

  return {
    start, footstep, ui: blip,
    toggle() { setMuted(!muted); return muted; },
    get muted() { return muted; },
  };
}
