// Background music + interaction SFX.
//
// Music: a looping lo-fi track (public/beach-lofi.mp3) via an HTMLAudioElement.
// SFX: soft procedural footsteps and UI blips via Web Audio (no asset files).
// Both are gated behind the first user gesture (autoplay policy) and share one
// mute toggle. Kept low in the mix.

export function createAudio() {
  let ctx = null, master = null, started = false, muted = false;
  let noiseBuf = null, music = null;

  const MUSIC_URL = `${import.meta.env.BASE_URL || '/'}beach-lofi.mp3`;
  const MUSIC_VOL = 0.06;   // quiet background bed

  function makeNoise() {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function start() {
    if (started) {
      if (ctx && ctx.state === 'suspended') ctx.resume();
      if (music && music.paused && !muted) music.play().catch(() => {});
      return;
    }
    started = true;

    // Looping music track.
    music = new Audio(MUSIC_URL);
    music.loop = true;
    music.preload = 'auto';
    music.volume = muted ? 0 : MUSIC_VOL;
    music.play().catch(() => {});   // a later gesture (start() again) will retry

    // Web Audio graph for SFX only.
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      noiseBuf = makeNoise();
    }
  }

  function footstep(i = 0) {
    if (!started || muted || !ctx) return;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300 + (i % 2) * 80; bp.Q.value = 1.2;
    const g = ctx.createGain(); const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    src.connect(bp).connect(g).connect(master); src.start(t); src.stop(t + 0.16);
  }

  function blip(kind) {
    if (!started || muted || !ctx) return;
    const o = ctx.createOscillator(); o.type = 'sine';
    const g = ctx.createGain(); const t = ctx.currentTime;
    const f = kind === 'close' ? 360 : 560;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(kind === 'close' ? 240 : 760, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.2);
  }

  function setMuted(m) {
    muted = m;
    if (music) music.volume = m ? 0 : MUSIC_VOL;
    if (master && ctx) master.gain.linearRampToValueAtTime(m ? 0 : 0.5, ctx.currentTime + 0.2);
  }

  return {
    start, footstep, ui: blip,
    toggle() { setMuted(!muted); return muted; },
    get muted() { return muted; },
  };
}
