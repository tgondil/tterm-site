/* tterm.sh — typed seascapes, computed live.
   No SVGs: every glyph is a monospace character placed by math each frame.
   - Water is Gerstner-style: surface = sum of slow traveling sine components,
     glyphs get horizontal orbital displacement that decays with depth. Colors
     are baked per cell (no live-depth flicker); glyphs FADE across the moving
     surface instead of popping.
   - Boats are buoyant bodies: spring-damped position + tilt tracking the
     local surface height and slope, so they lag and rock like real hulls.
   - Scroll drives the sea: velocity slides the wave pattern under the scene,
     pumps swell energy (decays over a few seconds), heaves the boats, applies
     torque to the compass needle, and leans the wind.
   Scenes render only while on screen; prefers-reduced-motion gets one
   static frame. */
(() => {
'use strict';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FONTSTR = "bold 13.1px Menlo, 'Courier New', monospace";
const ROWH = 14.6;
const TAU = Math.PI * 2;

const _m = document.createElement('canvas').getContext('2d');
_m.font = FONTSTR;
const CW = _m.measureText('M').width || 7.9;

const PAL = {
  faint:   ['#2c3350', '#293049', '#252b42', '#21273a', '#1d2233'],
  fainter: ['#262c44', '#23283d', '#1f2437', '#1c2131', '#191d2b'],
  seablue: ['#2b3a66', '#273357', '#232e4c', '#1f2941', '#1b2437'],
  accent:  ['#5d7fd4', '#4f6db8', '#42599c', '#394e83', '#2f4270'],
  bright:  ['#7aa2f7', '#6a8fe0', '#5d7fd4', '#4763a8', '#39508c'],
  mid:     ['#3c4462', '#353d58', '#2e354d', '#282e44', '#22283a'],
  boaty:   ['#4a5378', '#454e72', '#404868', '#3a4160', '#343b57'],
  hills:   ['#232941', '#20263b', '#1d2235', '#1a1f30', '#171b2a'],
  moon:    ['#5a6491', '#4f5881', '#454e72', '#3b4363', '#323954'],
  star:    ['#565f89', '#4a5378', '#404868', '#363e5a', '#2d344c'],
};

function prng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- shapes (design space) ----------
const ell = (cx, cy, rx, ry) => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const union = (...fs) => (x, y) => fs.some((f) => f(x, y));
const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
function tri(ax, ay, bx, by, cx, cy) {
  return (x, y) => {
    const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
    const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
    const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
}
const annulus = (cx, cy, r0, r1) => (x, y) => {
  const r = Math.hypot(x - cx, y - cy);
  return r >= r0 && r <= r1;
};

// ---------- typed stencil: fill shapes with word streams ----------
function stencil(rand, W, H, els, mirror) {
  const cols = Math.floor((W - 20) / CW);
  const rows = Math.floor((H - 16) / ROWH);
  const offs = els.map(() => Array.from({ length: rows }, () => Math.floor(rand() * 7)));
  const out = els.map(() => [[], [], [], [], []]);
  const depthOf = (f, px, py) => {
    for (let d = 1; d <= 3; d++) {
      if (!f(px - d * CW, py) || !f(px + d * CW, py) ||
          !f(px, py - d * ROWH * 0.8) || !f(px, py + d * ROWH * 0.8)) return d - 1;
    }
    return 3;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = 10 + c * CW + CW / 2, py = 8 + r * ROWH + ROWH / 2;
      const sx = mirror ? W - px : px;
      for (let e = 0; e < els.length; e++) {
        const el = els[e];
        if (!el.shape(sx, py)) continue;
        const solid = el.solid && el.solid(sx, py);
        const depth = depthOf(el.shape, sx, py);
        const dropP = solid ? 0 :
          el.dropFlat != null ? el.dropFlat : [0.42, 0.15, 0.05, 0.01][depth] * (el.drop ?? 0.5);
        if (rand() < dropP) break;
        let ch = el.word[(c + offs[e][r]) % el.word.length];
        if (ch === ' ') {
          if (!(solid && el.gapFill)) break;
          ch = el.gapFill[r % el.gapFill.length];
        }
        let tone;
        if (solid) tone = rand() < 0.85 ? 0 : 1;
        else if (el.depthTone) tone = el.light + (3 - depth) * 0.95 + (rand() - 0.35) * 1.3;
        else tone = el.light + rand() * (el.tone ?? 2);
        out[e][clamp(Math.round(tone), 0, 4)].push({
          x: 10 + c * CW,
          y: 8 + r * ROWH + ROWH * 0.78 + (rand() - 0.5) * 1.7,
          ch,
        });
        break;
      }
    }
  }
  return out;
}

function drawBuckets(ctx, buckets, inks, alpha) {
  if (alpha != null) ctx.globalAlpha = alpha;
  for (let t = 0; t < 5; t++) {
    const g = buckets[t];
    if (!g.length) continue;
    ctx.fillStyle = inks[t];
    for (let i = 0; i < g.length; i++) ctx.fillText(g[i].ch, g[i].x, g[i].y);
  }
  if (alpha != null) ctx.globalAlpha = 1;
}

// ---------- physics ----------
function makeWaves(comps) {
  const cs = comps.map((c) => ({ ...c, k: TAU / c.L, w: (TAU / c.L) * c.s }));
  return {
    h(x, t, E) {
      let y = 0;
      for (const c of cs) y += c.A * (1 + E) * Math.sin(c.k * x - c.dir * c.w * t + (c.ph || 0));
      return y;
    },
    dx(x, d, t, E) {
      let s = 0;
      for (const c of cs)
        s += c.A * (1 + E) * Math.exp(-c.k * Math.max(d, 0) * 0.8) *
             Math.cos(c.k * x - c.dir * c.w * t + (c.ph || 0));
      return s;
    },
    slope(x, t, E) { return (this.h(x + 24, t, E) - this.h(x - 24, t, E)) / 48; },
  };
}

function makeFloater(k, c) {
  return {
    y: 0, vy: 0, a: 0, va: 0,
    step(dt, ty, ta) {
      this.vy += (k * (ty - this.y) - c * this.vy) * dt;
      this.y += this.vy * dt;
      this.va += (k * (ta - this.a) - c * this.va) * dt;
      this.a += this.va * dt;
    },
  };
}

// Open water typed from a word. Tones are baked from rest depth (stable —
// no shade flicker); the live surface only culls with a smooth alpha fade.
function waterField(rand, W, H, top, word, inks) {
  const cells = [];
  const r0 = Math.max(0, Math.floor((top - 30 - 8) / ROWH));
  const rows = Math.floor((H - 16) / ROWH);
  const cols = Math.floor((W - 20) / CW);
  const span = Math.max(60, H - top);
  for (let r = r0; r < rows; r++) {
    const rowDrop = 0.05 + rand() * 0.16;
    const off = Math.floor(rand() * 7);
    for (let c = 0; c < cols; c++) {
      if (rand() < rowDrop) continue;
      const ch = word[(c + off) % word.length];
      if (ch === ' ') continue;
      const y = 8 + r * ROWH + ROWH * 0.78;
      cells.push({
        x: 10 + c * CW, y, ch,
        tone: clamp(Math.round(0.8 + (Math.max(y - top, 0) / span) * 3 + (rand() - 0.35) * 1.9), 0, 4),
        foam: rand() < 0.14,
      });
    }
  }
  return {
    draw(ctx, t, E, waves, shift) {
      shift = shift || 0;
      const bk = [[], [], [], [], []], soft = [];
      for (const cl of cells) {
        const sx = cl.x + shift;
        const eta = top + waves.h(sx, t, E);
        const d = cl.y - eta;
        const a = clamp((d + ROWH * 0.55) / (ROWH * 1.1), 0, 1); // fade across the surface
        if (a < 0.03) continue;
        const xi = waves.dx(sx, d, t, E);
        const yb = -waves.h(sx, t, E) * Math.exp(-Math.max(d, 0) / 90) * 0.3;
        const g = { x: cl.x + xi, y: cl.y + yb, ch: cl.ch };
        if (a > 0.97) bk[cl.tone].push(g);
        else soft.push({ ...g, tone: cl.tone, a });
        if (cl.foam) {
          // foam crossfades in as the crest rises through the cell — no snap
          const fa = a * clamp(1 - d / ROWH, 0, 1) * 0.85;
          if (fa > 0.03) soft.push({ ...g, tone: -1, a: fa });
        }
      }
      drawBuckets(ctx, bk, inks);
      for (const s of soft) {
        ctx.globalAlpha = s.a;
        ctx.fillStyle = s.tone < 0 ? PAL.bright[2] : inks[s.tone];
        ctx.fillText(s.ch, s.x, s.y);
      }
      ctx.globalAlpha = 1;
    },
  };
}

// A word flowing along a path — wind streaks, marching dots.
function makeStream(rand, x0, x1, pathY, word, inks, gap) {
  const spacing = CW * 1.12, span = x1 - x0;
  const parts = [];
  for (let i = 0; i * spacing < span; i++) {
    const ch = word[i % word.length];
    if (ch === ' ' || rand() < (gap ?? 0.25)) continue;
    parts.push({ u: i * spacing, ch, tone: clamp(Math.round(rand() * 3.2), 0, 4) });
  }
  let ph = rand() * span;
  return {
    advance(dt, speed) { ph = (ph + dt * speed) % span; },
    draw(ctx, alpha, xShift) {
      if (alpha != null) ctx.globalAlpha = alpha;
      const sh = ph + (xShift || 0);
      for (const p of parts) {
        const x = x0 + ((p.u + sh) % span + span) % span;
        ctx.fillStyle = inks[p.tone];
        ctx.fillText(p.ch, x, pathY(x));
      }
      if (alpha != null) ctx.globalAlpha = 1;
    },
  };
}

// A gull: two wings of typed letters, gliding slowly, flapping now and then.
function makeGull(bx, by, phase) {
  return {
    draw(ctx, t, ink) {
      const x = bx + 40 * Math.sin(t * 0.16 + phase) + 14 * Math.sin(t * 0.4 + phase * 2);
      const y = by + 12 * Math.sin(t * 0.24 + phase * 3) + 4 * Math.sin(t * 0.6 + phase);
      const flap = 0.3 + 0.3 * Math.sin(t * 1.5 + phase * 5);
      ctx.fillStyle = ink;
      const L = 'GU', R = 'LL';
      for (let i = 0; i < 2; i++) {
        const r = (i + 0.7) * CW;
        ctx.fillText(L[1 - i], x - r * Math.cos(flap * 0.8), y - r * Math.sin(flap * 0.8) + 4);
        ctx.fillText(R[i], x + r * Math.cos(flap), y - r * Math.sin(flap) + 4);
      }
    },
  };
}

// ---------- scenes ----------
const SCENES = {};

SCENES.hero = { W: 1200, H: 780, init(rand) {
  const W = 1200, WATER = 549;
  const cloudA = union(ell(850, 148, 155, 55), ell(960, 118, 115, 46), ell(745, 118, 95, 42),
    ell(895, 195, 185, 44), ell(760, 185, 125, 40), ell(1035, 172, 95, 38));
  const cloudB = union(ell(255, 132, 115, 33), ell(325, 110, 75, 27), ell(195, 106, 62, 23), ell(285, 162, 135, 27));
  const sail1 = tri(350, 215, 350, 516, 205, 516), sail2 = tri(478, 165, 478, 516, 352, 516);
  const jib = tri(492, 250, 492, 514, 625, 514);
  const rig = union(rect(351, 185, 364, 528), rect(479, 140, 492, 528),
    tri(363, 166, 363, 192, 418, 179), tri(491, 120, 491, 146, 546, 133));
  const hull = (x, y) => {
    if (y < 518 || y > 578) return false;
    const t = (y - 518) / 60;
    return x >= 205 + t * 38 && x <= 655 - t * 34;
  };
  const boatShape = union(sail1, sail2, jib, rig, hull);
  const [boatB, cloudAB, cloudBB] = stencil(rand, W, 780, [
    { shape: boatShape, solid: rig, gapFill: 'BOAT', word: 'BOAT ', inks: PAL.boaty, light: 0, tone: 1.2, drop: 0.12 },
    { shape: cloudA, word: 'CLOUDS ', inks: PAL.faint, depthTone: true, light: 0, drop: 0.9 },
    { shape: cloudB, word: 'CLOUDS ', inks: PAL.fainter, depthTone: true, light: 0.6, drop: 1.2 },
  ], true);
  const waves = makeWaves([
    { A: 6.5, L: 360, s: 13, dir: 1 }, { A: 3.2, L: 160, s: 19, dir: 1, ph: 2 },
    { A: 1.6, L: 84, s: 27, dir: -1, ph: 4 },
  ]);
  const sea = waterField(rand, W, 780, WATER, 'OCEAN ', PAL.seablue);
  const gulls = [makeGull(600, 110, 0), makeGull(530, 178, 2.4), makeGull(1105, 250, 4.8)];
  const wind = [
    makeStream(rand, 0, W, (x) => 285 + 10 * Math.sin(x / 300 + 1), 'WIND ', PAL.faint),
    makeStream(rand, 0, W, (x) => 352 + 12 * Math.sin(x / 260 + 3.8), 'WIND ', PAL.fainter),
  ];
  const boat = makeFloater(7, 4.5);
  const BX = W - 430;
  return { draw(ctx, t, env) {
    // wave phase is tied 1:1 to scroll position — scrub the page, scrub the sea
    const ph = env.sy * 0.5;
    ctx.save(); ctx.translate(20 * Math.sin(t * TAU / 90), env.p * 26); drawBuckets(ctx, cloudAB, PAL.faint); ctx.restore();
    ctx.save(); ctx.translate(-16 * Math.sin(t * TAU / 70 + 1), env.p * 15); drawBuckets(ctx, cloudBB, PAL.fainter); ctx.restore();
    for (const s of wind) { s.advance(env.dt, 12); s.draw(ctx, 0.85, -env.sy * 0.3); }
    for (const g of gulls) g.draw(ctx, t, PAL.mid[1]);
    // buoyancy + a direct kick from each scroll step
    boat.vy -= env.dy * 0.32;
    boat.va += env.dy * 0.0022;
    boat.step(env.dt, waves.h(BX + ph, t, env.E) * 0.55, Math.atan(waves.slope(BX + ph, t, env.E)) * 0.5);
    ctx.save(); ctx.translate(BX, 560 + boat.y); ctx.rotate(boat.a); ctx.translate(-BX, -560);
    drawBuckets(ctx, boatB, PAL.boaty); ctx.restore();
    sea.draw(ctx, t, env.E, waves, ph);
  } };
} };

SCENES.wind = { W: 1600, H: 520, init(rand) {
  const P = [[80, 26, 210, 0.4], [170, 34, 260, 2.1], [260, 22, 180, 4.6], [350, 30, 240, 1.3], [440, 24, 200, 3.4]];
  const inks = [PAL.mid, PAL.faint, PAL.fainter, PAL.faint, PAL.mid];
  const streams = P.map(([cy, a, l, ph], i) =>
    makeStream(rand, 0, 1600, (x) => cy + a * Math.sin(x / l + ph), 'WIND ', inks[i]));
  const gulls = [makeGull(190, 210, 1), makeGull(1420, 150, 3.7), makeGull(800, 90, 5.5)];
  return { draw(ctx, t, env) {
    streams.forEach((s, i) => {
      s.advance(env.dt, 15 * (1 + i * 0.12));
      s.draw(ctx, null, -env.sy * (0.28 + i * 0.05)); // wind rushes with the scroll
    });
    for (const g of gulls) g.draw(ctx, t, PAL.mid[0]);
  } };
} };

SCENES.itself = { W: 1600, H: 760, init(rand) {
  const CX = 1150, CY = 380, B = 56 / TAU;
  function makeArm(rMin, rMax, word, inks, armPh, dir) {
    const parts = [];
    let th = rMin / B, i = 0;
    while (B * th < rMax) {
      const r = B * th;
      th += (CW * 1.05) / Math.hypot(r, B);
      const ch = word[i++ % word.length];
      if (ch !== ' ' && rand() > 0.12)
        parts.push({ th, ch, j: (rand() - 0.4) * 1.6 });
    }
    return {
      step(dt, s) {
        for (const p of parts) {
          p.th -= (dir * s * dt) / Math.max(B * p.th, 30);
          if (B * p.th < rMin) p.th = rMax / B - rand() * 2;
          else if (B * p.th > rMax) p.th = rMin / B + rand() * 2;
        }
      },
      draw(ctx, rot, cx, cy, rMaxDraw) {
        const bk = [[], [], [], [], []];
        for (const p of parts) {
          const r = B * p.th, a = p.th + armPh + rot;
          bk[clamp(Math.round(0.5 + (r / rMaxDraw) * 2.6 + p.j), 0, 4)]
            .push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), ch: p.ch });
        }
        drawBuckets(ctx, bk, inks);
      },
    };
  }
  const arms = [makeArm(46, 350, 'ITSELF ', PAL.mid, 0, 1), makeArm(46, 350, 'ITSELF ', PAL.fainter, Math.PI, 1)];
  const eddy = makeArm(30, 195, 'REBUILD ', PAL.fainter, 0.6, -1);
  const [coreB] = stencil(rand, 1600, 760, [
    { shape: ell(CX, CY, 36, 25), word: 'TTERM ', inks: PAL.accent, light: 0.2, tone: 1.6, drop: 0.4 },
  ]);
  let rot = 0;
  return { draw(ctx, t, env) {
    const flow = 8 * (1 + Math.min(Math.abs(env.v), 2000) / 900);
    rot += env.dt * 0.018;
    // scroll position turns the spiral directly — reversible scrubbing
    const r = rot + env.sy * 0.00055;
    for (const a of arms) { a.step(env.dt, flow); a.draw(ctx, r, CX, CY, 350); }
    eddy.step(env.dt, flow * 0.7); eddy.draw(ctx, -r * 1.3, 260, 430, 195);
    drawBuckets(ctx, coreB, PAL.accent, 0.7 + 0.3 * Math.sin(t * TAU / 7));
    const psi = t * TAU / 24;
    ctx.fillStyle = PAL.bright[1]; ctx.globalAlpha = 0.9;
    ctx.fillText('RELOAD', CX + 255 * Math.cos(psi) - CW * 3, CY + 255 * Math.sin(psi) * 0.72 + 4);
    ctx.globalAlpha = 1;
  } };
} };

