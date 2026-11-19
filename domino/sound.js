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

  // 1. Tile Placement Sound (Crisp "цоканье" / domino clack)
  function playTilePlace() {
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      const t = ctx.currentTime;

      // Part A: Sharp high transient click (the "ц" of "цок")
      const clickLen = Math.floor(ctx.sampleRate * 0.013); // 13ms
      const clickBuf = ctx.createBuffer(1, clickLen, ctx.sampleRate);
      const clickData = clickBuf.getChannelData(0);
      for (let i = 0; i < clickLen; i++) {
        clickData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (clickLen * 0.22));
      }

      const clickSrc = ctx.createBufferSource();
      clickSrc.buffer = clickBuf;

      const clickFilter = ctx.createBiquadFilter();
      clickFilter.type = 'highpass';
      clickFilter.frequency.setValueAtTime(3200, t);

      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(0.42, t);
      clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.013);

      clickSrc.connect(clickFilter);
      clickFilter.connect(clickGain);
      clickGain.connect(ctx.destination);
      clickSrc.start(t);

      // Part B: Crisp resonant chirp (2300Hz -> 1100Hz in 30ms - the "ок" of "цок")
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      const baseFreq = 2250 + Math.random() * 180;
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(baseFreq, t);
      osc1.frequency.exponentialRampToValueAtTime(baseFreq * 0.48, t + 0.032);

      gain1.gain.setValueAtTime(0.36, t);
      gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.034);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(t);
      osc1.stop(t + 0.038);

      // Part C: Secondary subtle mini-slap 11ms later (rectangular tile settling flat)
      const t2 = t + 0.011;
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(baseFreq * 0.82, t2);
      osc2.frequency.exponentialRampToValueAtTime(baseFreq * 0.42, t2 + 0.022);

      gain2.gain.setValueAtTime(0.18, t2);
      gain2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.024);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(t2);
      osc2.stop(t2 + 0.028);
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

  // 4. Coin Pickup Sound ("Монетка" / classic arcade coin ding for scoring points)
  function playScore(points) {
    if (isMuted) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      const numCoins = Math.min(3, Math.max(1, Math.round(Number(points || 5) / 5)));
      const t0 = ctx.currentTime;

      function singleCoin(startTime, pitchOffset) {
        const t = startTime;
        // Classic Coin Interval: Tone 1 = B5 (987.77 Hz), Tone 2 = E6 (1318.51 Hz)
        const mult = Math.pow(2, (pitchOffset || 0) / 12);
        const f1 = 987.77 * mult;
        const f2 = 1318.51 * mult;

        // Tone 1: short lead-in tone (40ms)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(f1, t);

        gain1.gain.setValueAtTime(0.26, t);
        gain1.gain.setValueAtTime(0.26, t + 0.038);
        gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.048);

        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(t);
        osc1.stop(t + 0.052);

        // Tone 2: high ringing coin chime (starts at t + 38ms, rings for ~380ms)
        const tRing = t + 0.038;
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(f2, tRing);

        gain2.gain.setValueAtTime(0.32, tRing);
        gain2.gain.exponentialRampToValueAtTime(0.001, tRing + 0.38);

        // Harmonic sparkle overtone (f2 * 2 = E7) for crisp metallic ring
        const oscSparkle = ctx.createOscillator();
        const gainSparkle = ctx.createGain();
        oscSparkle.type = 'triangle';
        oscSparkle.frequency.setValueAtTime(f2 * 2, tRing);

        gainSparkle.gain.setValueAtTime(0.09, tRing);
        gainSparkle.gain.exponentialRampToValueAtTime(0.001, tRing + 0.18);

        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        oscSparkle.connect(gainSparkle);
        gainSparkle.connect(ctx.destination);

        osc2.start(tRing);
        osc2.stop(tRing + 0.4);
        oscSparkle.start(tRing);
        oscSparkle.stop(tRing + 0.2);
      }

      for (let i = 0; i < numCoins; i++) {
        singleCoin(t0 + i * 0.09, i * 2);
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
