/* Cake Tower: a cake tier slides over the tower, tap to drop it, and whatever hangs over the edge is cut off. */
(() => {
  "use strict";

  const FLAVORS = ["pink", "mint", "lavender", "yellow", "chocolate", "peach", "blue", "vanilla"];
  const TEX = { tierW: 800, tierH: 644, standW: 919, standH: 465 };
  const ANCHOR = { top: 0.232, bottom: 0.712, stand: 0.28 };        // rim centers, from art/sprites/anchors.json
  const TIER_W = 400;                                                // world width of a full-size tier
  const K = TIER_W / TEX.tierW;                                      // texture px to world units at full size
  const HIT = 0.9;                                                   // share of the sprite width that counts; the piped borders stick out
  const STAND_SCALE = (TIER_W * 1.15) / TEX.standW;
  const PLATE_Y = -TEX.standH * STAND_SCALE * (1 - ANCHOR.stand);   // the stand's foot sits at y = 0
  const COUNTER = 0.8;                                               // counter line as a fraction of the background height
  const FOCUS = 0.62;                                                // the tower top is kept at this height on screen
  const FOCUS_SWING = 0.77;                                          // lower while a balloon cake hangs above it
  const SWEEP = 1.1;                                                 // the sliding tier travels this many tier widths either side
  const SWING_FROM = 40;                                             // from this many cakes some arrive swinging under a balloon,
  const SWING_FALL = 260;                                            // drop from higher up (ms),
  const MOMENTUM = 0.35;                                             // and keep this share of their sideways speed as they fall
  const HARD_FROM = 100;                                             // "Sugar rush": faster again, stingier perfects, more balloons
  // tier widths per second: slow start, faster later, climbing after SWING_FROM and again after HARD_FROM
  const speedFor = (n) => Math.min(4.6,
    Math.min(3.2, 0.7 + 1.3 * (1 - Math.exp(-n / 20)) + 0.035 * Math.max(0, n - SWING_FROM)) + 0.03 * Math.max(0, n - HARD_FROM));
  const zoomFor = (s) => Math.min(8, Math.max(1, 0.55 / s));         // zoom in so a shrunken cake never looks smaller than 55% of a full one
  // the sky follows how many cakes are stacked, not raw height: shrunken cakes add almost no height
  const SKY = [[0, 0xfbe9df], [12, 0xfad6cf], [22, 0xf8cdbf], [30, 0xecc5e0], [38, 0xc9c3ec], [46, 0x6f6aa8], [54, 0x2f2d57],
    [HARD_FROM, 0x2f2d57], [HARD_FROM + 12, 0x46295c]];
  const DUSK = 22, NIGHT = 44;
  const DECOR = {   // [texture, weight]
    day: [["sky-cloud-big", 5], ["sky-cloud-small", 5], ["sky-cloud-long", 4], ["sky-birds", 2], ["sky-balloon", 1]],
    dusk: [["sky-cloud-big", 3], ["sky-cloud-long", 4], ["sky-cloud-small", 2], ["sky-balloon", 2], ["sky-birds", 1]],
    night: [["sky-star", 9], ["sky-cloud-small", 1], ["sky-cloud-long", 1]],
    rush: [["sky-star", 8], ["sky-planet", 1], ["sky-cloud-small", 1]],
  };
  const DECOR_SIZE = {   // longest side on screen, in full tier widths
    "sky-cloud-big": [0.9, 1.2], "sky-cloud-small": [0.5, 0.7], "sky-cloud-long": [1, 1.3], "sky-birds": [0.45, 0.55],
    "sky-balloon": [0.6, 0.7], "sky-star": [0.08, 0.16], "sky-moon": [0.6, 0.6], "sky-planet": [0.65, 0.65],
  };
  const PHOTO_ASPECT = 0.28;                                         // the game-over photo is never skinnier than this (width / height)
  const MAX_DECOR = 160;                                             // kept for the whole climb so the game-over photo shows it
  const INK = 0x7a4a2e;
  const phaseOf = (n) => (n >= HARD_FROM ? "rush" : n >= NIGHT ? "night" : n >= DUSK ? "dusk" : "day");
  const pick = (list) => {
    let r = Math.random() * list.reduce((a, [, w]) => a + w, 0);
    for (const [k, w] of list) if ((r -= w) < 0) return k;
    return list[0][0];
  };
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const PARAMS = new URLSearchParams(location.search);

  // ?demo=<plan> autoplays for headless checks: offset per drop as a share of the tier width, "miss" drops off the edge.
  // ?demo=high&n=60 stacks n perfect cakes first; the plan then starts from there. ?swing makes every later cake a balloon cake.
  const DEMO = PARAMS.get("demo");
  const PACE = (DEMO && Number(PARAMS.get("pace"))) || 1;             // ?pace=2 speeds a demo up, for recordings
  const PLANS = {
    perfect: [0, 0, 0, 0, 0], cut: [0, 0.15, -0.11, 0, 0, 0.075], over: [0, 0.12, "miss"],
    shrink: [0, 0.25, -0.25, 0.25, -0.2, 0.2], tiny: [0, 0.3, -0.3, 0.3, -0.3, 0.3, -0.3, 0.3],
    swing: [0, 0.12, -0.1, 0], tallover: ["miss"], gif: [0, 0, 0.13, 0, 0, -0.1, 0, "miss"],
  };

  const store = {
    get best() { try { return Number(localStorage.getItem("caketower.best")) || 0; } catch { return 0; } },
    set best(v) { try { localStorage.setItem("caketower.best", String(v)); } catch { /* private mode */ } },
  };

  const $ = (id) => document.getElementById(id);
  const hud = {
    show(id, on) { $(id).hidden = !on; },
    title(best) {
      $("best-n").textContent = best;
      ["over", "paused", "score", "pause"].forEach((id) => this.show(id, false));
      this.show("title", true);
    },
    play() {
      $("score").textContent = "0";
      ["title", "over", "paused"].forEach((id) => this.show(id, false));
      this.show("score", true);
      this.show("pause", true);
    },
    score(n) { $("score").textContent = n; },
    over(n, best, isNew) {
      $("over-n").textContent = `${n} cake${n === 1 ? "" : "s"}`;
      $("over-best").textContent = isNew ? "New best!" : `Best ${best}`;
      $("best-n").textContent = best;
      $("photo").disabled = false;
      $("photo").textContent = "Save photo";
      this.show("pause", false);
      this.show("score", false);    // the card shows the count; in landscape the big number sat behind it
      this.show("over", true);
    },
    paused(on) { this.show("paused", on); },
    frame(rect, a) {   // the game-over photo frame; rect in canvas pixels, a = how far the backdrop has faded in
      const back = $("photoback"), fr = $("photoframe");
      back.hidden = fr.hidden = !rect;
      if (!rect) return;
      const x = rect.x / DPR, y = rect.y / DPR, w = rect.w / DPR, h = rect.h / DPR;
      back.style.opacity = fr.style.opacity = a;
      back.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x}px ${y}px, ${x + w}px ${y}px, ${x + w}px ${y + h}px, ${x}px ${y + h}px, ${x}px ${y}px)`;
      Object.assign(fr.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    },
    banner(big, small) {
      const el = document.createElement("div");
      el.className = "banner stroke";
      el.innerHTML = `<small>${small}</small>${big}`;
      $("hud").appendChild(el);
      setTimeout(() => el.remove(), 2400);
    },
    pop(text, x, y) {
      const el = document.createElement("div");
      el.className = "pop stroke";
      el.textContent = text;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      $("hud").appendChild(el);
      setTimeout(() => el.remove(), 900);
    },
  };

  function mix(a, b, t) {
    const ch = (s) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t) << s;
    return ch(16) | ch(8) | ch(0);
  }

  function skyAt(p) {
    for (let i = 1; i < SKY.length; i++) {
      if (p <= SKY[i][0]) return mix(SKY[i - 1][1], SKY[i][1], Math.max(0, (p - SKY[i - 1][0]) / (SKY[i][0] - SKY[i - 1][0])));
    }
    return SKY[SKY.length - 1][1];
  }

  const rgb = (c) => `${(c >> 16) & 255},${(c >> 8) & 255},${c & 255}`;

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  class Cake extends Phaser.Scene {
    constructor() { super("cake"); }

    preload() {
      this.load.on("progress", (v) => { $("start-cta").textContent = `Loading ${Math.round(v * 100)}%`; });
      const url = (file) => (window.CAKE_ASSETS && window.CAKE_ASSETS[file.replace(/\.\w+$/, "")]) || `assets/${file}`;
      for (const f of FLAVORS) this.load.image(f, url(`tier-${f}.webp`));
      this.load.image("stand", url("stand.webp"));
      this.load.image("bg-portrait", url("bg-portrait.jpg"));
      this.load.image("bg-landscape", url("bg-landscape.jpg"));
      for (const k of Object.keys(DECOR_SIZE)) this.load.image(k, url(`${k}.webp`));
      for (const k of ["wall-strip", "wall-seam-l", "wall-seam-r"]) this.load.image(k, url(`${k}.webp`));
    }

    create() {
      this.makeSpark();
      this.sky = this.add.graphics().setScrollFactor(0).setDepth(-30);
      this.bg = this.add.image(0, 0, "bg-portrait").setOrigin(0.5, COUNTER).setDepth(-20);
      this.fade = this.add.image(0, 0, this.gradient("fade", 2, 256, 0, 0, 0, 256)).setOrigin(0.5, 0).setDepth(-19);
      // the whole landscape shop, shown behind the portrait one for the game-over photo: wider, so nothing has to repeat
      this.photoBg = this.add.image(0, 0, "bg-landscape").setOrigin(0.5, COUNTER).setDepth(-21).setVisible(false);
      this.wallTiles = [];
      this.add.image(0, 0, "stand").setOrigin(0.5, 1).setScale(STAND_SCALE).setDepth(-1);

      this.best = store.best;
      this.state = "title";
      this.tower = [];
      this.decor = [];
      this.camX = 0;
      this.build();

      this.input.on("pointerdown", () => this.tap());
      this.input.keyboard.on("keydown-SPACE", () => this.tap());
      this.input.keyboard.on("keydown-ENTER", () => this.tap());
      $("pause").addEventListener("click", (e) => { e.currentTarget.blur(); this.togglePause(); });
      for (const [id, flip, on] of [["music", "toggleMusic", "musicOn"], ["sound", "toggleSfx", "sfxOn"]]) {
        const b = $(id);
        b.classList.toggle("off", !CakeAudio[on]);
        b.addEventListener("click", () => {       // blur so Space still drops cakes instead of pressing the button
          b.blur();
          CakeAudio.unlock();
          CakeAudio[flip]();
          b.classList.toggle("off", !CakeAudio[on]);
        });
      }
      $("photo").addEventListener("click", (e) => {
        const b = e.currentTarget;
        b.blur();
        if (b.disabled) return;
        b.disabled = true;
        b.textContent = "Saving...";
        CakeAudio.play("shutter");
        this.savePhoto().then(() => { b.textContent = "Saved!"; }, () => { b.textContent = "Couldn't save"; });
      });
      document.addEventListener("visibilitychange", () => { if (document.hidden && this.state === "play") this.togglePause(); });
      this.scale.on("resize", () => this.layout(false));
      this.layout(true);
      hud.title(this.best);
      $("start-cta").textContent = "Tap to start";
      $("start-cta").classList.remove("loading");

      if (DEMO) {
        CakeAudio.unlock();
        CakeAudio.startMusic();
      }
      this.demoBase = 0;
      if (DEMO && DEMO !== "title") this.start();
      if (DEMO && PARAMS.has("n")) this.stackInstantly(Number(PARAMS.get("n")));
    }

    makeSpark() {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      const pts = [];
      for (let i = 0; i < 8; i++) {
        const r = i % 2 ? 5 : 16, a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        pts.push(new Phaser.Math.Vector2(16 + Math.cos(a) * r, 16 + Math.sin(a) * r));
      }
      g.fillStyle(0xfffbe8, 1).fillPoints(pts, true);
      g.generateTexture("spark", 32, 32);
      g.destroy();
    }

    gradient(key, w, h, x0, y0, x1, y1) {   // canvas texture fading from opaque at (x0,y0) to clear at (x1,y1)
      const tex = this.textures.createCanvas(key, w, h);
      tex.fadeLine = [x0, y0, x1, y1];
      return key;
    }

    paintGradient(key, c) {
      const tex = this.textures.get(key), ctx = tex.getContext(), [x0, y0, x1, y1] = tex.fadeLine;
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, `rgba(${rgb(c)},1)`);
      grad.addColorStop(1, `rgba(${rgb(c)},0)`);
      ctx.clearRect(0, 0, tex.width, tex.height);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, tex.width, tex.height);
      tex.refresh();
    }

    // ---- tower ----

    build() {
      for (const t of this.tower) t.img.destroy();
      if (this.moving) this.dropMoving();
      this.tower = [];
      this.top = null;
      this.bag = [];
      this.score = 0;
      this.combo = 0;
      this.side = 1;
      this.lastSwing = -99;
      this.dropping = false;
      this.top = this.place(this.nextFlavor(), 0, 1, PLATE_Y);
      for (const d of this.decor) { this.tweens.killTweensOf(d); d.destroy(); }
      this.decor = [];
      this.decorY = undefined;
      this.decorSide = 1;
      this.nightCount = 0;
      this.moonShown = this.planetShown = false;
      this.skyP = 0;
      if (this.revealTween) this.revealTween.remove();
      this.reveal = this.revealTween = null;
      this.cardShown = false;
      if (this.photoBg) this.endPhoto();
    }

    dropMoving() {
      const m = this.moving;
      this.tweens.killTweensOf(m.img);
      m.img.destroy();
      if (m.balloon) { this.tweens.killTweensOf(m.balloon); m.balloon.destroy(); m.rope.destroy(); }
      this.moving = null;
    }

    nextFlavor() {
      if (!this.bag.length) this.bag = Phaser.Utils.Array.Shuffle(FLAVORS.slice());
      let f = this.bag.pop();
      if (this.top && f === this.top.key && this.bag.length) {   // never the same flavor twice in a row
        const g = this.bag.pop();
        this.bag.unshift(f);
        f = g;
      }
      return f;
    }

    height(s) { return TEX.tierH * K * s; }

    place(key, cx, s, bottomY) {
      const img = this.add.image(cx, bottomY, key).setOrigin(0.5, ANCHOR.bottom).setScale(K * s).setDepth(this.tower.length);
      const tier = { img, key, cx, s, surface: bottomY - (ANCHOR.bottom - ANCHOR.top) * this.height(s) };
      this.tower.push(tier);
      return tier;
    }

    spawn() {
      const s = this.top.s;
      this.side = -this.side;
      const hard = this.score >= HARD_FROM;
      const swing = this.score >= SWING_FROM
        && (PARAMS.has("swing") || (this.score - this.lastSwing >= (hard ? 2 : 3) && Math.random() < (hard ? 0.7 : 0.45)));
      const range = TIER_W * s * SWEEP;
      const x = this.top.cx + this.side * range;
      const key = this.nextFlavor();
      const y = this.top.surface - this.height(s) * (swing ? 1.35 : 0.55);
      const img = this.add.image(x, y, key).setOrigin(0.5, ANCHOR.bottom).setScale(K * s).setDepth(this.tower.length);
      const speed = speedFor(this.score) * TIER_W * s * PACE;
      this.moving = { img, key, s, x, range, v: -this.side * speed, vx: 0, swing, momentum: hard ? 0.5 : MOMENTUM };
      if (swing) {                                    // a pendulum: starts at rest at the far end, fastest over the tower
        this.lastSwing = this.score;
        Object.assign(this.moving, { phase: (this.side * Math.PI) / 2, omega: (speed * Math.PI) / (2 * range), baseY: y });
        const src = this.textures.get("sky-balloon").getSourceImage();
        this.moving.balloon = this.add.image(x, y, "sky-balloon").setOrigin(0.5, 1).setDepth(img.depth)
          .setScale((TIER_W * s * 0.72) / src.height);
        this.moving.rope = this.add.graphics().setDepth(img.depth - 0.5);
        this.hangBalloon(this.moving);
      }
    }

    hangBalloon(m) {   // balloon and two ropes above a swinging cake
      const w = TIER_W * m.s, rim = m.img.y - (ANCHOR.bottom - ANCHOR.top) * this.height(m.s), by = rim - w * 0.3;
      m.balloon.setPosition(m.img.x, by).setAngle(-5 * Math.sin(m.phase));
      m.rope.clear().lineStyle((2.5 * DPR) / this.cameras.main.zoom, INK, 1)
        .lineBetween(m.img.x - w * 0.05, by - 2, m.img.x - w * 0.3, rim)
        .lineBetween(m.img.x + w * 0.05, by - 2, m.img.x + w * 0.3, rim);
    }

    update(_, dt) {
      const m = this.moving;
      if (this.state === "play" && m && !this.dropping) {
        const prev = this.landingX(m);
        if (m.swing) {
          m.phase += (m.omega * dt) / 1000;
          const sn = Math.sin(m.phase);
          m.x = this.top.cx + m.range * sn;
          m.vx = m.range * m.omega * Math.cos(m.phase);
          m.img.y = m.baseY - this.height(m.s) * 0.25 * sn * sn;   // an arc: a little higher at the ends
          m.img.x = m.x;
          this.hangBalloon(m);
        } else {
          m.x += (m.v * dt) / 1000;
          const lo = this.top.cx - m.range, hi = this.top.cx + m.range;
          if (m.x > hi) { m.x = hi; m.v = -Math.abs(m.v); }
          if (m.x < lo) { m.x = lo; m.v = Math.abs(m.v); }
          m.img.x = m.x;
        }
        if (DEMO) this.demoStep(prev);
      }
      this.follow(dt);
    }

    landingX(m) { return m.swing ? m.x + (m.momentum * m.vx * SWING_FALL) / 1000 : m.x; }

    perfectTol(s) {   // 3% of the width, plus a floor that makes tiny cakes forgiving; the floor fades out during the sugar rush
      return Math.max(TIER_W * s * 0.03, 5 * Phaser.Math.Clamp(1 - (this.score - HARD_FROM) / 50, 0, 1));
    }

    tap() {
      if (this.state === "title") return this.start();
      if (this.state === "paused") return this.togglePause();
      if (this.state === "over") {
        if (!this.cardShown) {                        // skip the zoom-out: jump straight to the whole tower
          if (!this.reveal) this.revealTower();
          this.revealTween.remove();
          this.reveal.t = 1;                          // Tween.complete() alone leaves t where it was
          this.showCard();
        } else if (this.time.now - this.cardAt > 350) this.restart();
        return;
      }
      if (this.state !== "play" || !this.moving || this.dropping) return;
      const m = this.moving;
      this.dropping = true;
      CakeAudio.play("drop");
      if (!m.swing) {
        this.tweens.add({ targets: m.img, y: this.top.surface, duration: 120, ease: "Quad.easeIn", onComplete: () => this.land() });
        return;
      }
      CakeAudio.play("release");
      const to = this.landingX(m), balloon = m.balloon;
      m.rope.destroy();
      m.balloon = null;
      this.tweens.add({                               // the balloon floats away
        targets: balloon, y: balloon.y - TIER_W * m.s * 2.5, alpha: 0, angle: 0, duration: 1600, ease: "Sine.easeIn",
        onComplete: () => balloon.destroy(),
      });
      this.tweens.add({ targets: m.img, x: to, duration: SWING_FALL });
      this.tweens.add({
        targets: m.img, y: this.top.surface, duration: SWING_FALL, ease: "Quad.easeIn",
        onComplete: () => { m.x = m.img.x = to; this.land(); },
      });
    }

    land() {
      const m = this.moving, top = this.top;
      this.moving = null;
      this.dropping = false;
      const half = (TIER_W * m.s * HIT) / 2;       // falling tier and top tier are always the same size
      const dx = m.x - top.cx;
      const overlap = 2 * half - Math.abs(dx);
      if (overlap <= 0) return this.miss(m);
      CakeAudio.play("plop");

      let s = m.s, cx = m.x;
      if (Math.abs(dx) <= this.perfectTol(m.s)) {
        cx = top.cx;
        this.combo++;
        if (this.combo >= 3) s = Math.min(1, s * (this.score >= HARD_FROM ? 1.04 : 1.08));   // a perfect streak grows the cake back
        this.cheer(cx, top.surface, s);
        CakeAudio.play("perfect", this.combo);
      } else {
        this.combo = 0;
        s = (m.s * overlap) / (2 * half);
        cx = (m.x + top.cx) / 2;                           // center of the overlap
        this.chop(m, dx);
        CakeAudio.play("chop");
        CakeAudio.play("land", this.score);
      }
      m.img.destroy();

      this.top = this.place(m.key, cx, s, top.surface);
      this.top.img.setScale(K * s * 1.06, K * s * 0.86);
      this.tweens.add({ targets: this.top.img, scaleX: K * s, scaleY: K * s, duration: 220, ease: "Back.easeOut" });
      this.score++;
      hud.score(this.score);
      CakeAudio.setPhase(phaseOf(this.score));
      if (this.score !== HARD_FROM) return this.spawn();
      hud.banner("Sugar rush!", `${HARD_FROM} cakes!`);   // with a breather: the next cake waits until the banner has shown
      CakeAudio.play("best");
      this.time.delayedCall(1300, () => { if (this.state === "play" && !this.moving) this.spawn(); });
    }

    chop(m, dx) {
      const sc = K * m.s;
      const cut = Math.min(TEX.tierW, Math.abs(dx) / sc + ((1 - HIT) / 2) * TEX.tierW);   // texture px hanging over
      const x0 = dx > 0 ? TEX.tierW - cut : 0;
      const ox = (x0 + cut / 2) / TEX.tierW;
      const piece = this.add.image(m.img.x + (ox - 0.5) * TEX.tierW * sc, m.img.y + (0.47 - ANCHOR.bottom) * TEX.tierH * sc, m.key)
        .setOrigin(ox, 0.47).setScale(sc).setCrop(x0, 0, cut, TEX.tierH).setDepth(m.img.depth + 1);
      const dir = Math.sign(dx);
      this.tweens.add({
        targets: piece, x: piece.x + dir * 120 * m.s, y: piece.y + 900 * m.s, angle: dir * 40, alpha: 0,
        duration: 950, ease: "Quad.easeIn", onComplete: () => piece.destroy(),
      });
    }

    cheer(x, y, s) {
      const p = this.toScreen(x, y);
      hud.pop(this.combo > 1 ? `Perfect! ×${this.combo}` : "Perfect!", p.x, p.y);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const sp = this.add.image(x + Math.cos(a) * TIER_W * 0.3 * s, y + Math.sin(a) * 40 * s, "spark").setDepth(999).setScale(0.8 * s);
        this.tweens.add({
          targets: sp, x: sp.x + Math.cos(a) * 120 * s, y: sp.y + (Math.sin(a) * 60 - 40) * s, alpha: 0, scale: 0.2 * s,
          duration: 600, ease: "Quad.easeOut", onComplete: () => sp.destroy(),
        });
      }
    }

    miss(m) {
      const dir = Math.sign(m.x - this.top.cx) || 1;
      this.tweens.add({
        targets: m.img, x: m.img.x + dir * 160 * m.s, y: m.img.y + 1100 * m.s, angle: dir * 60,
        duration: 1100, ease: "Quad.easeIn", onComplete: () => m.img.destroy(),
      });
      this.state = "over";
      CakeAudio.play("miss");
      CakeAudio.duck(true);
      this.isNewBest = this.score > this.best;
      if (this.isNewBest) {
        this.best = this.score;
        store.best = this.best;
      }
      this.cameras.main.shake(180, 0.004);
      this.time.delayedCall(450, () => this.revealTower());
    }

    // ---- game over: zoom out to the whole tower, then the card ----

    revealTower() {
      if (this.state !== "over" || this.reveal) return;
      this.reveal = { t: 0, z0: this.cameras.main.zoom, x0: this.camX, y0: this.camY, ...this.towerFrame() };
      CakeAudio.play("reveal");
      this.revealTween = this.tweens.add({ targets: this.reveal, t: 1, duration: 1500, ease: "Sine.easeInOut", onComplete: () => this.showCard() });
    }

    towerFrame() {   // the game-over photo: zoom, frame and framing that fit the whole tower, inside the shop
      const cam = this.cameras.main, W = cam.width, H = cam.height;
      const r = H >= W
        ? { x: W * 0.06, y: H * 0.395, w: W * 0.88, h: H * 0.56 }    // portrait: under the card, clear of the tape
        : { x: W * 0.05, y: H * 0.08, w: W * 0.56, h: H * 0.84 };    // landscape: left of the card
      let left = -TIER_W * 0.62, right = TIER_W * 0.62;              // at least the stand
      for (const t of this.tower) {
        left = Math.min(left, t.cx - TIER_W * t.s * 0.6);
        right = Math.max(right, t.cx + TIER_W * t.s * 0.6);
      }
      left -= TIER_W * 0.15;
      right += TIER_W * 0.15;
      const pic = this.photoPic(), pw = pic.displayWidth, bottom = (1 - COUNTER) * pic.displayHeight;
      const top = this.top.surface - this.height(this.top.s) * ANCHOR.top - TIER_W * Math.max(this.top.s, 0.3) * 0.35;
      const z = Math.min(this.baseZoom, r.w / (right - left), r.h / (bottom - top));
      // as wide as the region allows, but no wider than the shop picture (or the tower), and never skinnier than PHOTO_ASPECT
      let worldW = Math.min(r.w / z, Math.max(pw, right - left));
      worldW = Math.max(worldW, Math.min(r.w, r.h * PHOTO_ASPECT) / z);
      let cx = (left + right) / 2;                                   // inside the picture while it fits, with the tower still in it
      if (worldW <= pw) {
        cx = Phaser.Math.Clamp(cx, -pw / 2 + worldW / 2, pw / 2 - worldW / 2);
        cx = Phaser.Math.Clamp(cx, right - worldW / 2, left + worldW / 2);
      }
      const allowL = Math.min(-pw / 2, cx - worldW / 2), allowR = Math.max(pw / 2, cx + worldW / 2);
      this.extendWall(allowL, allowR);
      const fw = worldW * z, rect = { x: r.x + (r.w - fw) / 2, y: r.y, w: fw, h: r.h };
      return { rect, z1: z, worldW, cx1: cx, allowL, allowR, bottom, y1: bottom - (rect.y + rect.h - H / 2) / z };
    }

    photoPic() { return this.portrait ? this.photoBg : this.bg; }

    extendWall(l, r) {   // plain wall past the picture's edges, only for towers too tall for the picture alone
      for (const t of this.wallTiles) t.destroy();
      this.wallTiles = [];
      const pic = this.photoPic(), pw = pic.displayWidth, src = this.textures.get("wall-strip").getSourceImage();
      const k = pic.displayHeight / src.height, tile = src.width * k, depth = pic.depth + 0.5;
      const put = (key, x) => this.wallTiles.push(this.add.image(x, 0, key).setOrigin(0.5, COUNTER).setScale(k).setDepth(depth));
      if (l < -pw / 2) {                               // the seam piece fades into the picture, hiding its cut edge
        put("wall-seam-l", -pw / 2);
        for (let x = -pw / 2 - tile; x + tile / 2 > l; x -= tile) put("wall-strip", x);
      }
      if (r > pw / 2) {
        put("wall-seam-r", pw / 2);
        for (let x = pw / 2 + tile; x - tile / 2 < r; x += tile) put("wall-strip", x);
      }
    }

    endPhoto() {
      this.bg.setAlpha(1);
      this.photoBg.setVisible(false);
      for (const t of this.wallTiles) t.destroy();
      this.wallTiles = [];
      hud.frame(null);
    }

    tierAt(y) {   // how many cakes up the tower a world height is: the photo's sky runs through the whole climb
      const t = this.tower;
      if (y >= t[0].surface) return 0;
      for (let i = 1; i < t.length; i++) {
        if (y >= t[i].surface) return i - 1 + (t[i - 1].surface - y) / (t[i - 1].surface - t[i].surface);
      }
      const last = t[t.length - 1];
      return t.length - 1 + (last.surface - y) / this.height(Math.max(last.s, 0.2));
    }

    showCard() {
      if (this.state !== "over" || this.cardShown) return;
      this.cardShown = true;
      this.cardAt = this.time.now;
      hud.over(this.score, this.best, this.isNewBest);
      if (this.isNewBest) CakeAudio.play("best");
    }

    makePhoto() {   // a cream photo card: the revealed tower, how tall it got, and the date
      const r = this.reveal.rect;
      return new Promise((resolve) => {
        this.game.renderer.snapshotArea(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h), resolve);
      }).then(async (img) => {
        await document.fonts.load('700 88px "Fredoka"');
        const W = 1080, pad = 56, cap = 250, maxH = 1480;   // tall towers make tall, narrower photos
        let pw = W - pad * 2, ph = Math.round((pw * img.height) / img.width);
        if (ph > maxH) { ph = maxH; pw = Math.round((ph * img.width) / img.height); }
        const px = (W - pw) / 2;
        const c = document.createElement("canvas");
        c.width = W;
        c.height = pad + ph + cap;
        const g = c.getContext("2d");
        g.fillStyle = "#fff8ee";
        g.fillRect(0, 0, c.width, c.height);
        g.save();
        roundRect(g, px, pad, pw, ph, 32);
        g.clip();
        g.drawImage(img, px, pad, pw, ph);
        g.restore();
        g.lineWidth = 6;
        g.strokeStyle = "#7a4a2e";
        roundRect(g, px, pad, pw, ph, 32);
        g.stroke();
        g.textAlign = "center";
        g.fillStyle = "#7a4a2e";
        g.font = '700 88px "Fredoka"';
        g.fillText(`${this.score} cake${this.score === 1 ? "" : "s"} tall`, W / 2, pad + ph + 125);
        g.fillStyle = "#b0806a";
        g.font = '600 38px "Fredoka"';
        const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        g.fillText(`Cake Tower · ${date}`, W / 2, pad + ph + 190);
        if (this.isNewBest) {                         // pink "New best!" pill in the photo's corner
          g.font = '700 40px "Fredoka"';
          const tw = g.measureText("New best!").width + 56;
          roundRect(g, px + 28, pad + 28, tw, 68, 34);
          g.fillStyle = "#ff9db4";
          g.fill();
          g.lineWidth = 5;
          g.stroke();
          g.lineJoin = "round";
          g.lineWidth = 9;
          g.strokeText("New best!", px + 28 + tw / 2, pad + 76);
          g.fillStyle = "#ffffff";
          g.fillText("New best!", px + 28 + tw / 2, pad + 76);
        }
        return c;
      });
    }

    async savePhoto() {   // share sheet on phones, a PNG download elsewhere
      const c = await this.makePhoto();
      const blob = await new Promise((res) => c.toBlob(res, "image/png"));
      const name = `cake-tower-${this.score}.png`;
      const file = new File([blob], name, { type: "image/png" });
      if (matchMedia("(pointer: coarse)").matches && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "Cake Tower" });
          return;
        } catch (e) {
          if (e.name === "AbortError") return;
        }
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }

    // ---- flow ----

    start() {
      CakeAudio.play("tap");
      CakeAudio.setPhase("day");
      CakeAudio.startMusic();
      this.state = "play";
      hud.play();
      this.spawn();
    }

    restart() {
      CakeAudio.duck(false);
      this.build();
      this.cameras.main.setZoom(this.zoomTarget());
      this.camX = 0;
      this.camY = this.cameraTarget();
      this.start();
    }

    togglePause() {
      if (this.state === "play") {
        this.state = "paused";
        this.tweens.pauseAll();
        CakeAudio.pause(true);
        hud.paused(true);
      } else if (this.state === "paused") {
        this.state = "play";
        this.tweens.resumeAll();
        CakeAudio.pause(false);
        hud.paused(false);
      }
    }

    // ---- camera, sky, layout ----

    focus() { return this.moving && this.moving.swing ? FOCUS_SWING : FOCUS; }

    zoomTarget() {
      let z = zoomFor(this.top.s);
      if (z > this.shopCap) {   // magnifying the shop wall only blurs it: cap the zoom while the wall would be on screen
        const d = this.shopTop - this.top.surface, viewBase = this.cameras.main.height / this.baseZoom;
        if (d <= 0 || z < ((1 - this.focus()) * viewBase) / d) z = this.shopCap;
      }
      return this.baseZoom * z;
    }

    view() { return this.cameras.main.height / this.zoomTarget(); }   // target zoom keeps the camera target steady while zooming

    cameraTarget() {
      const start = (0.5 - COUNTER) * this.view();                 // the stand's foot at 80% of the screen
      return Math.min(start, this.top.surface + (0.5 - this.focus()) * this.view());
    }

    follow(dt) {
      const cam = this.cameras.main;
      if (this.reveal) {
        const r = this.reveal, t = r.t, L = Phaser.Math.Linear, W = cam.width, H = cam.height;
        const z = Math.exp(L(Math.log(r.z0), Math.log(r.z1), t));
        cam.setZoom(z);
        // the frame shrinks from the whole screen to the photo; its world width eases between the two, so it never outgrows the shop
        const worldW = Math.exp(L(Math.log(W / r.z0), Math.log(r.worldW), t));
        const fw = Math.min(W, worldW * z), fcx = L(W / 2, r.rect.x + r.rect.w / 2, t), fy = L(0, r.rect.y, t), fh = L(H, r.rect.h, t);
        this.camY = L(r.y0, r.y1, t);
        // the frame's world centre travels to its target, held inside the shop (and any extension) once the shop shows in the frame
        const halfW = fw / z / 2, lo = r.allowL + halfW, hi = r.allowR - halfW;
        const inShop = Phaser.Math.Clamp((this.camY + (fy + fh - H / 2) / z - this.shopTop) / (0.3 * (r.bottom - this.shopTop)), 0, 1);
        let wcx = L(r.x0, r.cx1, t);
        wcx = L(wcx, lo <= hi ? Phaser.Math.Clamp(wcx, lo, hi) : (lo + hi) / 2, inShop);
        this.camX = wcx - (fcx - W / 2) / z;
        cam.centerOn(this.camX, this.camY);
        const fb = Math.min(fy + fh, (r.bottom - this.camY) * z + H / 2);   // never below the picture's bottom edge
        hud.frame({ x: fcx - fw / 2, y: fy, w: fw, h: fb - fy }, Phaser.Math.Clamp(t / 0.3, 0, 1));
        this.photoBg.setVisible(this.portrait);
        this.bg.setAlpha(this.portrait ? 1 - Phaser.Math.Clamp(t / 0.35, 0, 1) : 1);
        const c = skyAt(L(this.skyP, this.tierAt(this.shopTop), t));
        if (c !== this.fadeColor) this.paintFade(c);
        this.paintSky();
        return;
      }
      cam.setZoom(cam.zoom + (this.zoomTarget() - cam.zoom) * Math.min(1, dt / 300));
      this.camY += (this.cameraTarget() - this.camY) * Math.min(1, dt / 180);
      // pan toward a drifting tower, but never past the shop's edges while the shop is on screen
      const viewW = cam.width / this.zoomTarget();
      const shopInView = this.camY + this.view() / 2 > this.shopTop;
      const room = shopInView ? Math.max(0, (this.bg.displayWidth - viewW) / 2) : Infinity;
      this.camX += (Phaser.Math.Clamp(this.top.cx, -room, room) - this.camX) * Math.min(1, dt / 250);
      cam.centerOn(this.camX, this.camY);
      this.skyP += (this.score - this.skyP) * Math.min(1, dt / 600);
      const c = skyAt(this.skyP);
      if (c !== this.fadeColor) this.paintFade(c);
      this.paintSky();
      this.spawnDecor();
    }

    // ---- sky decor: spawned just above the view in world space, sized for the current zoom ----

    spawnDecor() {
      const z = this.zoomTarget(), viewH = this.view(), halfW = this.cameras.main.width / (2 * z);
      const viewTop = this.camY - viewH / 2;
      if (this.decorY === undefined) this.decorY = this.shopTop - viewH * 0.3;
      while (this.decorY > viewTop - viewH * 0.6) {
        const gap = viewH * Phaser.Math.FloatBetween(0.26, 0.42);
        this.addDecor(this.decorY, halfW, gap);
        this.decorY -= gap;
      }
      this.decor = this.decor.filter((d) => d.active);   // birds remove themselves after flying past
      while (this.decor.length > MAX_DECOR) {
        const d = this.decor.shift();
        this.tweens.killTweensOf(d);
        d.destroy();
      }
    }

    addDecor(y, halfW, gap) {
      const phase = phaseOf(this.score);
      let key = pick(DECOR[phase]);
      if (phase === "night") {
        if (!this.moonShown) { key = "sky-moon"; this.moonShown = true; }
        else if (!this.planetShown && ++this.nightCount >= 5) { key = "sky-planet"; this.planetShown = true; }
      }
      if (key === "sky-star") {                        // stars come in small scattered clusters
        for (let i = Phaser.Math.Between(3, 5); i > 0; i--) {
          this.makeDecor(key, this.camX + Phaser.Math.FloatBetween(-0.95, 0.95) * halfW, y - Math.random() * gap);
        }
        return;
      }
      this.decorSide = -this.decorSide;
      const big = key === "sky-moon" || key === "sky-planet" || key === "sky-balloon";   // hug the screen edge, clear of the tower
      this.makeDecor(key, this.camX + this.decorSide * Phaser.Math.FloatBetween(big ? 0.62 : 0.3, big ? 0.82 : 0.85) * halfW, y, halfW);
    }

    makeDecor(key, x, y, halfW) {
      const [lo, hi] = DECOR_SIZE[key];
      const size = (Phaser.Math.FloatBetween(lo, hi) * TIER_W) / zoomFor(this.top.s);   // same on-screen size at any zoom
      const src = this.textures.get(key).getSourceImage();
      const img = this.add.image(x, y, key).setDepth(-10).setScale(size / Math.max(src.width, src.height));
      const R = Phaser.Math.FloatBetween;
      if (key === "sky-birds") {                      // fly across and away; the art faces right
        const dir = Math.random() < 0.5 ? 1 : -1;
        img.setFlipX(dir < 0).setX(this.camX - dir * (halfW + size));
        this.tweens.add({ targets: img, x: this.camX + dir * (halfW + size), duration: R(9000, 13000), onComplete: () => img.destroy() });
        this.tweens.add({ targets: img, y: y - size * 0.12, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      } else if (key === "sky-star") {                // twinkle by size; fading made the yellow look grey on navy
        const s0 = img.scale;
        this.tweens.add({ targets: img, scale: s0 * 0.7, duration: R(700, 1600), delay: R(0, 1200), yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      } else if (key === "sky-planet") {
        img.setAngle(-6);
        this.tweens.add({ targets: img, angle: 6, duration: 6000, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      } else {                                        // clouds drift, the balloon and moon bob
        const bob = key === "sky-balloon" || key === "sky-moon";
        const drift = Math.random() < 0.5 ? -1 : 1;
        this.tweens.add({
          targets: img, x: x + (bob ? 0.05 : 0.14) * size * drift, y: y - (bob ? 0.07 * size : 0),
          duration: R(3000, 9000), yoyo: true, repeat: -1, ease: "Sine.easeInOut",
        });
      }
      this.decor.push(img);
    }

    toScreen(wx, wy) {
      const cam = this.cameras.main;
      return { x: ((wx - cam.worldView.x) * cam.zoom) / DPR, y: ((wy - cam.worldView.y) * cam.zoom) / DPR };
    }

    paintSky() {
      const cam = this.cameras.main, z = cam.zoom, W = cam.width, H = cam.height, n = this.reveal ? 240 : 24;
      const x0 = W / 2 - W / (2 * z), y0 = H / 2 - H / (2 * z), bw = W / z, bh = H / z / n;
      const worldTop = this.camY - H / (2 * z), t = this.reveal ? this.reveal.t : 0;
      this.sky.clear();
      for (let i = 0; i < n; i++) {   // during play the top of the screen is a few cakes "ahead"; the photo maps height to cakes
        const play = this.skyP + 3 - (6 * (i + 0.5)) / n;
        const p = t ? Phaser.Math.Linear(play, this.tierAt(worldTop + (i + 0.5) * bh), t) : play;
        this.sky.fillStyle(skyAt(p), 1).fillRect(x0, y0 + i * bh, bw, bh + 1);
      }
    }

    paintFade(c) {   // blend the top edge of the shop into the sky
      this.fadeColor = c;
      this.paintGradient("fade", c);
    }

    layout(snap) {
      const cam = this.cameras.main, W = this.scale.width, H = this.scale.height;
      const portrait = H >= W;
      this.portrait = portrait;
      cam.setSize(W, H);
      this.baseZoom = (portrait ? 0.48 * W : Math.min(0.18 * W, 0.32 * H)) / TIER_W;
      const key = portrait ? "bg-portrait" : "bg-landscape";
      const src = this.textures.get(key).getSourceImage();
      this.bg.setTexture(key).setScale(Math.max(W / this.baseZoom / src.width, H / this.baseZoom / src.height));
      const bw = this.bg.displayWidth, bh = this.bg.displayHeight;
      this.shopTop = -COUNTER * bh;
      this.fade.setPosition(0, this.shopTop).setDisplaySize(1e5, bh * 0.08);   // wide enough for any wall extension
      this.photoBg.setScale(bh / this.textures.get("bg-landscape").getSourceImage().height);
      // how far the shop picture can be magnified before it goes soft: texture pixels per screen pixel, with some slack
      this.shopCap = Phaser.Math.Clamp((src.width / (bw * this.baseZoom)) * 1.6, 1, 2.5);
      this.paintFade(skyAt(this.skyP));
      if (this.reveal) Object.assign(this.reveal, this.towerFrame());
      else if (snap || this.camY === undefined) {
        cam.setZoom(this.zoomTarget());
        this.camY = this.cameraTarget();
      }
      this.follow(0);
    }

    // ---- headless checks ----

    demoStep(prev) {
      const plan = PLANS[DEMO], i = this.score - this.demoBase;
      if (!plan || i < 0 || i >= plan.length) return;
      const m = this.moving, want = plan[i], now = this.landingX(m);
      if (want === "miss") {
        if (Math.abs(now - this.top.cx) >= TIER_W * m.s) this.tap();
        return;
      }
      const target = this.top.cx + want * TIER_W * m.s;
      if ((prev - target) * (now - target) <= 0) {
        if (!m.swing) m.x = m.img.x = target;
        this.tap();
      }
    }

    stackInstantly(n) {
      for (let i = 0; i < n; i++) {
        if (!this.moving) this.spawn();
        if (this.moving.balloon) { this.moving.balloon.destroy(); this.moving.rope.destroy(); this.moving.balloon = null; }
        this.moving.x = this.top.cx;
        this.moving.vx = 0;
        this.moving.img.y = this.top.surface;
        this.land();
        this.skyP = this.score;
        this.camY = this.cameraTarget();
        this.spawnDecor();
      }
      this.demoBase = this.score;
    }
  }

  function boot() {
    const game = new Phaser.Game({
      // file:// images taint the canvas (no WebGL, no photo) unless they come from assets/bundle.js as data URLs
      type: location.protocol === "file:" && !window.CAKE_ASSETS ? Phaser.CANVAS : Phaser.AUTO,
      parent: "game",
      backgroundColor: "#fbe9df",
      banner: false,
      scale: { mode: Phaser.Scale.NONE, width: innerWidth * DPR, height: innerHeight * DPR, zoom: 1 / DPR },
      loader: { imageLoadType: "HTMLImageElement" },
      scene: Cake,
    });
    addEventListener("resize", () => game.scale.resize(innerWidth * DPR, innerHeight * DPR));
    window.cakeTower = game;
  }

  if (location.protocol === "file:") {
    const s = document.createElement("script");
    s.src = "assets/bundle.js";
    s.onload = s.onerror = boot;
    document.head.appendChild(s);
  } else boot();
})();