SCENES.rowwaves = { W: 1600, H: 520, init(rand) {
  const BANDS = [
    { top: 110, comps: [{ A: 9, L: 200, s: 14, dir: 1 }, { A: 4, L: 92, s: 21, dir: 1, ph: 2 }], inks: PAL.seablue },
    { top: 210, comps: [{ A: 11, L: 240, s: 12, dir: -1 }, { A: 4, L: 104, s: 18, dir: -1, ph: 1 }], inks: PAL.mid },
    { top: 310, comps: [{ A: 8, L: 170, s: 16, dir: 1, ph: 3 }, { A: 3.4, L: 86, s: 23, dir: 1 }], inks: PAL.faint },
    { top: 410, comps: [{ A: 10, L: 220, s: 13, dir: -1, ph: 5 }, { A: 4, L: 98, s: 19, dir: -1 }], inks: PAL.seablue },
  ].map((b) => {
    const waves = makeWaves(b.comps);
    const cells = [];
    const cols = Math.floor(1580 / CW);
    for (let r = Math.floor((b.top - 46) / ROWH); r <= Math.floor((b.top + 46) / ROWH); r++) {
      const off = Math.floor(rand() * 7);
      for (let c = 0; c < cols; c++) {
        if (rand() < 0.16) continue;
        const ch = 'ROW '[(c + off) % 4];
        if (ch === ' ') continue;
        const y = 8 + r * ROWH + ROWH * 0.78;
        cells.push({
          x: 10 + c * CW, y, ch,
          tone: clamp(Math.round(1 + Math.abs(y - b.top) / 12 + (rand() - 0.4) * 1.8), 0, 4),
        });
      }
    }
    return { ...b, waves, cells };
  });
  const boats = [
    { x: 1120, band: 0, f: makeFloater(9, 5) },
    { x: 300, band: 1, f: makeFloater(9, 5) },
  ];
  const fish = [0, 1, 2].map((i) => ({
    x: 200 + rand() * 1200, y: [468, 488, 476][i], v: 9 + rand() * 7, dir: rand() < 0.5 ? -1 : 1,
    ph: rand() * TAU, inks: [PAL.seablue, PAL.mid, PAL.faint][i],
  }));
  return { draw(ctx, t, env) {
    const drift = env.sy * 0.45;
    BANDS.forEach((b, bi) => {
      const sh = drift * (bi % 2 ? -0.7 : 1);
      const bk = [[], [], [], [], []], soft = [];
      for (const cl of b.cells) {
        const eta = b.top + b.waves.h(cl.x + sh, t, env.E);
        const d = cl.y - eta;
        const ad = Math.abs(d);
        if (ad > 30) continue;
        const a = clamp((30 - ad) / 12, 0, 1); // soft band edges
        const xi = b.waves.dx(cl.x + sh, Math.max(d, 0), t, env.E);
        const g = { x: cl.x + xi, y: cl.y, ch: cl.ch };
        if (a > 0.97) bk[cl.tone].push(g);
        else soft.push({ ...g, tone: cl.tone, a });
      }
      drawBuckets(ctx, bk, b.inks);
      for (const s of soft) {
        ctx.globalAlpha = s.a; ctx.fillStyle = b.inks[s.tone];
        ctx.fillText(s.ch, s.x, s.y);
      }
      ctx.globalAlpha = 1;
    });
    for (const bt of boats) {
      const b = BANDS[bt.band];
      const sh = drift * (bt.band % 2 ? -0.7 : 1);
      bt.f.vy -= env.dy * 0.24;
      bt.f.va += env.dy * 0.0018;
      bt.f.step(env.dt, b.waves.h(bt.x + sh, t, env.E), Math.atan(b.waves.slope(bt.x + sh, t, env.E)) * 0.8);
      ctx.save();
      ctx.translate(bt.x, b.top - 12 + bt.f.y); ctx.rotate(bt.f.a);
      ctx.fillStyle = PAL.boaty[0];
      ctx.fillText('BOAT', -CW * 2, -ROWH * 0.4);
      ctx.fillStyle = PAL.boaty[1];
      ctx.fillText('BOAT', -CW * 2, ROWH * 0.55);
      ctx.restore();
    }
    for (const f of fish) {
      f.x += f.dir * f.v * env.dt * (1 + env.E * 0.6);
      if (f.x > 1640) f.x = -40; if (f.x < -40) f.x = 1640;
      ctx.globalAlpha = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.7 + f.ph));
      ctx.fillStyle = f.inks[1];
      ctx.fillText('FISH', f.x - CW * 2, f.y + 4 * Math.sin(t * 0.9 + f.ph));
      ctx.globalAlpha = 1;
    }
  } };
} };

