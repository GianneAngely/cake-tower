// Evaluated inside the game page by tools/check.mjs: renders every sound effect, then the start of the music,
// offline to a mono 16-bit WAV and returns it as base64.
(async () => {
  const { buses, SFX, composer } = window.CakeAudio.dev;
  const rate = 44100, secs = 36;
  const ac = new OfflineAudioContext(1, rate * secs, rate);
  const B = buses(ac);
  let t = 0.3;
  SFX.tap(B, t);
  t += 0.9;
  for (let n = 0; n < 3; n++, t += 0.75) {            // three sloppy drops: plop + climbing note
    SFX.drop(B, t);
    SFX.plop(B, t + 0.12);
    SFX.land(B, t + 0.12, n);
  }
  SFX.drop(B, t);                                      // a chopped one
  SFX.plop(B, t + 0.12);
  SFX.chop(B, t + 0.12);
  SFX.land(B, t + 0.12, 3);
  t += 1;
  for (let c = 1; c <= 4; c++, t += 0.9) {            // perfect x1 .. x4
    SFX.drop(B, t);
    SFX.plop(B, t + 0.12);
    SFX.perfect(B, t + 0.12, c);
  }
  SFX.miss(B, t);
  t += 2;
  SFX.best(B, t);
  t += 2.5;
  const song = composer(B);
  for (const end = secs - 1.5; t < end; t += song.dt()) song.play(t);

  const data = (await ac.startRendering()).getChannelData(0);
  const buf = new ArrayBuffer(44 + data.length * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + data.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 0x7fff, true);
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
})()
