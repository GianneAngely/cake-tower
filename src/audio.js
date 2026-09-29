/* Cake Tower sounds. Everything is synthesized with Web Audio: no sound files to load or license. */
(() => {
  "use strict";

  const MUSIC_VOL = 0.5;
  const PENTA = [0, 2, 4, 7, 9];
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);                              // MIDI note to frequency
  const pent = (i, base = 72) => base + 12 * Math.floor(i / 5) + PENTA[i % 5]; // i-th note of C major pentatonic from `base`
  const stats = { sfx: {}, notes: 0 };

  const pref = {
    get(k) { try { return localStorage.getItem(`caketower.${k}`) !== "0"; } catch { return true; } },
    set(k, on) { try { localStorage.setItem(`caketower.${k}`, on ? "1" : "0"); } catch { /* private mode */ } },
  };

  function gainNode(ac, v, to) {
    const g = ac.createGain();
    g.gain.value = v;
    if (to) g.connect(to);
    return g;
  }

  // sfx and music buses into a soft compressor, plus a shared dark echo that gives the music-box room feel
  function buses(ac) {
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 3;
    comp.connect(ac.destination);
    const master = gainNode(ac, 0.9, comp);
    const echo = ac.createDelay(1);
    echo.delayTime.value = 0.33;
    const dark = ac.createBiquadFilter();
    dark.type = "lowpass";
    dark.frequency.value = 2200;
    echo.connect(dark);
    dark.connect(gainNode(ac, 0.3, echo));      // feedback
    dark.connect(gainNode(ac, 0.45, master));   // wet
    const noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return { ac, master, sfx: gainNode(ac, 1, master), music: gainNode(ac, MUSIC_VOL, master), send: gainNode(ac, 1, echo), noise };
  }

  // ---- voices ----

  function tone(B, type, f, t, peak, attack, decay, out, send = 0) {
    const o = B.ac.createOscillator(), g = B.ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g);
    g.connect(out);
    if (send) g.connect(gainNode(B.ac, send, B.send));
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  function glide(B, type, f0, f1, t, dur, peak, out) {
    const o = B.ac.createOscillator(), g = B.ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function hiss(B, t, dur, type, f0, f1, q, peak, out) {
    const src = B.ac.createBufferSource(), flt = B.ac.createBiquadFilter(), g = B.ac.createGain();
    src.buffer = B.noise;
    flt.type = type;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt);
    flt.connect(g);
    g.connect(out);
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.05);
  }

  function bell(B, m, t, v, out, send = 0.35, decay = 1.3) {   // music-box tine: fundamental, octave, faint inharmonic ping
    tone(B, "sine", hz(m), t, v, 0.004, decay, out, send);
    tone(B, "sine", hz(m) * 2, t, v * 0.28, 0.003, decay * 0.45, out, send);
    tone(B, "sine", hz(m) * 4.16, t, v * 0.1, 0.002, 0.09, out);
  }

  function marimba(B, m, t, v, out) {
    tone(B, "sine", hz(m), t, v, 0.003, 0.32, out, 0.15);
    tone(B, "sine", hz(m) * 3.99, t, v * 0.12, 0.002, 0.045, out);
  }

  const sparkle = (B, t, n) => {
    for (let i = 0; i < n; i++) bell(B, pent(10 + Math.floor(Math.random() * 6)), t + i * 0.055, 0.05, B.sfx, 0.5, 0.3);
  };

  const SFX = {
    tap(B, t) { glide(B, "sine", 520, 880, t, 0.09, 0.22, B.sfx); },
    drop(B, t) { hiss(B, t, 0.1, "highpass", 2600, 5200, 0.7, 0.05, B.sfx); },
    plop(B, t) {                                     // a soft sponge landing
      glide(B, "sine", 380, 140, t, 0.15, 0.42, B.sfx);
      hiss(B, t, 0.07, "lowpass", 900, 300, 0.7, 0.12, B.sfx);
    },
    land(B, t, n) { marimba(B, pent(n % 10, 60), t + 0.01, 0.2, B.sfx); },   // climbs the scale as the tower grows
    chop(B, t) {                                     // snip, snip, and a little falling whistle
      hiss(B, t, 0.05, "bandpass", 4200, 3000, 1.4, 0.2, B.sfx);
      hiss(B, t + 0.06, 0.04, "bandpass", 4800, 3600, 1.4, 0.14, B.sfx);
      glide(B, "sine", 900, 420, t + 0.08, 0.35, 0.05, B.sfx);
    },
    perfect(B, t, combo) {                           // a chime that rises with the combo
      const k = Math.min(combo - 1, 6);
      [0, 2, 4].forEach((d, i) => bell(B, pent(k + d), t + i * 0.055, 0.2, B.sfx, 0.4, 1.2));
      sparkle(B, t + 0.12, 4);
      if (combo >= 3) glide(B, "sine", 700, 2100, t + 0.1, 0.3, 0.05, B.sfx);   // the cake grows back
    },
    miss(B, t) {                                     // falls away, then a soft "aww"
      hiss(B, t, 0.75, "bandpass", 1600, 250, 0.9, 0.16, B.sfx);
      [67, 64, 60].forEach((m, i) => marimba(B, m, t + 0.45 + i * 0.2, 0.22, B.sfx));
    },
    release(B, t) {                                  // a balloon lets go of its cake
      glide(B, "triangle", 600, 1300, t, 0.12, 0.1, B.sfx);
      bell(B, 91, t + 0.03, 0.06, B.sfx, 0.3, 0.4);
    },
    reveal(B, t) { hiss(B, t, 1.3, "bandpass", 300, 2400, 0.8, 0.07, B.sfx); },   // soft whoosh as the camera pulls back
    shutter(B, t) {                                  // photo click
      hiss(B, t, 0.035, "highpass", 3500, 3000, 0.7, 0.3, B.sfx);
      hiss(B, t + 0.08, 0.05, "bandpass", 2200, 1600, 1, 0.22, B.sfx);
    },
    best(B, t) {
      [72, 76, 79, 84].forEach((m, i) => bell(B, m, t + i * 0.09, 0.22, B.sfx, 0.4, 1.2));
      sparkle(B, t + 0.35, 6);
    },
  };

  // ---- music: a music-box lullaby over C - Am - F - G, 16 bars of [note, eighths] (0 = rest) ----

  const CHORDS = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]];
  const MELODY = [
    [[79, 2], [76, 2], [72, 2], [76, 2]], [[81, 3], [79, 1], [76, 4]], [[77, 2], [81, 2], [84, 2], [81, 2]], [[79, 6], [0, 2]],
    [[76, 2], [79, 2], [84, 3], [86, 1]], [[88, 2], [86, 2], [84, 2], [81, 2]], [[77, 2], [81, 2], [79, 2], [77, 2]], [[71, 2], [74, 2], [79, 4]],
    [[84, 2], [83, 1], [84, 1], [79, 4]], [[81, 2], [84, 2], [88, 2], [84, 2]], [[81, 3], [79, 1], [77, 2], [81, 2]], [[79, 2], [74, 2], [79, 4]],
    [[76, 1], [77, 1], [79, 2], [76, 2], [72, 2]], [[69, 2], [72, 2], [76, 2], [81, 2]], [[77, 2], [76, 2], [74, 2], [72, 2]], [[74, 4], [67, 4]],
  ];
  const BARS = MELODY.map((bar) => bar.flatMap(([m, n]) => [m ? m : null, ...Array(n - 1).fill(null)]));
  const TEMPO = { day: 92, dusk: 84, night: 72, rush: 100 };   // rush: the bright day voicing, faster

  function composer(B) {
    let bar = 0, step = 0, phase = "day";
    return {
      set phase(p) { phase = p; },
      reset() { bar = 0; step = 0; },
      dt() { return 60 / TEMPO[phase] / 2; },
      play(t) {                                      // one eighth note; night is an octave lower, slower and sparser
        const chord = CHORDS[bar % 4], night = phase === "night", lead = BARS[bar % BARS.length][step];
        if (lead) bell(B, lead - (night ? 12 : 0), t, night ? 0.1 : 0.13, B.music, 0.35, night ? 2.6 : 2.2);
        if (!night || step % 2 === 0) {
          const k = [0, 1, 2, 1][step % 4];
          bell(B, chord[k] + 12 + (step >= 4 && k === 0 ? 12 : 0), t, 0.045, B.music, 0.25, 1.1);
        }
        if (step === 0 || step === 4) {              // bass: root on beat 1, fifth on beat 3
          const m = step === 0 ? chord[0] : chord[2], v = step === 0 ? 0.12 : 0.07;
          tone(B, "sine", hz(m), t, v, 0.01, 2.4, B.music, 0.1);
          tone(B, "triangle", hz(m) * 2, t, v * 0.15, 0.01, 0.4, B.music);
        }
        stats.notes++;
        if (++step === 8) { step = 0; bar++; }
      },
    };
  }

  // ---- live engine ----

  let B = null, song = null, timer = null, next = 0, paused = false, ducked = false;

  function ensure() {
    if (B) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    B = buses(new AC());
    song = composer(B);
    return true;
  }

  function tick() {   // schedule notes slightly ahead of the audio clock so timers never make it stutter
    while (next < B.ac.currentTime + 0.15) {
      song.play(next);
      next += song.dt();
    }
  }

  function musicGain(v, tc) {
    const g = B.music.gain, t = B.ac.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(v, t, tc);
  }

  const api = {
    musicOn: pref.get("music"),
    sfxOn: pref.get("sfx"),
    stats,
    dev: { buses, SFX, composer },   // for tools/sound_preview.js
    unlock() {
      if (ensure() && B.ac.state === "suspended" && !paused && !document.hidden) B.ac.resume();
    },
    play(name, ...args) {
      if (!api.sfxOn || !B) return;
      SFX[name](B, B.ac.currentTime + 0.005, ...args);
      stats.sfx[name] = (stats.sfx[name] || 0) + 1;
    },
    startMusic() {
      if (!api.musicOn || !B || timer) return;
      song.reset();
      next = B.ac.currentTime + 0.1;
      timer = setInterval(tick, 25);
      tick();
    },
    setPhase(p) { if (song) song.phase = p; },
    duck(on) {
      ducked = on;
      if (B && api.musicOn) musicGain(on ? MUSIC_VOL * 0.3 : MUSIC_VOL, 0.25);
    },
    pause(on) {
      paused = on;
      if (!B) return;
      if (on) B.ac.suspend();
      else if (!document.hidden) B.ac.resume();
    },
    toggleMusic() {
      api.musicOn = !api.musicOn;
      pref.set("music", api.musicOn);
      if (!B) return;
      if (api.musicOn) {
        musicGain(ducked ? MUSIC_VOL * 0.3 : MUSIC_VOL, 0.05);
        api.startMusic();
      } else {
        clearInterval(timer);
        timer = null;
        musicGain(0, 0.05);
      }
    },
    toggleSfx() {
      api.sfxOn = !api.sfxOn;
      pref.set("sfx", api.sfxOn);
    },
  };

  // browsers only allow sound after a gesture; capture runs before the game handles the same tap
  for (const ev of ["pointerdown", "keydown", "touchend"]) addEventListener(ev, () => api.unlock(), { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (!B) return;
    if (document.hidden) B.ac.suspend();
    else if (!paused) B.ac.resume();
  });

  window.CakeAudio = api;
})();