SCENES.compass = { W: 1600, H: 660, init(rand) {
  const CX = 1120, CY = 330;
  const [ringB, hubB] = stencil(rand, 1600, 660, [
    { shape: annulus(CX, CY, 256, 298), word: 'COMPASS ', inks: PAL.mid, light: 0.5, tone: 2.4, drop: 0.7 },
    { shape: ell(CX, CY, 24, 17), word: 'COMPASS ', inks: PAL.mid, light: 0.4, tone: 1.6, drop: 0.4 },
  ]);
  const needle = [];
  {
    const nN = tri(0, -226, -23, -2, 23, -2), nS = tri(0, 226, -20, 2, 20, 2);
    const cols = Math.floor(120 / CW), rows = Math.floor(480 / ROWH);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const dx = -60 + c * CW, dy = -240 + r * ROWH;
      const north = nN(dx, dy);
      if (!north && !nS(dx, dy)) continue;
      if (rand() < 0.24) continue;
      const word = north ? 'NORTH ' : 'SOUTH ';
      const ch = word[(c + r) % 6];
      if (ch === ' ') continue;
      needle.push({ dx, dy, ch, north, tone: clamp(Math.round((north ? 0.6 : 1.0) + rand() * 2), 0, 4) });
    }
  }
  const courseY = (x) => 470 - 0.22 * x + 26 * Math.sin(x / 130);
  const dots = makeStream(rand, 40, 810, courseY, '. ', PAL.faint, 0.1);
  let th = 0, vth = 0, uBoat = 0;
  return { draw(ctx, t, env) {
    drawBuckets(ctx, ringB, PAL.mid, 0.82 + 0.18 * Math.sin(t * 0.35));
    drawBuckets(ctx, hubB, PAL.mid);
    ctx.fillStyle = PAL.accent[3];
    ctx.font = "bold 24px Menlo, 'Courier New', monospace";
    ctx.fillText('N', CX - 8, CY - 306); ctx.fillText('S', CX - 8, CY + 322);
    ctx.fillText('E', CX + 304, CY + 8); ctx.fillText('W', CX - 322, CY + 8);
    ctx.font = FONTSTR;
    const bias = 0.22 * Math.sin(t * 0.2) + 0.07 * Math.sin(t * 0.9);
    vth += env.dy * 0.004; // each scroll step is a direct torque impulse
    vth += (-14 * (th - bias) - 5 * vth) * env.dt;
    th += vth * env.dt;
    const cs = Math.cos(th), sn = Math.sin(th);
    const bkN = [[], [], [], [], []], bkS = [[], [], [], [], []];
    for (const g of needle) {
      (g.north ? bkN : bkS)[g.tone].push({ x: CX + g.dx * cs - g.dy * sn, y: CY + g.dx * sn + g.dy * cs, ch: g.ch });
    }
    drawBuckets(ctx, bkN, PAL.accent);
    drawBuckets(ctx, bkS, PAL.mid);
    dots.advance(env.dt, 7 + Math.min(Math.abs(env.v), 1500) / 130);
    dots.draw(ctx, 0.8);
    uBoat = (uBoat + env.dt * (0.011 + Math.min(Math.abs(env.v), 1500) * 0.00001)) % 1;
    const u = uBoat < 0.5 ? uBoat * 2 : 2 - uBoat * 2;
    const bx = 40 + u * 700;
    ctx.fillStyle = PAL.boaty[0];
    ctx.fillText('BOAT', bx - CW * 2, courseY(bx) - 10 + 2 * Math.sin(t * 0.9));
  } };
} };

