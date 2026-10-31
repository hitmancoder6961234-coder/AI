/*!
 * Darkness Atmosphere — dynamic backgrounds and light.
 *
 *   classic  the interface exactly as shipped (no effect, nothing drawn)
 *   blood    crimson blood moon: breathing moon light, drifting fog, embers, dripping blood,
 *            droplets sliding down the glass
 *   water    deep blue silence: swaying light shafts, living caustics, bubbles, plankton,
 *            ripples on click, slowly shifting blue
 *
 * Zero dependencies. One <canvas>. Pauses when the tab is hidden, honours prefers-reduced-motion,
 * caps device-pixel-ratio and particle counts on small screens.
 *
 * API: window.DarknessAtmosphere.set('blood' | 'water' | 'classic'), .get(), .modes
 * URL: ?atmosphere=blood  (also remembered in localStorage)
 */
(function () {
  'use strict';
  if (window.DarknessAtmosphere) return;

  var STORAGE_KEY = 'darkness_atmosphere';
  var MODES = [
    { id: 'classic', label: 'Classic', hint: 'As usual' },
    { id: 'blood', label: 'Blood Moon', hint: 'Crimson sky, falling blood' },
    { id: 'water', label: 'Deep Water', hint: 'Blue silence, drifting light' }
  ];
  var THEME_COLOR = { classic: null, blood: '#12030a', water: '#031632' };

  var root = document.documentElement;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- utilities -------------------------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function store(get, value) {
    try {
      if (get) return window.localStorage.getItem(STORAGE_KEY);
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (e) { /* storage may be unavailable (private mode) */ }
    return null;
  }
  function validMode(id) { return MODES.some(function (m) { return m.id === id; }); }

  // ---- canvas ----------------------------------------------------------------------------
  var canvas = document.createElement('canvas');
  canvas.id = 'atmosphereCanvas';
  canvas.setAttribute('aria-hidden', 'true');
  var ctx = canvas.getContext('2d', { alpha: true });
  // Foreground "glass" layer: blood runs over the interface, never blocks input (pointer-events: none).
  var fcanvas = document.createElement('canvas');
  fcanvas.id = 'atmosphereFront';
  fcanvas.setAttribute('aria-hidden', 'true');
  var fctx = fcanvas.getContext('2d', { alpha: true });
  var W = 0, H = 0, DPR = 1, small = false;
  var mode = 'classic';
  var raf = 0, last = 0, T = 0, frame = 0;
  var pointer = { x: 0.5, y: 0.35, sx: 0.5, sy: 0.35, active: false };
  var scene = null;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth; H = window.innerHeight;
    small = W < 700;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    fcanvas.width = canvas.width; fcanvas.height = canvas.height;
    fcanvas.style.width = canvas.style.width; fcanvas.style.height = canvas.style.height;
    fctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (scene && scene.resize) scene.resize();
    if (mode !== 'classic' && reduceMotion) drawStill();
  }

  // =========================================================================================
  //  BLOOD MOON
  // =========================================================================================
  function createBlood() {
    var craterRand = mulberry32(1969);
    var craters = [];
    for (var i = 0; i < 16; i++) {
      var a = craterRand() * Math.PI * 2, d = Math.sqrt(craterRand()) * 0.86;
      craters.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: 0.05 + craterRand() * 0.15, o: 0.10 + craterRand() * 0.18 });
    }
    var fog = [], embers = [], drips = [], falls = [], runners = [], splashes = [];
    var nextDrip = 0.4;

    function initFog() {
      fog.length = 0;
      for (var i = 0; i < 6; i++) {
        // back layers are dense and dark; front layers are thin so the moon never gets muddy
        fog.push({ x: rand(-0.2, 1.2), y: rand(0.3, 0.98), w: rand(0.5, 1.1), h: rand(0.10, 0.22), v: rand(0.004, 0.014) * (i % 2 ? 1 : -1), a: i > 3 ? rand(0.08, 0.14) : rand(0.16, 0.28), front: i > 3 });
      }
    }
    function spawnEmber(anywhere) {
      embers.push({ x: rand(0, W), y: anywhere ? rand(0, H) : H + 10, r: rand(0.6, 2.0), vy: rand(6, 22), ph: rand(0, 6.28), sw: rand(8, 26), life: rand(0.5, 1) });
    }
    function initEmbers() {
      embers.length = 0;
      var n = small ? 22 : 46;
      for (var i = 0; i < n; i++) spawnEmber(true);
    }
    function spawnDrip() {
      var k = small ? 0.85 : 1;
      drips.push({ x: rand(W * 0.03, W * 0.97), len: 0, max: rand(22, 70), w: rand(4.2, 8.0) * k, speed: rand(9, 20), state: 'hang', vy: 0, hold: rand(0.2, 0.9) });
    }
    function spawnRunner(top) {
      var r = rand(2.4, 5.6) * (small ? 0.85 : 1);
      runners.push({ x: rand(8, W - 8), y: top ? rand(-10, H * 0.25) : rand(0, H * 0.55), r: r, vy: 0, target: rand(26, 96) * (1.4 - r / 6), pause: rand(0, 1.2), seed: rand(0, 99), pts: [], dead: false, fade: 1, lastPt: 0 });
    }
    function runnerTarget() { return clamp(Math.round(W / 140), 5, small ? 7 : 14); }

    function splash(x, y) {
      for (var i = 0; i < 7; i++) splashes.push({ x: x, y: y, vx: rand(-70, 70), vy: rand(-150, -40), r: rand(0.7, 1.9), life: 1 });
    }

    function teardrop(x, y, r) {
      // head circle at (x,y), pointed tail rising to y - 3.1r
      ctx.beginPath();
      ctx.moveTo(x, y - r * 3.1);
      ctx.bezierCurveTo(x + r * 0.35, y - r * 1.9, x + r, y - r * 0.9, x + r, y);
      ctx.arc(x, y, r, 0, Math.PI, false);
      ctx.bezierCurveTo(x - r, y - r * 0.9, x - r * 0.35, y - r * 1.9, x, y - r * 3.1);
      ctx.closePath();
    }
    function bloodFill(x, y, r) {
      var g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r * 1.3);
      g.addColorStop(0, 'rgba(255,110,100,0.95)');
      g.addColorStop(0.35, 'rgba(190,16,28,0.96)');
      g.addColorStop(1, 'rgba(70,3,10,0.96)');
      return g;
    }
    function drawDrop(x, y, r) {
      teardrop(x, y, r);
      ctx.fillStyle = bloodFill(x, y, r);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,235,235,0.55)';
      ctx.beginPath(); ctx.arc(x - r * 0.38, y - r * 0.34, Math.max(0.5, r * 0.26), 0, 6.283); ctx.fill();
    }

    function drawSky(b, L) {
      // a blood-red sky: near-black at the zenith, deep crimson mid-sky, glowing red at the horizon
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgb(' + Math.round(lerp(30, 44, b)) + ',3,10)');
      g.addColorStop(0.5, 'rgb(' + Math.round(lerp(92, 122, b)) + ',8,22)');
      g.addColorStop(1, 'rgb(' + Math.round(lerp(150, 196, L)) + ',14,30)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    function drawMoon(b, L) {
      var R = clamp(Math.min(W, H) * 0.145, 64, 190);
      var mx = W * (0.74 + 0.018 * Math.sin(T * 0.05)), my = H * (0.22 + 0.012 * Math.sin(T * 0.07 + 1));
      // far halo, breathes with the light
      ctx.globalCompositeOperation = 'lighter';
      var halo = ctx.createRadialGradient(mx, my, R * 0.7, mx, my, R * 8);
      halo.addColorStop(0, 'rgba(255,70,45,' + (0.50 * L).toFixed(3) + ')');
      halo.addColorStop(0.22, 'rgba(225,35,35,' + (0.26 * L).toFixed(3) + ')');
      halo.addColorStop(1, 'rgba(140,0,12,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';

      ctx.save();
      ctx.beginPath(); ctx.arc(mx, my, R, 0, 6.283); ctx.clip();
      var body = ctx.createRadialGradient(mx - R * 0.35, my - R * 0.35, R * 0.1, mx, my, R * 1.05);
      body.addColorStop(0, 'rgb(255,' + Math.round(lerp(150, 182, L)) + ',116)');
      body.addColorStop(0.45, 'rgb(236,58,40)');
      body.addColorStop(1, 'rgb(142,18,24)');
      ctx.fillStyle = body; ctx.fillRect(mx - R, my - R, R * 2, R * 2);
      for (var i = 0; i < craters.length; i++) {
        var c = craters[i];
        ctx.fillStyle = 'rgba(96,8,16,' + (c.o * 0.9).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(mx + c.x * R, my + c.y * R, c.r * R, 0, 6.283); ctx.fill();
      }
      // terminator: the earth's shadow slowly crossing the disc
      var sh = ctx.createRadialGradient(mx + R * 0.6, my + R * 0.5, R * 0.25, mx + R * 0.6, my + R * 0.5, R * 1.55);
      sh.addColorStop(0, 'rgba(40,0,8,0)');
      sh.addColorStop(1, 'rgba(40,0,8,' + (0.42 + 0.1 * Math.sin(T * 0.2)).toFixed(3) + ')');
      ctx.fillStyle = sh; ctx.fillRect(mx - R, my - R, R * 2, R * 2);
      ctx.restore();

      ctx.strokeStyle = 'rgba(255,150,120,' + (0.32 * L).toFixed(3) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(mx, my, R + 1, 0, 6.283); ctx.stroke();
    }

    function drawFog(front, dt) {
      for (var i = 0; i < fog.length; i++) {
        var f = fog[i];
        if (f.front !== front) continue;
        f.x += f.v * dt;
        if (f.x > 1.4) f.x = -0.4; else if (f.x < -0.4) f.x = 1.4;
        var cx = f.x * W, cy = f.y * H, rx = f.w * W * 0.5, ry = f.h * H;
        ctx.save();
        ctx.translate(cx, cy); ctx.scale(1, ry / rx);
        var g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        g.addColorStop(0, 'rgba(70,4,14,' + f.a + ')');
        g.addColorStop(1, 'rgba(70,4,14,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, rx, 0, 6.283); ctx.fill();
        ctx.restore();
      }
    }

    function drawEmbers(dt) {
      ctx.globalCompositeOperation = 'lighter';
      for (var i = embers.length - 1; i >= 0; i--) {
        var e = embers[i];
        e.y -= e.vy * dt; e.ph += dt * 1.4;
        var x = e.x + Math.sin(e.ph) * e.sw * 0.3;
        if (e.y < -10) { embers.splice(i, 1); spawnEmber(false); continue; }
        var fade = clamp(e.y / (H * 0.25), 0, 1) * clamp((H - e.y) / 60, 0, 1);
        var a = (0.25 + 0.35 * Math.sin(e.ph * 2.3 + i)) * fade * e.life;
        if (a <= 0.01) continue;
        ctx.fillStyle = 'rgba(255,' + Math.round(70 + 60 * e.life) + ',50,' + a.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(x, e.y, e.r, 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawTopOoze(L) {
      // a thick wavering band of blood along the upper edge, the source of the drips
      var h = 5 + 2 * Math.sin(T * 0.6);
      var g = ctx.createLinearGradient(0, 0, 0, h + 8);
      g.addColorStop(0, 'rgba(120,6,16,0.95)');
      g.addColorStop(1, 'rgba(120,6,16,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0);
      for (var x = W; x >= 0; x -= 14) ctx.lineTo(x, h + 3 * Math.sin(x * 0.045 + T * 0.8) + 2 * Math.sin(x * 0.11 - T));
      ctx.closePath(); ctx.fill();
    }

    function updateDrips(dt) {
      nextDrip -= dt;
      if (nextDrip <= 0 && drips.length < (small ? 4 : 9)) { spawnDrip(); nextDrip = rand(0.8, 2.6); }
      for (var i = drips.length - 1; i >= 0; i--) {
        var d = drips[i];
        if (d.state === 'hang') {
          d.len += d.speed * dt * (1 - d.len / (d.max * 1.15));
          if (d.len >= d.max * 0.97) { d.hold -= dt; if (d.hold <= 0) { d.state = 'release'; falls.push({ x: d.x, y: d.len, r: d.w * 0.72, v: 10, y0: d.len }); } }
        } else {
          d.len -= 120 * dt;
          if (d.len <= 2) { drips.splice(i, 1); continue; }
        }
        drawHanging(d);
      }
      for (var j = falls.length - 1; j >= 0; j--) {
        var f = falls[j];
        f.v = Math.min(f.v + 820 * dt, 980);
        f.y += f.v * dt;
        if (f.y > H - 2) { splash(f.x, H - 2); falls.splice(j, 1); continue; }
        var tl = Math.min(f.y - f.y0, 150);
        var g = ctx.createLinearGradient(0, f.y - tl, 0, f.y);
        g.addColorStop(0, 'rgba(140,8,20,0)');
        g.addColorStop(1, 'rgba(150,10,22,0.5)');
        ctx.strokeStyle = g; ctx.lineWidth = f.r * 0.7; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(f.x, f.y - tl); ctx.lineTo(f.x, f.y); ctx.stroke();
        drawDrop(f.x, f.y, f.r);
      }
    }
    function drawHanging(d) {
      var rb = d.w * 0.72 * clamp(d.len / 10, 0.4, 1), w = d.w * 0.4, len = Math.max(d.len, rb);
      var g = ctx.createLinearGradient(d.x - rb, 0, d.x + rb, 0);
      g.addColorStop(0, 'rgba(80,4,12,0.95)');
      g.addColorStop(0.45, 'rgba(200,22,34,0.97)');
      g.addColorStop(1, 'rgba(70,3,10,0.95)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(d.x - w, 0);
      ctx.bezierCurveTo(d.x - w, len * 0.6, d.x - rb, len * 0.65, d.x - rb, len);
      ctx.arc(d.x, len, rb, Math.PI, 0, true);
      ctx.bezierCurveTo(d.x + rb, len * 0.65, d.x + w, len * 0.6, d.x + w, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,225,225,0.5)';
      ctx.beginPath(); ctx.arc(d.x - rb * 0.35, len - rb * 0.25, Math.max(0.5, rb * 0.24), 0, 6.283); ctx.fill();
    }

    function updateRunners(dt) {
      var want = runnerTarget(), live = 0, i;
      for (i = 0; i < runners.length; i++) if (!runners[i].dead) live++;
      if (live < want && Math.random() < dt * 1.2) spawnRunner(true);
      for (i = runners.length - 1; i >= 0; i--) {
        var r = runners[i];
        if (!r.dead) {
          if (r.pause > 0) { r.pause -= dt; r.vy *= Math.pow(0.02, dt); }
          else {
            r.vy += (r.target * (0.6 + 0.8 * Math.abs(Math.sin(T * 0.9 + r.seed))) - r.vy) * Math.min(1, dt * 2.4);
            if (Math.random() < dt * 0.45) r.pause = rand(0.35, 1.6);
          }
          r.y += r.vy * dt;
          r.x += Math.sin(T * 2.1 + r.seed) * 0.12;
          if (r.y - r.lastPt > 5) { r.pts.push(r.x, r.y); r.lastPt = r.y; if (r.pts.length > 90) r.pts.splice(0, 2); }
          if (r.y > H + 20) r.dead = true;
        } else {
          r.fade -= dt * 0.35;
          if (r.fade <= 0) { runners.splice(i, 1); continue; }
        }
        // wet trail
        if (r.pts.length > 3) {
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.strokeStyle = 'rgba(150,8,22,' + (0.55 * r.fade).toFixed(3) + ')';
          ctx.lineWidth = r.r * 0.7;
          ctx.beginPath(); ctx.moveTo(r.pts[0], r.pts[1]);
          for (var k = 2; k < r.pts.length; k += 2) ctx.lineTo(r.pts[k], r.pts[k + 1]);
          ctx.lineTo(r.x, r.y); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,120,110,' + (0.10 * r.fade).toFixed(3) + ')';
          ctx.lineWidth = Math.max(0.5, r.r * 0.16);
          ctx.stroke();
        }
        if (!r.dead) { ctx.globalAlpha = 1; drawDrop(r.x, r.y, r.r); }
      }
    }

    function updateSplashes(dt) {
      for (var i = splashes.length - 1; i >= 0; i--) {
        var s = splashes[i];
        s.vy += 520 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt * 1.8;
        if (s.life <= 0) { splashes.splice(i, 1); continue; }
        ctx.fillStyle = 'rgba(170,12,24,' + (s.life * 0.9).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
      }
    }

    function drawPointerLight(L) {
      var px = pointer.sx * W, py = pointer.sy * H, R = Math.max(W, H) * 0.28;
      var g = ctx.createRadialGradient(px, py, 0, px, py, R);
      g.addColorStop(0, 'rgba(255,70,55,' + (0.15 * L).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,40,40,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawVignette() {
      var g = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.85);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(10,0,4,0.50)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    return {
      resize: function () { initFog(); initEmbers(); },
      start: function () {
        initFog(); initEmbers();
        drips.length = falls.length = runners.length = splashes.length = 0;
        var n = runnerTarget();
        for (var i = 0; i < n; i++) spawnRunner(false);
      },
      draw: function (dt) {
        // two incommensurate sines + slow wander: the light never repeats
        var b = 0.5 + 0.5 * Math.sin(T * 0.23);
        var L = clamp(0.78 + 0.16 * Math.sin(T * 0.61) + 0.07 * Math.sin(T * 1.7 + 2), 0.45, 1);
        ctx.clearRect(0, 0, W, H);
        drawSky(b, L);
        drawFog(false, dt);
        drawMoon(b, L);
        drawFog(true, dt);
        drawEmbers(dt);
        drawPointerLight(L);
        drawVignette();
        // blood is drawn on the foreground glass layer, over the interface
        var back = ctx;
        ctx = fctx;
        try {
          ctx.clearRect(0, 0, W, H);
          drawTopOoze(L);
          updateRunners(dt);
          updateDrips(dt);
          updateSplashes(dt);
        } finally {
          ctx = back;
        }
      }
    };
  }

  // =========================================================================================
  //  DEEP WATER
  // =========================================================================================
  function createWater() {
    var beams = [], bubbles = [], motes = [], ripples = [];
    var cw = 0, ch = 0, cc = document.createElement('canvas'), cctx = cc.getContext('2d'), img = null;

    function initBeams() {
      beams.length = 0;
      var n = small ? 4 : 7;
      for (var i = 0; i < n; i++) beams.push({ x: (i + rand(0.1, 0.9)) / n, w: rand(0.05, 0.13), len: rand(0.6, 1.05), ph: rand(0, 6.28), sp: rand(0.08, 0.2), sway: rand(0.03, 0.09), skew: rand(-0.18, 0.18) });
    }
    function spawnBubble(anywhere) {
      bubbles.push({ x: rand(0, W), y: anywhere ? rand(0, H) : H + 12, r: rand(1.5, small ? 5 : 8), vy: rand(10, 34), ph: rand(0, 6.28), sw: rand(4, 14) });
    }
    function initBubbles() { bubbles.length = 0; for (var i = 0; i < (small ? 12 : 26); i++) spawnBubble(true); }
    function initMotes() {
      motes.length = 0;
      for (var i = 0; i < (small ? 30 : 70); i++) motes.push({ x: rand(0, 1), y: rand(0, 1), z: rand(0.2, 1), ph: rand(0, 6.28) });
    }
    function sizeCaustics() {
      cw = Math.max(48, Math.round(W / (small ? 10 : 8)));
      ch = Math.max(30, Math.round(H * 0.62 / (small ? 10 : 8)));
      cc.width = cw; cc.height = ch;
      img = cctx.createImageData(cw, ch);
    }

    function drawWaterBase(hue, breathe) {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'hsl(' + hue + ',78%,' + (20 + 6 * breathe).toFixed(1) + '%)');
      g.addColorStop(0.45, 'hsl(' + (hue + 3) + ',82%,' + (13 + 3 * breathe).toFixed(1) + '%)');
      g.addColorStop(1, 'hsl(' + (hue + 8) + ',88%,4.5%)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    function drawBeams(hue) {
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < beams.length; i++) {
        var b = beams[i];
        var inten = 0.5 + 0.5 * Math.sin(T * b.sp * 2 + b.ph);           // each shaft breathes on its own clock
        var sway = Math.sin(T * b.sp + b.ph * 1.7) * b.sway;
        var x0 = (b.x + sway) * W, wTop = b.w * W * 0.45, wBot = b.w * W * 1.9;
        var yb = H * b.len, xb = x0 + (b.skew + sway * 2) * H;
        var g = ctx.createLinearGradient(0, 0, 0, yb);
        g.addColorStop(0, 'hsla(' + (hue - 6) + ',100%,78%,' + (0.20 * inten + 0.04).toFixed(3) + ')');
        g.addColorStop(0.5, 'hsla(' + hue + ',95%,60%,' + (0.07 * inten).toFixed(3) + ')');
        g.addColorStop(1, 'hsla(' + hue + ',90%,50%,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x0 - wTop, 0); ctx.lineTo(x0 + wTop, 0);
        ctx.lineTo(xb + wBot, yb); ctx.lineTo(xb - wBot, yb);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawCaustics(breathe) {
      if (!img) return;
      if (frame % 2 === 0) {                       // refresh at half rate: soft, calm, cheap
        var d = img.data, t = T * 0.55, k = 0;
        for (var y = 0; y < ch; y++) {
          var fy = y / ch, fade = Math.max(0, 1 - fy * 1.05);
          for (var x = 0; x < cw; x++, k += 4) {
            var fx = x / cw * 13, gy = fy * 8.5;
            var v = Math.sin(fx * 1.3 + t) + Math.sin(gy * 1.7 - t * 1.2 + fx * 0.4) + Math.sin((fx + gy) * 1.1 + t * 0.8) + Math.sin(Math.hypot(fx - 6, gy - 3) * 1.9 - t);
            var l = 1 - Math.abs(v) / 4;                      // thin bright ridges where the waves cancel
            l = l * l * l * l * l * l * fade;
            d[k] = 150; d[k + 1] = 220; d[k + 2] = 255; d[k + 3] = Math.min(255, l * 255 * (0.9 + 0.6 * breathe));
          }
        }
        cctx.putImageData(img, 0, 0);
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cc, 0, 0, W, H * 0.62);
      ctx.restore();
    }

    function drawSurface(hue) {
      for (var j = 0; j < 3; j++) {
        ctx.beginPath(); ctx.moveTo(0, 0);
        for (var x = 0; x <= W; x += 12) ctx.lineTo(x, 14 + j * 7 + Math.sin(x * 0.012 + T * (0.5 + j * 0.2) + j) * (5 - j) + Math.sin(x * 0.03 - T * 0.7) * 2);
        ctx.lineTo(W, 0); ctx.closePath();
        ctx.fillStyle = 'hsla(' + hue + ',95%,75%,' + (0.07 - j * 0.02) + ')';
        ctx.fill();
      }
    }

    function drawSwell(hue) {
      for (var j = 0; j < 2; j++) {
        var base = H * (0.9 + j * 0.05);
        ctx.beginPath(); ctx.moveTo(0, H);
        for (var x = 0; x <= W; x += 16) ctx.lineTo(x, base + Math.sin(x * 0.006 + T * (0.18 + j * 0.08) + j * 2) * 14 + Math.sin(x * 0.017 - T * 0.3) * 4);
        ctx.lineTo(W, H); ctx.closePath();
        ctx.fillStyle = 'hsla(' + (hue + 6) + ',85%,' + (6 - j * 2) + '%,0.55)';
        ctx.fill();
      }
    }

    function drawBubbles(dt) {
      for (var i = bubbles.length - 1; i >= 0; i--) {
        var b = bubbles[i];
        b.y -= b.vy * dt * (0.6 + 0.4 * (b.y / H)); b.ph += dt;
        var x = b.x + Math.sin(b.ph * 1.3) * b.sw;
        if (b.y < -12) { bubbles.splice(i, 1); spawnBubble(false); continue; }
        var a = 0.10 + 0.26 * clamp(b.y / H, 0, 1);
        ctx.strokeStyle = 'rgba(190,235,255,' + a.toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, b.y, b.r, 0, 6.283); ctx.stroke();
        ctx.fillStyle = 'rgba(220,245,255,' + (a * 0.9).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(x - b.r * 0.35, b.y - b.r * 0.35, Math.max(0.5, b.r * 0.22), 0, 6.283); ctx.fill();
      }
    }

    function drawMotes(dt) {
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < motes.length; i++) {
        var m = motes[i];
        m.ph += dt * 0.5;
        m.x = (m.x + dt * 0.004 * m.z + 1) % 1;
        m.y = (m.y - dt * 0.003 * m.z + 1) % 1;
        var tw = 0.35 + 0.35 * Math.sin(m.ph * 3 + i);
        ctx.fillStyle = 'rgba(160,215,255,' + (0.28 * tw * m.z).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(m.x * W + Math.sin(m.ph) * 6 * m.z, m.y * H, 0.6 + m.z * 1.3, 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawRipples(dt) {
      for (var i = ripples.length - 1; i >= 0; i--) {
        var r = ripples[i];
        r.age += dt;
        if (r.age > 2.6) { ripples.splice(i, 1); continue; }
        for (var k = 0; k < 3; k++) {
          var a = r.age - k * 0.28;
          if (a <= 0) continue;
          var rad = a * 110, alpha = (1 - a / 2.6) * 0.5;
          ctx.strokeStyle = 'rgba(150,215,255,' + alpha.toFixed(3) + ')';
          ctx.lineWidth = 1.6 - k * 0.4;
          ctx.beginPath(); ctx.ellipse(r.x, r.y, rad, rad * 0.62, 0, 0, 6.283); ctx.stroke();
        }
      }
    }

    function drawPointerLight(breathe) {
      var px = pointer.sx * W, py = pointer.sy * H, R = Math.max(W, H) * 0.3;
      var g = ctx.createRadialGradient(px, py, 0, px, py, R);
      g.addColorStop(0, 'rgba(110,200,255,' + (0.13 + 0.04 * breathe).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(60,140,255,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawDepth() {
      var g = ctx.createRadialGradient(W / 2, H * 0.3, Math.min(W, H) * 0.3, W / 2, H * 0.5, Math.max(W, H) * 0.9);
      g.addColorStop(0, 'rgba(0,6,24,0)');
      g.addColorStop(1, 'rgba(0,4,16,0.6)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    return {
      resize: function () { initBeams(); initBubbles(); initMotes(); sizeCaustics(); },
      start: function () { initBeams(); initBubbles(); initMotes(); sizeCaustics(); ripples.length = 0; },
      ripple: function (x, y) { if (ripples.length < 6) ripples.push({ x: x, y: y, age: 0 }); },
      draw: function (dt) {
        var hue = 212 + 11 * Math.sin(T * 0.045) + 4 * Math.sin(T * 0.13);        // the blue drifts: teal-ward ↔ ink-ward
        var breathe = 0.5 + 0.5 * Math.sin(T * 0.21);
        ctx.clearRect(0, 0, W, H);
        drawWaterBase(hue, breathe);
        drawBeams(hue);
        drawCaustics(breathe);
        drawSurface(hue);
        drawMotes(dt);
        drawBubbles(dt);
        drawPointerLight(breathe);
        drawSwell(hue);
        drawRipples(dt);
        drawDepth();
      }
    };
  }

  // ---- loop ------------------------------------------------------------------------------
  function drawStill() {
    if (!scene) return;
    ctx.clearRect(0, 0, W, H);
    if (mode === 'blood') T = 3.1; else T = 8;
    scene.draw(0.016);
  }

  function tick(now) {
    raf = 0;
    if (mode === 'classic' || !scene) return;
    if (document.hidden) return;                     // resumed by visibilitychange
    var dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    T += dt; frame++;
    pointer.sx += (pointer.x - pointer.sx) * Math.min(1, dt * 3.2);
    pointer.sy += (pointer.y - pointer.sy) * Math.min(1, dt * 3.2);
    try { scene.draw(dt); } catch (e) { stop(); if (window.console) console.warn('[atmosphere] disabled after error:', e); return; }
    raf = window.requestAnimationFrame(tick);
  }

  function start() {
    if (raf || mode === 'classic') return;
    if (reduceMotion) { drawStill(); return; }
    last = performance.now();
    raf = window.requestAnimationFrame(tick);
  }
  function stop() { if (raf) window.cancelAnimationFrame(raf); raf = 0; }

  // ---- mode switching --------------------------------------------------------------------
  var ctl = null;

  function setMeta(id) {
    var c = THEME_COLOR[id];
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    if (c) { if (!meta.dataset.orig) meta.dataset.orig = meta.getAttribute('content') || ''; meta.setAttribute('content', c); }
    else if (meta.dataset.orig !== undefined) meta.setAttribute('content', meta.dataset.orig);
  }

  function setMode(id, persist) {
    if (!validMode(id)) return;
    stop();
    mode = id;
    root.setAttribute('data-atmosphere', id);
    if (persist !== false) store(false, id);
    setMeta(id);
    fctx.clearRect(0, 0, W, H);
    fcanvas.style.display = id === 'blood' ? 'block' : 'none';
    if (id === 'classic') {
      scene = null;
      ctx.clearRect(0, 0, W, H);
      canvas.style.display = 'none';
    } else {
      scene = id === 'blood' ? createBlood() : createWater();
      canvas.style.display = 'block';
      resize();
      scene.start();
      T = rand(0, 40);
      start();
    }
    if (ctl) ctl.sync();
    try { window.dispatchEvent(new CustomEvent('darkness-atmosphere', { detail: { mode: id } })); } catch (e) { /* old browsers */ }
  }

  // ---- floating control ------------------------------------------------------------------
  function buildControl() {
    var wrap = document.createElement('div');
    wrap.className = 'atmo-ctl';
    wrap.innerHTML =
      '<button type="button" class="atmo-fab" aria-haspopup="true" aria-expanded="false" aria-label="Change atmosphere" title="Atmosphere"><span class="atmo-orb"></span></button>' +
      '<div class="atmo-menu" role="menu" aria-label="Atmosphere" hidden></div>';
    var fab = wrap.querySelector('.atmo-fab');
    var menu = wrap.querySelector('.atmo-menu');
    MODES.forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'atmo-item'; b.setAttribute('role', 'menuitemradio'); b.setAttribute('data-mode', m.id);
      b.innerHTML = '<span class="atmo-sw sw-' + m.id + '" aria-hidden="true"></span><span class="atmo-txt"><b></b><i></i></span>';
      b.querySelector('b').textContent = m.label;
      b.querySelector('i').textContent = m.hint;
      b.addEventListener('click', function () { setMode(m.id); close(); fab.focus(); });
      menu.appendChild(b);
    });
    if (!/\/agent(\.html)?$/.test(location.pathname)) {
      var link = document.createElement('a');
      link.className = 'atmo-link'; link.href = '/agent.html'; link.textContent = 'Open the Agent →';
      menu.appendChild(link);
    }
    function open() { menu.hidden = false; fab.setAttribute('aria-expanded', 'true'); var cur = menu.querySelector('[aria-checked="true"]'); if (cur) cur.focus(); }
    function close() { menu.hidden = true; fab.setAttribute('aria-expanded', 'false'); }
    fab.addEventListener('click', function () { menu.hidden ? open() : close(); });
    document.addEventListener('pointerdown', function (e) { if (!menu.hidden && !wrap.contains(e.target)) close(); });
    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); fab.focus(); return; }
      if (menu.hidden || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      var items = [].slice.call(menu.querySelectorAll('.atmo-item'));
      var i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
      e.preventDefault();
    });
    return {
      el: wrap,
      sync: function () {
        [].forEach.call(menu.querySelectorAll('.atmo-item'), function (b) { b.setAttribute('aria-checked', String(b.getAttribute('data-mode') === mode)); });
        fab.setAttribute('data-mode', mode);
      }
    };
  }

  // ---- boot ------------------------------------------------------------------------------
  function boot() {
    canvas.style.display = 'none';
    fcanvas.style.display = 'none';
    document.body.insertBefore(canvas, document.body.firstChild);
    document.body.appendChild(fcanvas);
    ctl = buildControl();
    document.body.appendChild(ctl.el);

    window.addEventListener('resize', (function () {
      var id = 0;
      return function () { clearTimeout(id); id = setTimeout(resize, 120); };
    })(), { passive: true });
    window.addEventListener('pointermove', function (e) { pointer.x = e.clientX / Math.max(1, W); pointer.y = e.clientY / Math.max(1, H); pointer.active = true; }, { passive: true });
    window.addEventListener('pointerdown', function (e) {
      if (mode === 'water' && scene && scene.ripple && !(ctl && ctl.el.contains(e.target))) scene.ripple(e.clientX, e.clientY);
    }, { passive: true });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) start(); });
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      var onMq = function () { reduceMotion = mq.matches; if (mode !== 'classic') { stop(); start(); } };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
    }

    var fromUrl = null;
    try { fromUrl = new URLSearchParams(location.search).get('atmosphere'); } catch (e) { /* ignore */ }
    var initial = validMode(fromUrl) ? fromUrl : (validMode(store(true)) ? store(true) : 'classic');
    ctl.sync();
    resize();
    setMode(initial, validMode(fromUrl));
  }

  window.DarknessAtmosphere = {
    modes: MODES.map(function (m) { return m.id; }),
    get: function () { return mode; },
    set: function (id) { setMode(id); }
  };

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
