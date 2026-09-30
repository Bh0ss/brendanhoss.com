// Background music + interaction SFX.
//
// Music: a looping lo-fi track (public/beach-lofi.mp3) via an HTMLAudioElement.
// SFX: soft procedural footsteps and UI blips via Web Audio (no asset files).
// Both are gated behind the first user gesture (autoplay policy) and share one
// mute toggle. Kept low in the mix.

export function createAudio() {
  let ctx = null, master = null, started = false, muted = false;
  let ducked = false, duckTimer = 0;   // music paused while the résumé view covers the town
  let noiseBuf = null, music = null;
  let musicSrc = null, musicGain = null;   // music routed through Web Audio (iOS honors GainNode.gain, not .volume)

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
      if (music && music.paused && !muted && !ducked) music.play().catch(() => {});
      return;
    }
    started = true;

    // Looping music track. Level is set by musicGain (below) when Web Audio is
    // available; iOS ignores HTMLMediaElement.volume so we leave it at default.
    music = new Audio(MUSIC_URL);
    music.loop = true;
    music.preload = 'auto';

    // Web Audio graph.
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5;   // SFX bus
      master.connect(ctx.destination);
      noiseBuf = makeNoise();

      // Route music through a DEDICATED gain (independent of the SFX master).
      // createMediaElementSource may be called only ONCE per element — guarded.
      if (!musicSrc) {
        musicSrc = ctx.createMediaElementSource(music);
        musicGain = ctx.createGain();
        musicGain.gain.value = muted ? 0 : MUSIC_VOL;   // quiet bed; honored on iOS
        musicSrc.connect(musicGain).connect(ctx.destination);
      }
    } else {
      // No Web Audio: mute via .muted (iOS-safe), level stays at element default.
      music.muted = muted;
    }

    if (!ducked) music.play().catch(() => {});   // a later gesture (start() again) will retry
  }

  // Duck: fade the music bed out and pause it (e.g. while the résumé reading
  // view is open); unduck fades it back in. Independent of mute: a muted
  // player stays silent on unduck (gain 0 / .muted). SFX are untouched —
  // nothing plays behind the view anyway (movement and cards are frozen).
  function setDucked(d) {
    if (d === ducked) return;
    ducked = d;
    clearTimeout(duckTimer);
    if (!music) return;   // not started yet: start() honors the flag
    if (d) {
      if (musicGain && ctx) {
        musicGain.gain.cancelScheduledValues(ctx.currentTime);
        musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
        musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
        duckTimer = setTimeout(() => { if (ducked) music.pause(); }, 320);
      } else music.pause();
    } else {
      if (musicGain && ctx) {
        musicGain.gain.cancelScheduledValues(ctx.currentTime);
        musicGain.gain.setValueAtTime(0, ctx.currentTime);
        musicGain.gain.linearRampToValueAtTime(muted ? 0 : MUSIC_VOL, ctx.currentTime + 0.6);
      }
      music.play().catch(() => {});   // mute is carried by the gain / .muted, as in start()
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
    // Music: ramp the gain node (iOS honors gain, not .volume). Fall back to
    // .muted only when Web Audio is unavailable (no ctx/musicGain).
    if (musicGain && ctx) musicGain.gain.linearRampToValueAtTime(m || ducked ? 0 : MUSIC_VOL, ctx.currentTime + 0.2);
    else if (music) music.muted = m;
    // SFX bus unchanged.
    if (master && ctx) master.gain.linearRampToValueAtTime(m ? 0 : 0.5, ctx.currentTime + 0.2);
  }

  return {
    start, footstep, ui: blip, setDucked,
    toggle() { setMuted(!muted); return muted; },
    get muted() { return muted; },
  };
}