SCENES.lighthouse = { W: 1600, H: 780, init(rand) {
  const LX = 206, LY = 196;
  const towerShape = (x, y) => y >= 224 && y <= 648 && Math.abs(x - 206) <= 25 + ((y - 224) / 424) * 21;
  const rocksShape = union(ell(206, 678, 132, 36), ell(120, 700, 96, 30), ell(300, 696, 88, 26));
  const [towerB, lampB, rocksB] = stencil(rand, 1600, 780, [
    { shape: towerShape, word: 'LIGHTHOUSE ', inks: PAL.mid, light: 0.3, tone: 2, drop: 0.35 },
    { shape: ell(LX, LY, 32, 24), word: 'LIGHT ', inks: PAL.accent, light: 0.2, tone: 1.6, drop: 0.3 },
    { shape: rocksShape, word: 'ROCKS ', inks: PAL.fainter, light: 0.8, tone: 2.2, drop: 0.8 },
  ]);
  const rays = [];
  for (let i = 0; i < 144; i++) {
    const a = (i / 144) * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const glyphs = [];
    for (let r = 64; r < 1700; r += CW * 1.4 + rand() * 4) {
      const x = LX + r * ca, y = LY + r * sa;
      if (x < -10 || x > 1610 || y < -10 || y > 790) break;
      if (towerShape(x, y) || rocksShape(x, y)) continue;
      if (rand() < 0.3) continue;
      glyphs.push({ x, y, ch: 'LIGHT'[Math.floor(r / CW) % 5], r, ph: rand() * TAU });
    }
    rays.push({ a, glyphs });
  }
  const waves = makeWaves([{ A: 5, L: 210, s: 12, dir: 1 }, { A: 2.4, L: 98, s: 18, dir: 1, ph: 2 }]);
  const sea = waterField(rand, 1600, 780, 716, 'SEA ', PAL.seablue);
  const boat = makeFloater(9, 5);
  const BX = 1180, BY = 700;
  const angDist = (a, b) => { let d = Math.abs((a - b) % TAU); return Math.min(d, TAU - d); };
  return { draw(ctx, t, env) {
    const drift = env.sy * 0.4;
    drawBuckets(ctx, towerB, PAL.mid);
    drawBuckets(ctx, lampB, PAL.accent, 0.75 + 0.25 * Math.sin(t * TAU / 6));
    drawBuckets(ctx, rocksB, PAL.fainter);
    sea.draw(ctx, t, env.E, waves, drift);
    boat.vy -= env.dy * 0.24;
    boat.step(env.dt, waves.h(BX + drift, t, env.E), Math.atan(waves.slope(BX + drift, t, env.E)) * 0.8);
    const bth = (t * TAU) / 17 + env.sy * 0.0009; // scrolling nudges the sweep

    const bAng = Math.atan2(BY - LY, BX - LX);
    const bI = Math.max(Math.exp(-((angDist(bAng, bth) / 0.14) ** 2)),
      0.55 * Math.exp(-((angDist(bAng, bth + Math.PI) / 0.14) ** 2)));
    ctx.save();
    ctx.translate(BX, BY + boat.y); ctx.rotate(boat.a);
    ctx.fillStyle = bI > 0.3 ? PAL.bright[1] : PAL.boaty[0];
    ctx.fillText('BOAT', -CW * 2, -ROWH * 0.35);
    ctx.fillStyle = bI > 0.3 ? PAL.bright[2] : PAL.boaty[1];
    ctx.fillText('BOAT', -CW * 2, ROWH * 0.6);
    ctx.restore();
    ctx.fillStyle = PAL.accent[1];
    for (const ray of rays) {
      const I = Math.max(Math.exp(-((angDist(ray.a, bth) / 0.11) ** 2)),
        0.55 * Math.exp(-((angDist(ray.a, bth + Math.PI) / 0.11) ** 2)));
      if (I < 0.05) continue;
      for (const g of ray.glyphs) {
        ctx.globalAlpha = I * (1 - (g.r / 1700) * 0.5) * (0.88 + 0.12 * Math.sin(t * 1.1 + g.ph));
        ctx.fillText(g.ch, g.x, g.y);
      }
    }
    ctx.globalAlpha = 1;
  } };
} };

