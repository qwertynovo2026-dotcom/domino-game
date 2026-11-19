// Domino 71 Procedural Sound Effects Engine via Web Audio API
(function () {
  'use strict';

  let audioCtx = null;
  let isMuted = false;

  const STORAGE_KEY = 'domino71_sound_muted';

  try {
    isMuted = localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {}

  function getAudioContext() {
    if (!audioCtx && typeof window !== 'undefined') {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        audioCtx = new AudioContext();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  // 1. Tile Placement Sound (Bone / Ivory click and slap)
  function playTilePlace() {
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      const t = ctx.currentTime;

      // Impact transient (noise burst)
      const bufferSize = Math.floor(ctx.sampleRate * 0.022);
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2600, t);
      filter.Q.setValueAtTime(3.2, t);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.35, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.02);

      whiteNoise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      whiteNoise.start(t);

      // Ceramic / body resonance (damped sine wave)
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      const freq = 850 + Math.random() * 250;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.45, t + 0.07);

      oscGain.gain.setValueAtTime(0.28, t);
      oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.065);

      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.075);

      // Secondary slap (second half of rectangular tile landing)
      const slap = ctx.createOscillator();
      const slapGain = ctx.createGain();
      slap.type = 'sine';
      slap.frequency.setValueAtTime(freq * 1.25, t + 0.018);
      slap.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.05);

      slapGain.gain.setValueAtTime(0.0, t);
      slapGain.gain.setValueAtTime(0.12, t + 0.018);
      slapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);

      slap.connect(slapGain);
      slapGain.connect(ctx.destination);
      slap.start(t + 0.018);
      slap.stop(t + 0.065);
    } catch {}
  }

  // 2. Table Knock (Double thump on the table for Pass / "Стучу" / "Рыба")
  function playKnock() {
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      function singleKnock(startTime, vol) {
        const t = startTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(155, t);
        osc.frequency.exponentialRampToValueAtTime(50, t + 0.09);

        gain.gain.setValueAtTime(vol, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.085);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(320, t);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + 0.095);
      }

      const t = ctx.currentTime;
      singleKnock(t, 0.45);
      singleKnock(t + 0.075, 0.32);
    } catch {}
  }

  // 3. Draw Tile / Stock Shuffle (Sliding tile on felt)
  function playDraw() {
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      const t = ctx.currentTime;
      const bufferSize = Math.floor(ctx.sampleRate * 0.12);
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1300, t);
      filter.frequency.linearRampToValueAtTime(550, t + 0.11);
      filter.Q.setValueAtTime(2.2, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.04, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noise.start(t);
    } catch {}
  }

  // 4. Score Chimes (Golden chime / coin bell for 5, 10, 15, 20, 25 points)
  function playScore(points) {
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      // Harmonic scale: E5, G#5, B5, E6, G#6
      const notes = [659.25, 830.61, 987.77, 1318.51, 1661.22];
      const count = Math.min(5, Math.max(1, Math.round(Number(points || 5) / 5)));
      const t0 = ctx.currentTime;

      for (let i = 0; i < count; i++) {
        const t = t0 + i * 0.08;
        const freq = notes[i % notes.length];

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);

        // Harmonic shimmer
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(freq * 2.76, t);

        const vol = 0.22;
        gain.gain.setValueAtTime(vol, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

        gain2.gain.setValueAtTime(vol * 0.28, t);
        gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);

        osc.start(t);
        osc.stop(t + 0.38);
        osc2.start(t);
        osc2.stop(t + 0.22);
      }
    } catch {}
  }

  // 5. Fanfare for Round / Match Win
  function playFanfare(isMatchWin) {
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      const t0 = ctx.currentTime;
      const chords = isMatchWin
        ? [
            [523.25, 659.25, 783.99],
            [587.33, 739.99, 880.00],
            [659.25, 830.61, 987.77],
            [783.99, 1046.50, 1318.51]
          ]
        : [
            [523.25, 659.25],
            [659.25, 783.99],
            [783.99, 1046.50]
          ];

      chords.forEach((chord, chordIdx) => {
        const ct = t0 + chordIdx * 0.13;
        const duration = chordIdx === chords.length - 1 ? 0.75 : 0.18;
        chord.forEach(freq => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, ct);

          gain.gain.setValueAtTime(0.14, ct);
          gain.gain.exponentialRampToValueAtTime(0.001, ct + duration);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ct);
          osc.stop(ct + duration);
        });
      });
    } catch {}
  }

  function toggleMute() {
    isMuted = !isMuted;
    try {
      localStorage.setItem(STORAGE_KEY, String(isMuted));
    } catch {}
    if (!isMuted && audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return !isMuted;
  }

  function isEnabled() {
    return !isMuted;
  }

  const DominoSound = {
    playTilePlace,
    playKnock,
    playDraw,
    playScore,
    playFanfare,
    toggleMute,
    isEnabled
  };

  globalThis.DominoSound = DominoSound;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DominoSound;
  }
})();