SCENES.closing = { W: 1600, H: 950, init(rand) {
  const WATER = 700;
  const spots = [];
  for (let i = 0; i < 46; i++) {
    const zone = rand(), r = 5.5 + rand() * 8;
    if (zone < 0.4) spots.push({ x: 30 + rand() * 390, y: 90 + rand() * 500, r });
    else if (zone < 0.78) spots.push({ x: 1180 + rand() * 380, y: 90 + rand() * 500, r });
    else spots.push({ x: 30 + rand() * 1540, y: 55 + rand() * 110, r });
  }
  const starsShape = (x, y) => spots.some((s) => (x - s.x) ** 2 + (y - s.y) ** 2 <= s.r * s.r);
  const ridge = (x) => 632 + 26 * Math.sin(x / 170) + 14 * Math.sin(x / 61 + 1);
  const [moonB, haloB, polB, starB, hillB] = stencil(rand, 1600, 950, [
    { shape: ell(1220, 300, 104, 104), word: 'MOON ', inks: PAL.moon, light: 0.3, tone: 1.8, drop: 0.8 },
    { shape: annulus(1220, 300, 112, 148), word: 'MOON ', inks: PAL.mid, light: 1.6, tone: 2, drop: 2.2 },
    { shape: ell(320, 140, 13, 13), word: 'STAR ', inks: PAL.bright, light: 0, tone: 1.4, drop: 0.2 },
    { shape: starsShape, word: 'STARS ', inks: PAL.star, light: 1, tone: 1.8, drop: 0.3 },
    { shape: (x, y) => y > ridge(x) && y <= WATER + 10, word: 'HILLS ', inks: PAL.hills, light: 0.6, tone: 1.8, drop: 1 },
  ]);
  const starGroups = spots.map(() => ({ ph: rand() * TAU, w: 0.35 + rand() * 0.5, b: [[], [], [], [], []] }));
  starB.forEach((bucket, tone) => {
    for (const g of bucket) {
      let best = 0, bd = 1e9;
      for (let i = 0; i < spots.length; i++) {
        const d = (g.x - spots[i].x) ** 2 + (g.y - spots[i].y) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      starGroups[best].b[tone].push(g);
    }
  });
  function swirlGlyphs(cx, cy, rMax, gap, band, word) {
    const out = [];
    const cols = Math.floor((rMax * 2) / CW), rows = Math.floor((rMax * 2) / ROWH);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = cx - rMax + c * CW, y = cy - rMax + r * ROWH;
      const rr = Math.hypot(x - cx, y - cy);
      if (rr > rMax || rr < 16) continue;
      let d = (rr - (Math.atan2(y - cy, x - cx) / TAU) * gap) % gap;
      if (d < 0) d += gap;
      if (d >= band || rand() < 0.3) continue;
      const ch = word[(c + r) % word.length];
      if (ch === ' ') continue;
      out.push({ r: rr, a: Math.atan2(y - cy, x - cx), ch, tone: clamp(Math.round(1.3 + rand() * 2), 0, 4) });
    }
    return out;
  }
  const swA = swirlGlyphs(640, 310, 255, 48, 12, 'NIGHT ');
  const swB = swirlGlyphs(200, 465, 130, 44, 11, 'NIGHT ');
  const glint = [];
  for (let r = Math.floor(WATER / ROWH); r < Math.floor(934 / ROWH); r++) {
    const y = 8 + r * ROWH + ROWH * 0.78;
    const hw = 12 + 20 * (0.5 + 0.5 * Math.sin(y / 23 + 1.3));
    for (let c = 0; c < Math.floor(1580 / CW); c++) {
      const x = 10 + c * CW;
      if (Math.abs(x - 1220) > hw || rand() < 0.35) continue;
      glint.push({ x, y, ch: 'MOON '[(c + r) % 5], ph: rand() * TAU, w: 0.5 + rand() * 0.7 });
    }
  }
  const waves = makeWaves([
    { A: 5, L: 320, s: 10, dir: 1 }, { A: 2.6, L: 140, s: 15, dir: -1, ph: 2.4 },
    { A: 1.4, L: 74, s: 21, dir: 1, ph: 1 },
  ]);
  const sea = waterField(rand, 1600, 950, WATER, 'OCEAN ', PAL.seablue);
  const rowboatShape = (x, y) => {
    if (y < 772 || y > 816) return false;
    return Math.abs(x - 400) <= 95 - ((y - 772) / 44) * 40;
  };
  const [rowB] = stencil(rand, 1600, 950, [
    { shape: rowboatShape, word: 'BOAT ', inks: PAL.boaty, light: 0, tone: 1.2, drop: 0.1 },
  ]);
  const boat = makeFloater(7, 4.5);
  let wish = null, nextWish = 6 + rand() * 8;
  return { draw(ctx, t, env) {
    const drift = env.sy * 0.4;
    for (const sg of starGroups) drawBuckets(ctx, sg.b, PAL.star,
      0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * sg.w + sg.ph)));
    drawBuckets(ctx, polB, PAL.bright, 0.7 + 0.3 * Math.sin(t * 0.5));
    drawBuckets(ctx, moonB, PAL.moon);
    drawBuckets(ctx, haloB, PAL.mid, 0.65 + 0.35 * Math.sin(t * TAU / 16));
    drawBuckets(ctx, hillB, PAL.hills);
    const drawSwirl = (glyphs, cx, cy, rot, inks) => {
      const bk = [[], [], [], [], []];
      for (const g of glyphs) {
        const a = g.a + rot;
        bk[g.tone].push({ x: cx + g.r * Math.cos(a), y: cy + g.r * Math.sin(a), ch: g.ch });
      }
      drawBuckets(ctx, bk, inks);
    };
    drawSwirl(swA, 640, 310, t * TAU / 260 + env.sy * 0.00035, PAL.faint);
    drawSwirl(swB, 200, 465, -t * TAU / 190 - env.sy * 0.0005, PAL.fainter);
    sea.draw(ctx, t, env.E, waves, drift);
    for (const g of glint) {
      ctx.globalAlpha = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(t * g.w + g.ph));
      ctx.fillStyle = PAL.bright[clamp(Math.round(1 + (g.y - WATER) / 90), 1, 4)];
      ctx.fillText(g.ch, g.x + waves.dx(g.x + drift, g.y - WATER, t, env.E) * 0.6, g.y);
    }
    ctx.globalAlpha = 1;
    boat.vy -= env.dy * 0.26;
    boat.va += env.dy * 0.002;
    boat.step(env.dt, waves.h(400 + drift, t, env.E) * 0.8, Math.atan(waves.slope(400 + drift, t, env.E)) * 0.7);
    ctx.save(); ctx.translate(400, 794 + boat.y); ctx.rotate(boat.a); ctx.translate(-400, -794);
    drawBuckets(ctx, rowB, PAL.boaty); ctx.restore();
    nextWish -= env.dt;
    if (!wish && nextWish <= 0) {
      wish = { x: 80 + Math.random() * 500, y: 80 + Math.random() * 160, vx: 130 + Math.random() * 60, vy: 22 + Math.random() * 18, life: 2.4 };
    }
    if (wish) {
      wish.life -= env.dt;
      wish.x += wish.vx * env.dt; wish.y += wish.vy * env.dt; wish.vy += 7 * env.dt;
      const fade = clamp(wish.life / 2.4, 0, 1) * clamp((2.4 - wish.life) * 3, 0, 1);
      for (let k = 0; k < 4; k++) {
        ctx.globalAlpha = fade * (1 - k * 0.24);
        ctx.fillStyle = k ? PAL.accent[Math.min(k, 4)] : PAL.bright[0];
        ctx.fillText('WISH', wish.x - k * 24 - CW * 2, wish.y - k * 4);
      }
      ctx.globalAlpha = 1;
      if (wish.life <= 0) { wish = null; nextWish = 9 + Math.random() * 13; }
    }
  } };
} };

// ---------- runtime ----------
const scenes = [];
for (const canvas of document.querySelectorAll('canvas[data-art]')) {
  const def = SCENES[canvas.dataset.art];
  if (!def) continue;
  scenes.push({
    canvas, def, W: def.W, H: def.H,
    state: def.init(prng(20260707 + canvas.dataset.art.length * 977)),
    ctx: canvas.getContext('2d'),
    active: false, sized: false,
  });
}

function size(s) {
  const w = s.canvas.clientWidth;
  if (w < 10) { s.sized = false; return; }
  const dpr = clamp(devicePixelRatio || 1, 1, 2);
  const bw = Math.min(Math.round(w * dpr), 3200);
  const bh = Math.round(bw * (s.H / s.W));
  if (s.canvas.width !== bw || s.canvas.height !== bh) { s.canvas.width = bw; s.canvas.height = bh; }
  s.sized = true;
}
const ro = new ResizeObserver((entries) => {
  for (const e of entries) {
    const s = scenes.find((sc) => sc.canvas === e.target);
    if (s) { size(s); if (REDUCED && s.sized) renderScene(s, 8, { dt: 0.016, v: 0, E: 0, p: 0 }); }
  }
});
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const s = scenes.find((sc) => sc.canvas === e.target);
    if (s) s.active = e.isIntersecting;
  }
}, { rootMargin: '12%' });
for (const s of scenes) { ro.observe(s.canvas); io.observe(s.canvas); }

function renderScene(s, t, env) {
  const { ctx, canvas } = s;
  ctx.setTransform(canvas.width / s.W, 0, 0, canvas.height / s.H, 0, 0);
  ctx.clearRect(0, 0, s.W, s.H);
  ctx.font = FONTSTR;
  s.state.draw(ctx, t, env);
}

if (!REDUCED) {
  let lastT = 0, lastY = scrollY, ssy = scrollY, vel = 0, E = 0;
  const loop = (ts) => {
    const t = ts / 1000;
    const dt = clamp(t - lastT, 0.001, 0.05);
    lastT = t;
    const rawDy = scrollY - lastY;
    lastY = scrollY;
    ssy += (scrollY - ssy) * Math.min(1, dt * 14); // ~70ms follow: 1:1 feel, no wheel-step harshness
    const dy = clamp(rawDy, -240, 240); // per-frame impulse (anchor jumps capped)
    vel += (rawDy / dt - vel) * Math.min(1, dt * 5);
    E = Math.min(1.25, E + Math.abs(rawDy) * 0.003) * Math.exp(-dt * 0.7); // swell energy
    for (const s of scenes) {
      if (!s.active) continue;
      if (!s.sized) { size(s); if (!s.sized) continue; }
      const r = s.canvas.getBoundingClientRect();
      const p = (innerHeight / 2 - (r.top + r.height / 2)) / innerHeight;
      renderScene(s, t, { dt, v: vel, E, p, sy: ssy, dy });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
} else {
  for (const s of scenes) { size(s); if (s.sized) renderScene(s, 8, { dt: 0.016, v: 0, E: 0, p: 0, sy: 0, dy: 0 }); }
}
})();
