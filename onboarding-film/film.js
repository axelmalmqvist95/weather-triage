/* Välkomstfilm, Nanostone AB.
 * Hela filmen är en ren funktion av tiden: window.renderAt(t) ritar bildrutan för t sekunder.
 * Inga CSS-animationer, inga timers, ingen slump utom seedad PRNG. Allt ritas på en canvas 1080x1920.
 *
 * API (anropas av rendera.js):
 *   await window.init(person)   person = färdigformaterade texter från rendera.js
 *   window.duration             filmens längd i sekunder
 *   await window.prepare(t)     laddar det som behövs för t (bildrutor ur hälsning och montage)
 *   window.renderAt(t)          ritar bildrutan
 *   window.timeline             scenernas start/längd (för loggning och kontaktark)
 */
(() => {
'use strict';
const W = 1080, H = 1920;
const cv = document.getElementById('c');
const ctx = cv.getContext('2d', { alpha: false });

// ------------------------------------------------------------ palett och form
const C = {
  n0: '#06111b', n1: '#0a1b2a', n2: '#0f263a', n3: '#14314a', n4: '#1b3f5d', n5: '#24506f',
  red: '#e52f19', vb: '#548c91', vl: '#86aeb0', white: '#ffffff', t2: '#d2dee3', t3: '#9fb8c0',
};
const BS = '"BSD"', OS = '"OS"';
const DIR = [0.5, Math.sqrt(3) / 2];          // varumärkets diagonal \ (30° från lodrätt), nedåt-höger
const NRM = [Math.sqrt(3) / 2, -0.5];         // normal till diagonalen (uppåt-höger)
const NMIN = -H * 0.5, NMAX = W * NRM[0];      // n·x över bildytan: [-960, 935]
const SAFE = { x0: 108, x1: 972, y0: 192, y1: 1728 };
// Bomärket: röd kvadrat som två diagonala luckor delar i TRE delar (aldrig speglat).
// Koordinater på 208-rutnätet, anpassade pixel för pixel mot den officiella logo_vit.png
// (högsta avvikelse 0,27 i kantutjämningen). I logotypfilen (209 px hög) ligger rutan 0,75 px ned.
const MARK = {
  triL: [[0, 44.75], [0, 208], [93.2, 208]],
  stripe: [[-0.25, 0], [89.75, 0], [208, 207.6], [208, 208], [118.25, 208]],
  triR: [[115, 0], [208, 0], [208, 163.3]],
};
const MARK_DY = 0.75; // rutans förskjutning i logotypfilens 209-höjd

// ------------------------------------------------------------ matte
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, a, d) => clamp((t - a) / d);
const expoOut = x => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
const quintOut = x => 1 - Math.pow(1 - x, 5);
const cubicInOut = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const quartInOut = x => x < .5 ? 8 * x ** 4 : 1 - Math.pow(-2 * x + 2, 4) / 2;
const sineInOut = x => -(Math.cos(Math.PI * x) - 1) / 2;
// mjuk ”bezier”-in för rörelser som ska kännas tunga: cubic-bezier(.7,0,.2,1) approx
const heavy = x => quartInOut(x) * 0.6 + cubicInOut(x) * 0.4;
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ------------------------------------------------------------ hjälpare för ritning
function offscreen(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function dither(c, amt = 2.2, seed = 7) {
  const g = c.getContext('2d'); const im = g.getImageData(0, 0, c.width, c.height); const d = im.data; const r = mulberry32(seed);
  for (let i = 0; i < d.length; i += 4) { const n = (r() + r() - 1) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(im, 0, 0); return c;
}
function bandPoly(g, lo, hi) { // område lo < n·x < hi, som polygon
  const L = 4000;
  g.beginPath();
  g.moveTo(NRM[0] * lo - DIR[0] * L, NRM[1] * lo - DIR[1] * L);
  g.lineTo(NRM[0] * lo + DIR[0] * L, NRM[1] * lo + DIR[1] * L);
  g.lineTo(NRM[0] * hi + DIR[0] * L, NRM[1] * hi + DIR[1] * L);
  g.lineTo(NRM[0] * hi - DIR[0] * L, NRM[1] * hi - DIR[1] * L);
  g.closePath();
}
function lineAt(g, s) { const L = 4000; g.beginPath(); g.moveTo(NRM[0] * s - DIR[0] * L, NRM[1] * s - DIR[1] * L); g.lineTo(NRM[0] * s + DIR[0] * L, NRM[1] * s + DIR[1] * L); }
function poly(g, pts, x, y, k) { g.beginPath(); pts.forEach(([a, b], i) => i ? g.lineTo(x + a * k, y + b * k) : g.moveTo(x + a * k, y + b * k)); g.closePath(); }
function setFont(w, size, fam, track = 0) { ctx.font = `${w} ${size}px ${fam}`; ctx.letterSpacing = `${track}px`; }
function textW(s) { return ctx.measureText(s).width; }
function fitSize(s, w, fam, maxW, maxSize, trackEm = 0) {
  setFont(w, 100, fam, trackEm * 100); const m = textW(s); return Math.min(maxSize, Math.floor(100 * maxW / m));
}
function blurF(b) { return b > 0.25 ? `blur(${b.toFixed(2)}px)` : 'none'; }

/* Bokstav för bokstav: stiger upp ur en osynlig springa, skärps från oskärpa.
 * opt: t, t0, stagger, dur, rise, blur, color(i), mask(bool) */
function letters(s, x, y, size, w, fam, track, o) {
  setFont(w, size, fam, track);
  const chars = [...s]; let acc = '';
  const xs = chars.map(ch => { const v = textW(acc); acc += ch; return v; });
  ctx.save();
  if (o.mask) { ctx.beginPath(); ctx.rect(x - size, y - size * 1.05, W + 2 * size, size * 1.32); ctx.clip(); }
  chars.forEach((ch, i) => {
    const p = prog(o.t, o.t0 + i * o.stagger, o.dur); if (p <= 0) return;
    const e = expoOut(p);
    ctx.globalAlpha = (o.alpha ?? 1) * clamp(p * 2.2);
    ctx.filter = blurF((1 - e) * (o.blur ?? 10));
    ctx.fillStyle = o.color ? o.color(i, ch) : C.white;
    ctx.fillText(ch, x + xs[i] + (o.dx ?? 0) * (1 - e), y + (o.rise ?? size * 0.9) * (1 - e));
  });
  ctx.restore(); ctx.filter = 'none'; ctx.globalAlpha = 1;
  return acc ? xs[xs.length - 1] + textW(chars[chars.length - 1]) : 0;
}
/* Ord för ord (brödtext). */
function words(s, x, y, size, w, fam, track, o) {
  setFont(w, size, fam, track);
  const ws = s.split(' '); let cx = x; const sp = textW(' ');
  ctx.save();
  ws.forEach((wd, i) => {
    const p = prog(o.t, o.t0 + i * o.stagger, o.dur); const ww = textW(wd);
    if (p > 0) {
      const e = expoOut(p);
      ctx.globalAlpha = (o.alpha ?? 1) * clamp(p * 1.8);
      ctx.filter = blurF((1 - e) * (o.blur ?? 8));
      ctx.fillStyle = o.color || C.white;
      ctx.fillText(wd, cx, y + (o.rise ?? 26) * (1 - e));
    }
    cx += ww + sp;
  });
  ctx.restore(); ctx.filter = 'none'; ctx.globalAlpha = 1;
}
function wrap(s, maxW) { // radbrytning med aktuellt typsnitt
  const out = []; let line = '';
  for (const wd of s.split(' ')) { const tryL = line ? line + ' ' + wd : wd; if (textW(tryL) > maxW && line) { out.push(line); line = wd; } else line = tryL; }
  if (line) out.push(line); return out;
}
function kicker(s, x, y, t, t0, color = C.vl, size = 28, align = 'left') {
  setFont(600, size, OS, size * 0.28);
  const ww = textW(s);
  const p = expoOut(prog(t, t0, 0.9));
  ctx.save(); ctx.globalAlpha = clamp(prog(t, t0, 0.5));
  ctx.beginPath(); const x0 = align === 'left' ? x : x - ww; ctx.rect(x0 - 4, y - size * 1.2, (ww + 8) * p + 1, size * 1.6); ctx.clip();
  ctx.fillStyle = color; ctx.fillText(s, x0, y);
  ctx.restore(); ctx.globalAlpha = 1;
}

// ------------------------------------------------------------ resurser
const R = { img: {}, karta: null, meta: null, pts: null, clip: {} };
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => i.decode().then(() => res(i), () => res(i)); i.onerror = () => rej(new Error('Kunde inte ladda ' + src)); i.src = src; }); }

let BG, VIG, GRAIN = [], GLOW, CORE, MARKC;
function buildStatic() {
  // Bakgrund: djup marin med mjukt ljus uppe, ditherad mot banding
  BG = offscreen(W, H); let g = BG.getContext('2d');
  g.fillStyle = C.n2; g.fillRect(0, 0, W, H);
  let gr = g.createRadialGradient(W * 0.42, H * 0.36, 0, W * 0.42, H * 0.36, H * 0.75);
  gr.addColorStop(0, 'rgba(36,80,111,0.55)'); gr.addColorStop(0.55, 'rgba(23,56,82,0.25)'); gr.addColorStop(1, 'rgba(6,17,27,0)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(6,17,27,0)'); gr.addColorStop(1, 'rgba(6,17,27,0.55)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  dither(BG, 2.4, 11);
  // Vinjett
  VIG = offscreen(W, H); g = VIG.getContext('2d');
  gr = g.createRadialGradient(W / 2, H * 0.48, H * 0.30, W / 2, H * 0.48, H * 0.78);
  gr.addColorStop(0, 'rgba(3,10,16,0)'); gr.addColorStop(1, 'rgba(3,10,16,0.62)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  dither(VIG, 1.5, 12);
  // Filmkorn: 8 seedade rutor i halv upplösning (mjukare korn), väljs per bildruta
  const r = mulberry32(2027);
  for (let k = 0; k < 8; k++) {
    const c = offscreen(W / 2, H / 2); const gg = c.getContext('2d'); const im = gg.createImageData(c.width, c.height); const d = im.data;
    for (let i = 0; i < d.length; i += 4) { const v = 128 + (r() + r() + r() - 1.5) * 120; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    gg.putImageData(im, 0, 0); GRAIN.push(c);
  }
  // Ljuspunkter: glöd och kärna
  GLOW = offscreen(64, 64); g = GLOW.getContext('2d');
  gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(160,205,208,0.9)'); gr.addColorStop(0.18, 'rgba(134,174,176,0.45)'); gr.addColorStop(0.5, 'rgba(84,140,145,0.12)'); gr.addColorStop(1, 'rgba(84,140,145,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  CORE = offscreen(16, 16); g = CORE.getContext('2d');
  gr = g.createRadialGradient(8, 8, 0, 8, 8, 8);
  gr.addColorStop(0, 'rgba(240,250,250,1)'); gr.addColorStop(0.45, 'rgba(200,230,232,0.9)'); gr.addColorStop(1, 'rgba(160,205,208,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 16, 16);
}

// ------------------------------------------------------------ gemensamma lager
function background(t, drift = 0) {
  ctx.drawImage(BG, 0, 0);
  // Två svaga ”spöklinjer” i varumärkets vinkel som glider långsamt: ger djup utan mönster
  const s = -380 + t * 14 + drift;
  ctx.save(); ctx.globalAlpha = 0.045; ctx.fillStyle = '#9cc3cc';
  bandPoly(ctx, s, s + 210); ctx.fill();
  ctx.globalAlpha = 0.03; bandPoly(ctx, s + 300, s + 360); ctx.fill();
  ctx.restore();
}
function finish(t) {
  ctx.drawImage(VIG, 0, 0);
  const f = Math.floor(Math.round(t * 30) / 2);
  const r = mulberry32(f * 7919 + 13);
  const tile = GRAIN[f % 8], ox = Math.floor(r() * 64), oy = Math.floor(r() * 64);
  ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.075;
  ctx.drawImage(tile, -ox, -oy, W + 128, H + 128);
  ctx.restore();
}

// ------------------------------------------------------------ bomärke och logga
/* Logotypens bomärke. S = logotypens höjd (motsvarar 209 px i logotypfilen), x/y = logotypens övre vänstra hörn.
 * p = [vänster triangel, mittband, höger triangel]: varje del glider in längs sitt eget band (\-diagonalen)
 * inne i kvadraten, så delarna aldrig överlappar. Luckorna ritas inte: där syns bakgrunden, precis som i logo_vit.png. */
function drawMark(x, y, S, p = [1, 1, 1], alpha = 1) {
  const k = S / 209, bx = x, by = y + MARK_DY * k, bs = 208 * k;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.rect(bx, by, bs, bs); ctx.clip();
  ctx.fillStyle = C.red;
  const L = 330 * k;
  const parts = [[MARK.triL, 1], [MARK.stripe, -1], [MARK.triR, 1]]; // +1 underifrån, -1 uppifrån
  parts.forEach(([pts, dir], i) => {
    if (p[i] <= 0) return; const a = (1 - expoOut(p[i])) * L * dir;
    poly(ctx, pts, bx + DIR[0] * a, by + DIR[1] * a, k); ctx.fill();
  });
  ctx.restore();
}
function drawLockup(cx, cy, S, t, t0, opts = {}) {
  // Mark + ordbild i officiella proportioner (ordbilden börjar 292/209 av markhöjden)
  const om = R.meta.ordbild; const k = S / om.h;
  const total = (om.x0 + om.w) * k; const x = cx - total / 2, y = cy - S / 2;
  drawMark(x, y, S, opts.p || [1, 1, 1]);
  const p = prog(t, t0, 0.95); if (p <= 0) return;
  const e = expoOut(p);
  const wx = x + om.x0 * k, ww = om.w * k;
  ctx.save();
  // avslöjas bakom en diagonal kant i varumärkets vinkel
  const edge = lerp(-0.2, 1.25, e);
  ctx.beginPath(); ctx.moveTo(wx - 40, y - 10); ctx.lineTo(wx + ww * edge + S * 0.58, y - 10); ctx.lineTo(wx + ww * edge, y + S + 10); ctx.lineTo(wx - 40, y + S + 10); ctx.closePath(); ctx.clip();
  ctx.globalAlpha = clamp(p * 1.6);
  ctx.filter = blurF((1 - e) * 6);
  ctx.drawImage(R.img.ordbild, wx - 26 * (1 - e), y, ww, S);
  ctx.restore(); ctx.filter = 'none';
}


// ------------------------------------------------------------ övergång
/* Diagonal kant i varumärkets vinkel som avslöjar nästa scen bakom sig. Båda scenerna syns hela tiden
 * (ingen tom ridå): den gamla skjuts undan, den nya dras in, en röd kant och en mjuk skugga markerar skarven. */
function wipe(p, drawOld, drawNew) {
  const e = quartInOut(clamp(p));
  const s = lerp(NMIN - 30, NMAX + 30, e);
  ctx.save(); ctx.translate(NRM[0] * e * 90, NRM[1] * e * 90); drawOld(); ctx.restore();
  ctx.save(); bandPoly(ctx, s, s + 80);
  const gr = ctx.createLinearGradient(NRM[0] * s, NRM[1] * s, NRM[0] * (s + 80), NRM[1] * (s + 80));
  gr.addColorStop(0, 'rgba(3,10,16,0.55)'); gr.addColorStop(1, 'rgba(3,10,16,0)'); ctx.fillStyle = gr; ctx.fill(); ctx.restore();
  ctx.save(); bandPoly(ctx, -6000, s); ctx.clip();
  ctx.translate(-NRM[0] * (1 - e) * 150, -NRM[1] * (1 - e) * 150); drawNew(); ctx.restore();
  ctx.save(); ctx.strokeStyle = C.red; ctx.lineWidth = 6; lineAt(ctx, s); ctx.stroke(); ctx.restore();
}

// ============================================================ SCENER
// Varje scen: fn(lt) ritar hela bilden för lokal tid lt (kan vara negativ under inkommande övergång).

// 1. Bomärket byggs (2 s)
function sceneMark(lt) {
  background(lt);
  const S0 = 300, S1 = 156;
  const om = R.meta.ordbild;
  const m = heavy(prog(lt, 0.52, 0.55));
  const S = lerp(S0, S1, m);
  const total1 = (om.x0 + om.w) * S1 / om.h;
  const x = lerp(W / 2 - S0 / 2, W / 2 - total1 / 2, m), y = lerp(H * 0.47 - S0 / 2, H * 0.47 - S1 / 2, m);
  const gl = prog(lt, 0.2, 0.4) * (1 - prog(lt, 0.55, 0.5));
  if (gl > 0) { ctx.save(); ctx.globalAlpha = gl * 0.22; ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(GLOW, x + S / 2 - S * 1.4, y + S / 2 - S * 1.4, S * 2.8, S * 2.8); ctx.restore(); }
  drawMark(x, y, S, [prog(lt, 0.0, 0.62), prog(lt, 0.07, 0.62), prog(lt, 0.14, 0.62)]);
  if (lt > 0.6) {
    const k = S1 / om.h, wx = x + om.x0 * k, ww = om.w * k;
    const p = prog(lt, 0.68, 0.7), e = expoOut(p);
    const edge = lerp(-0.2, 1.25, e);
    ctx.save(); ctx.beginPath(); ctx.moveTo(wx - 40, y - 10); ctx.lineTo(wx + ww * edge + S1 * 0.58, y - 10); ctx.lineTo(wx + ww * edge, y + S1 + 10); ctx.lineTo(wx - 40, y + S1 + 10); ctx.closePath(); ctx.clip();
    ctx.globalAlpha = clamp(p * 1.6); ctx.filter = blurF((1 - e) * 6);
    ctx.drawImage(R.img.ordbild, wx - 30 * (1 - e), y, ww, S1);
    ctx.restore(); ctx.filter = 'none';
  }
}

// 2. SIGNATUR: namnet tvättas fram ur smutsig sten (omvänd graffiti)
/* Byggs av ett riktigt fotopar av samma yta (smutsig/ren, inriktade). Den rena bilden visas genom en mask:
 * namnet i Big Shoulders 800, men masken fylls som en högtryckstvätt gör det: bokstav för bokstav, i vågräta
 * fram-och-tillbaka-drag med rundad framkant, ojämn brusig kant, först våt (mörkare, blankare) och sedan
 * torkande ljusare. Ett munstycke med stänk, dimma och droppar följer framkanten; vattenrännilar rinner ned.
 * Allt sker i ”markrummet” (1080x1920 utan kamera) och kameran (inzoomning + lätt rotation) läggs på efteråt. */
let NW = null;
let NW_FOCUS = [540, 990]; // sätts från config (film.namn_fokus): punkt i bilden som kameran siktar på
function nwCam(lt) { // markrum -> skärm
  const z = lerp(1.28, 1.36, sineInOut(clamp(lt / 6)));
  const rot = (lerp(-0.55, 0.15, sineInOut(clamp(lt / 6)))) * Math.PI / 180;
  return { z, rot };
}
function nwApply(g, cam) { g.translate(W / 2, H / 2); g.scale(cam.z, cam.z); g.rotate(cam.rot); g.translate(-NW_FOCUS[0], -NW_FOCUS[1]); }
function valueNoise(seed, cell) { // utjämnat värdebrus 0..1 på ett grovt rutnät
  const r = mulberry32(seed); const gw = Math.ceil(W / cell) + 2, gh = Math.ceil(H / cell) + 2; const g = new Float32Array(gw * gh); for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => { const fx = clamp(x, 0, W - 1) / cell, fy = clamp(y, 0, H - 1) / cell, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy; const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1]; return lerp(lerp(a, b, sx), lerp(c, d, sx), sy); };
}
function prepNameWash() {
  if (P.takt.namn_fokus) NW_FOCUS = P.takt.namn_fokus;
  const name = P.fornamn.toLocaleUpperCase('sv-SE');
  const chars = [...name];
  // storlek: ~80 % av bildbredden på skärmen vid slutzoom
  const zEnd = 1.36, maxW = 870 / zEnd;
  const size = fitSize(name, 800, BS, maxW, 560, 0.01);
  setFont(800, size, BS, size * 0.01);
  let acc = ''; const xs = chars.map(ch => { const v = textW(acc); acc += ch; return v; });
  const totalW = textW(name);
  const x0 = NW_FOCUS[0] - totalW / 2;
  const m = ctx.measureText('E'); const cap = m.actualBoundingBoxAscent;
  const base = NW_FOCUS[1] + cap / 2 + 95; // namnet något under bildmitten, plats för ”Välkommen,” ovanför
  // textmask i markrummet
  const pad = 40;
  const bx = Math.floor(x0 - pad), by = Math.floor(base - size * 1.02 - pad), bw = Math.ceil(totalW + 2 * pad), bh = Math.ceil(size * 1.02 + 2 * pad);
  const tc = offscreen(bw, bh); const tg = tc.getContext('2d');
  tg.font = `800 ${size}px ${BS}`; tg.letterSpacing = `${size * 0.01}px`; tg.fillStyle = '#fff';
  tg.filter = 'blur(1.6px)'; tg.fillText(name, x0 - bx, base - by);
  const td = tg.getImageData(0, 0, bw, bh).data;
  const n1 = valueNoise(11, 7), n2 = valueNoise(12, 23), n3 = valueNoise(13, 3);
  const M = new Float32Array(bw * bh), T = new Float32Array(bw * bh);
  // bokstävernas rutor och tidsfönster
  const n = chars.length;
  const TS = 0.3, dur = clamp(0.6 * n, 2.0, 3.5), gap = Math.min(0.08, dur / n * 0.12);
  const per = (dur - gap * (n - 1)) / n;
  const L = chars.map((ch, i) => {
    const mm = ctx.measureText(ch); const l = x0 + xs[i] - mm.actualBoundingBoxLeft, r = x0 + xs[i] + mm.actualBoundingBoxRight;
    const top = base - mm.actualBoundingBoxAscent, bot = base + mm.actualBoundingBoxDescent;
    const band = 44; const passes = Math.max(2, Math.round((bot - top) / band)); const bandH = (bot - top) / passes;
    return { l, r, top, bot, passes, bandH, t0: TS + i * (per + gap), per, mid: x0 + xs[i] + textW(ch) / 2 };
  });
  const letterAt = x => { let k = 0; for (let i = 1; i < n; i++) if (x > (L[i - 1].r + L[i].l) / 2) k = i; return k; };
  for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
    const i = yy * bw + xx; const a = td[i * 4 + 3] / 255; if (a < 0.02) { M[i] = 0; continue; }
    const gx = bx + xx, gy = by + yy;
    // ojämn kant: tröskel på mjuk textkant med brus i två skalor
    const nn = (n1(gx, gy) - 0.5) * 0.55 + (n3(gx, gy) - 0.5) * 0.35;
    M[i] = clamp((a - 0.5 + nn * 0.55) / 0.22 + 0.5);
    const Lk = L[letterAt(gx)];
    const v = (gy - Lk.top) / Lk.bandH + (n2(gx, gy) - 0.5) * 0.5;
    const p = clamp(Math.floor(v), 0, Lk.passes - 1);
    let u = clamp((gx - Lk.l) / Math.max(1, Lk.r - Lk.l));
    if (p % 2) u = 1 - u;
    const passDur = Lk.per / Lk.passes;
    const dy = (v - p - 0.5) * Lk.bandH; const rad = Lk.bandH * 0.75;
    const lead = Math.sqrt(Math.max(0, rad * rad - dy * dy)) / Math.max(1, Lk.r - Lk.l) * passDur;
    T[i] = Lk.t0 + (p + u) * passDur - lead + (n3(gx, gy) - 0.5) * 0.03;
  }
  // rännilar: 2 per bokstav, nedåt från bokstavens fot, seedade slingor
  const rr = mulberry32(77); const riv = [];
  L.forEach((Lk, i) => { for (let k = 0; k < 2; k++) {
    const sx = lerp(Lk.l + 10, Lk.r - 10, rr()); const pts = []; let x = sx, y = Lk.bot - 6;
    const len = 90 + rr() * 170; const seg = 14;
    for (let s = 0; s <= len; s += seg) { pts.push([x, y]); x += (rr() - 0.5) * 7; y += seg; }
    riv.push({ pts, t: Lk.t0 + Lk.per * (0.6 + rr() * 0.3), w: 3 + rr() * 3 });
  } });
  const mc = offscreen(bw, bh), wc = offscreen(bw, bh), hc = offscreen(bw, bh), tmp = offscreen(bw, bh);
  NW = { name, size, x0, base, cap, bx, by, bw, bh, M, T, L, TS, TE: TS + dur, riv, mc, wc, hc, tmp,
    mImg: mc.getContext('2d').createImageData(bw, bh), wImg: wc.getContext('2d').createImageData(bw, bh) };
  // färdiga varianter av fotona: våt ren yta (mörkare, mer kontrast, kall reflex) och våt smuts
  const src = R.meta.bilder[(P.takt.namnbild || 1) - 1];
  const mk = (img, f) => { const c = offscreen(W, H); const g = c.getContext('2d'); g.filter = f; g.drawImage(img, 0, 0, W, H); g.filter = 'none'; return c; };
  NW.dirty = mk(R.img.nwF, 'none'); NW.clean = mk(R.img.nwE, 'none');
  NW.cleanWet = mk(R.img.nwE, 'brightness(0.66) contrast(1.22) saturate(1.15)');
  { const g = NW.cleanWet.getContext('2d'); const gr = g.createLinearGradient(0, 0, W * 0.3, H); gr.addColorStop(0, 'rgba(190,215,235,0.16)'); gr.addColorStop(0.5, 'rgba(190,215,235,0.04)'); gr.addColorStop(1, 'rgba(190,215,235,0.12)'); g.globalCompositeOperation = 'screen'; g.fillStyle = gr; g.fillRect(0, 0, W, H); }
  NW.dirtyWet = mk(R.img.nwF, 'brightness(0.62) contrast(1.15) saturate(1.1)');
  NW.mist = (() => { const c = offscreen(128, 128); const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(235,242,248,0.55)'); gr.addColorStop(0.5, 'rgba(225,235,242,0.18)'); gr.addColorStop(1, 'rgba(225,235,242,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return c; })();
  NW.drop = (() => { const c = offscreen(16, 16); const g = c.getContext('2d'); const gr = g.createRadialGradient(8, 8, 0, 8, 8, 8); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(240,248,255,0.6)'); gr.addColorStop(1, 'rgba(240,248,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 16, 16); return c; })();
  NW.sprayPath = [];
  for (let t = NW.TS - 0.05; t <= NW.TE + 0.05; t += 0.05) { const h = nwHead(t); if (h.on) NW.sprayPath.push([+t.toFixed(3), +(h.x / W).toFixed(3)]); }
}
function nwHead(t) { // munstyckets läge i markrummet
  const L = NW.L;
  for (let i = 0; i < L.length; i++) {
    const Lk = L[i];
    if (t >= Lk.t0 && t <= Lk.t0 + Lk.per) {
      const f = (t - Lk.t0) / Lk.per * Lk.passes; const p = Math.min(Lk.passes - 1, Math.floor(f)); let u = f - p; if (p % 2) u = 1 - u;
      return { on: true, x: lerp(Lk.l, Lk.r, u), y: Lk.top + (p + 0.5) * Lk.bandH, i };
    }
    if (i < L.length - 1 && t > Lk.t0 + Lk.per && t < L[i + 1].t0) { const k = (t - Lk.t0 - Lk.per) / (L[i + 1].t0 - Lk.t0 - Lk.per); const a = nwHead(Lk.t0 + Lk.per - 1e-4), b = nwHead(L[i + 1].t0 + 1e-4); return { on: false, x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) }; }
  }
  return { on: false, x: NW_FOCUS[0], y: NW_FOCUS[1] };
}
function maskedDraw(g, srcCanvas, maskCanvas, alpha = 1) {
  const t = NW.tmp.getContext('2d');
  t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, NW.bw, NW.bh);
  t.drawImage(srcCanvas, NW.bx, NW.by, NW.bw, NW.bh, 0, 0, NW.bw, NW.bh);
  t.globalCompositeOperation = 'destination-in'; t.drawImage(maskCanvas, 0, 0);
  g.save(); g.globalAlpha = alpha; g.drawImage(NW.tmp, NW.bx, NW.by); g.restore();
}
let NWSCN = null, NWSMALL = null;
function sceneName(lt) {
  if (!NWSCN) { NWSCN = offscreen(W, H); NWSMALL = offscreen(W / 6, H / 6); }
  const g = NWSCN.getContext('2d');
  const cam = nwCam(lt);
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.save(); nwApply(g, cam);
  g.drawImage(NW.dirty, 0, 0);
  // masker för denna tidpunkt
  const { M, T, bw, bh, mImg, wImg } = NW; const md = mImg.data, wd = wImg.data;
  for (let i = 0; i < M.length; i++) {
    const m = M[i]; if (m <= 0) { md[i * 4 + 3] = 0; wd[i * 4 + 3] = 0; continue; }
    const dt = lt - T[i]; const a = m * clamp(dt / 0.05 + 0.5);
    md[i * 4] = md[i * 4 + 1] = md[i * 4 + 2] = 255; md[i * 4 + 3] = a * 255;
    const wet = dt > 0 ? a * Math.exp(-dt / 1.1) : a; wd[i * 4] = wd[i * 4 + 1] = wd[i * 4 + 2] = 255; wd[i * 4 + 3] = wet * 255;
  }
  NW.mc.getContext('2d').putImageData(mImg, 0, 0); NW.wc.getContext('2d').putImageData(wImg, 0, 0);
  const hg = NW.hc.getContext('2d'); hg.clearRect(0, 0, bw, bh); hg.filter = 'blur(10px)'; hg.drawImage(NW.wc, 0, 0); hg.drawImage(NW.wc, 0, 0); hg.filter = 'none';
  // 1) överstänk: smutsen runt det tvättade blir våt och mörkare
  maskedDraw(g, NW.dirtyWet, NW.hc, 0.9);
  // 2) rännilar på den smutsiga ytan
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  for (const r of NW.riv) {
    const age = lt - r.t; if (age <= 0) continue;
    const len = Math.min(1, Math.pow(age / 1.4, 0.7)); const dry = 1 - prog(age, 1.6, 1.6); if (dry <= 0) continue;
    const k = Math.max(2, Math.floor(r.pts.length * len));
    g.beginPath(); r.pts.slice(0, k).forEach(([x, y], j) => j ? g.lineTo(x, y) : g.moveTo(x, y));
    g.filter = 'blur(2.5px)'; g.strokeStyle = `rgba(12,16,14,${0.26 * dry})`; g.lineWidth = r.w * 2.4; g.stroke();
    g.filter = 'blur(0.8px)'; g.strokeStyle = `rgba(230,240,245,${0.10 * dry})`; g.lineWidth = 1.2; g.translate(-2, 0); g.stroke(); g.translate(2, 0); g.filter = 'none';
  }
  g.restore();
  // 3) ren sten genom masken, 4) våt glans ovanpå som torkar bort
  maskedDraw(g, NW.clean, NW.mc, 1);
  maskedDraw(g, NW.cleanWet, NW.wc, 1);
  // 5) munstycke: träffpunkt, dimma, droppar (seedat, deterministiskt)
  nwSpray(g, lt);
  g.restore();
  // skärpedjup: övre och nedre kanten mjukt oskarpa
  const sg = NWSMALL.getContext('2d'); sg.imageSmoothingQuality = 'high'; sg.drawImage(NWSCN, 0, 0, NWSMALL.width, NWSMALL.height);
  ctx.drawImage(NWSCN, 0, 0);
  ctx.save();
  for (const [y0, y1, a0, a1] of [[0, 520, 1, 0], [1400, H, 0, 1]]) {
    ctx.save(); ctx.beginPath(); ctx.rect(0, y0, W, y1 - y0); ctx.clip();
    const steps = 6; for (let s = 0; s < steps; s++) { const ys = y0 + (y1 - y0) * s / steps, ye = y0 + (y1 - y0) * (s + 1) / steps; const a = lerp(a0, a1, (s + 0.5) / steps);
      ctx.save(); ctx.beginPath(); ctx.rect(0, ys, W, ye - ys + 1); ctx.clip(); ctx.globalAlpha = a * 0.85; ctx.filter = 'blur(2px)'; ctx.drawImage(NWSMALL, 0, 0, W, H); ctx.restore(); }
    ctx.restore();
  }
  ctx.restore(); ctx.filter = 'none';
  // ton: lätt mörkare kanter så blicken hamnar på namnet
  const gr = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.18, W / 2, H * 0.5, H * 0.62); gr.addColorStop(0, 'rgba(6,17,27,0)'); gr.addColorStop(1, 'rgba(6,17,27,0.5)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  // ”Välkommen,” i liten text ovanför namnet, i skärmrummet
  const tl = (() => { const c = Math.cos(cam.rot), s = Math.sin(cam.rot); const gx = NW.x0 - NW_FOCUS[0], gy = NW.base - NW.cap - NW_FOCUS[1]; return [W / 2 + (gx * c - gy * s) * cam.z, H / 2 + (gx * s + gy * c) * cam.z]; })();
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 3;
  letters('Välkommen,', Math.max(SAFE.x0, tl[0]), tl[1] - 44, 96, 700, BS, 0.5, { t: lt, t0: NW.TE + 0.25, stagger: 0.035, dur: 0.85, rise: 60, blur: 10, mask: true });
  ctx.restore();
}
function nwSpray(g, lt) {
  const { TS, TE } = NW;
  if (lt < TS - 0.1 || lt > TE + 1.6) return;
  const head = nwHead(lt);
  g.save();
  // vått stänkområde runt munstycket: vattnet sprids och mörkar ytan, torkar efter en stund
  g.globalCompositeOperation = 'multiply';
  for (let tau = Math.max(TS, lt - 0.9); tau <= Math.min(lt, TE); tau += 0.025) {
    const h = nwHead(tau); if (!h.on) continue; const age = lt - tau; const a = 0.10 * Math.pow(1 - age / 0.9, 1.5);
    const rad = 70 + 60 * age; const gr = g.createRadialGradient(h.x, h.y, 0, h.x, h.y, rad);
    gr.addColorStop(0, `rgba(60,62,58,${a})`); gr.addColorStop(1, 'rgba(60,62,58,0)'); g.fillStyle = gr; g.fillRect(h.x - rad, h.y - rad, rad * 2, rad * 2);
  }
  g.globalCompositeOperation = 'source-over';
  // dimma: stora mjuka moln som driver och växer
  const MR = 70; const k0 = Math.max(0, Math.floor((lt - 1.4 - TS) * MR)), k1 = Math.floor((Math.min(lt, TE) - TS) * MR);
  for (let k = k0; k <= k1; k++) {
    const b = TS + k / MR; const h = nwHead(b); if (!h.on) continue; const age = lt - b; if (age < 0 || age > 1.4) continue;
    const r = mulberry32(9000 + k); const ang = r() * Math.PI * 2, sp = 25 + r() * 70;
    const x = h.x + Math.cos(ang) * sp * age + (r() - 0.5) * 30, y = h.y + Math.sin(ang) * sp * age * 0.7 - 18 * age;
    const rad = 34 + 130 * Math.pow(age / 1.4, 0.6) * (0.6 + r() * 0.6);
    g.globalAlpha = 0.42 * clamp(age / 0.1) * Math.pow(1 - age / 1.4, 1.4); g.drawImage(NW.mist, x - rad, y - rad, rad * 2, rad * 2);
  }
  // droppar som studsar ut från träffpunkten, ritade som korta streck (rörelseoskärpa)
  g.globalCompositeOperation = 'source-over';
  const DR = 900; const d0 = Math.max(0, Math.floor((lt - 0.5 - TS) * DR)), d1 = Math.floor((Math.min(lt, TE) - TS) * DR);
  g.lineCap = 'round';
  for (let k = d0; k <= d1; k++) {
    const b = TS + k / DR; const age = lt - b; if (age < 0 || age > 0.5) continue; const h = nwHead(b); if (!h.on) continue;
    const r = mulberry32(5000 + k); const ang = r() * Math.PI * 2; const v = 200 + 650 * r() * r(); const life = 0.25 + r() * 0.3; if (age > life) continue;
    const dr = 6; const f = a => (1 - Math.exp(-dr * a)) / dr;
    const vx = Math.cos(ang) * v, vy = Math.sin(ang) * v * 0.75;
    const x0 = h.x + (r() - 0.5) * 14, y0 = h.y + (r() - 0.5) * 14;
    const xa = x0 + vx * f(age), ya = y0 + vy * f(age) + 160 * age * age;
    const xb = x0 + vx * f(Math.max(0, age - 0.018)), yb = y0 + vy * f(Math.max(0, age - 0.018)) + 160 * Math.max(0, age - 0.018) ** 2;
    const al = Math.pow(1 - age / life, 1.2) * (0.5 + r() * 0.5);
    g.strokeStyle = `rgba(242,248,253,${Math.min(1, al * 1.3)})`; g.lineWidth = 1.6 + r() * 3.2;
    g.beginPath(); g.moveTo(xb, yb); g.lineTo(xa, ya); g.stroke();
  }
  // strålen: vattnet kommer snett uppifrån (lansen är utanför bild) och slår i ytan
  if (head.on) {
    const fl = 0.8 + 0.2 * Math.sin(lt * 97) * Math.sin(lt * 61 + 1);
    const sx = head.x + 150, sy = head.y - 900;
    const fr = Math.floor(lt * 60); const rj = mulberry32(7000 + fr);
    g.lineCap = 'round';
    for (let k = 0; k < 9; k++) {
      const off = (rj() - 0.5) * 26, w = 1 + rj() * 2.5;
      const gr = g.createLinearGradient(sx, sy, head.x, head.y);
      gr.addColorStop(0, 'rgba(240,248,255,0)'); gr.addColorStop(0.55, `rgba(240,248,255,${0.10 * fl})`); gr.addColorStop(1, `rgba(245,250,255,${0.55 * fl})`);
      g.strokeStyle = gr; g.lineWidth = w; g.beginPath(); g.moveTo(sx + off * 0.2, sy); g.lineTo(head.x + off, head.y + (rj() - 0.5) * 10); g.stroke();
    }
    // skum i träffpunkten: många små vita fläckar som flimrar
    for (let k = 0; k < 70; k++) {
      const a = rj() * Math.PI * 2, rr = 52 * Math.pow(rj(), 0.7); const x = head.x + Math.cos(a) * rr * 1.3, y = head.y + Math.sin(a) * rr * 0.75;
      const sz = 3 + rj() * 9; g.globalAlpha = (0.25 + rj() * 0.5) * (1 - rr / 60) * fl; g.drawImage(NW.drop, x - sz, y - sz, sz * 2, sz * 2);
    }
    g.globalAlpha = 0.85 * fl; const R1 = 110; g.drawImage(NW.mist, head.x - R1, head.y - R1 * 0.75, R1 * 2, R1 * 1.5);
    g.globalAlpha = 0.9 * fl; const R2 = 34; g.drawImage(NW.drop, head.x - R2, head.y - R2 * 0.7, R2 * 2, R2 * 1.4);
  }
  g.restore();
}

// 3. Montage: filmklipp på takten, eller tre foton som reserv
function drawCover(img, fx, fy, zoom, dx = 0) {
  const s = Math.max(W / img.width, H / img.height) * zoom; const w = img.width * s, h = img.height * s;
  ctx.drawImage(img, W * fx - w * fx + dx, H * fy - h * fy, w, h);
}
function sceneMontage(lt) {
  const segs = P.montageSegs; // [{start, dur, typ, ...}]
  let i = segs.findIndex(s => lt < s.start + s.dur); if (i < 0) i = segs.length - 1; if (lt < 0) i = 0;
  const drawSeg = (k, u) => {
    const s = segs[k];
    if (s.typ === 'klipp') {
      const f = clamp(Math.floor(u * 30), 0, s.frames - 1); const img = R.clip['m' + k + '_' + f];
      ctx.fillStyle = C.n1; ctx.fillRect(0, 0, W, H);
      if (img) drawCover(img, 0.5, 0.5, 1 + 0.04 * clamp(u / s.dur));
    } else {
      const img = R.img['res' + k]; const [fx, fy] = s.fokus;
      drawCover(img, fx, fy, 1.04 + 0.07 * sineInOut(clamp((u + 0.3) / (s.dur + 0.6))), (k % 2 ? -1 : 1) * 30 * (clamp((u + 0.3) / (s.dur + 0.6)) - 0.5));
    }
  };
  // fotoreserven byter med en kort diagonal kant på slaget; klipp skärs hårt på slaget
  const s = segs[i]; const u = lt - s.start;
  if (s.typ === 'foto' && i > 0 && u < 0.18) wipe((u + 0.18) / 0.36, () => drawSeg(i - 1, lt - segs[i - 1].start), () => drawSeg(i, u));
  else if (s.typ === 'foto' && i < segs.length - 1 && u > s.dur - 0.18) wipe((u - s.dur + 0.18) / 0.36, () => drawSeg(i, u), () => drawSeg(i + 1, lt - segs[i + 1].start));
  else drawSeg(i, u);
}

// 4. Kartan
let MAP = null;
function prepMap() {
  const K = R.karta; const rnd = mulberry32(4242);
  const toF = r => Float32Array.from(r);
  const land = {}; for (const k in K.land) land[k] = K.land[k].map(toF);
  // Sveriges yttre gräns och area-ordning
  const se = land.SE.map(r => { let per = 0, minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9; for (let i = 0; i < r.length; i += 2) { const x = r[i], y = r[i + 1]; if (i) per += Math.hypot(x - r[i - 2], y - r[i - 1]); minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); } return { r, per, bb: [minx, miny, maxx, maxy] }; });
  se.sort((a, b) => b.per - a.per);
  let bb = [1e9, 1e9, -1e9, -1e9]; se.forEach(o => { bb = [Math.min(bb[0], o.bb[0]), Math.min(bb[1], o.bb[1]), Math.max(bb[2], o.bb[2]), Math.max(bb[3], o.bb[3])]; });
  // Inre länsgränser = segment som delas av två län
  const seg = new Map(); const key = (a, b, c, d) => `${a},${b},${c},${d}`;
  K.lan.forEach(r => { for (let i = 2; i < r.length; i += 2) { const a = r[i - 2], b = r[i - 1], c = r[i], d = r[i + 1]; const k1 = key(a, b, c, d), k2 = key(c, d, a, b); if (seg.has(k2)) seg.get(k2).n++; else if (!seg.has(k1)) seg.set(k1, { s: [a, b, c, d], n: 1 }); } });
  const inner = []; seg.forEach(v => { if (v.n > 1) inner.push(v.s); });
  // Besökspunkter: varje koordinat sprids ut som ett litet fält (likformig täthet, inga klumpar)
  const pts = [];
  const gauss = () => { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  K.punkter.forEach(([x, y, n, reg]) => {
    const cnt = Math.min(n, 60); const sig = 0.45 + 0.42 * Math.sqrt(cnt);
    for (let i = 0; i < cnt; i++) pts.push({ x: x + gauss() * sig, y: y + gauss() * sig, reg, s: 0.7 + rnd() * 0.6, j: rnd() });
  });
  MAP = { land, se, bb, inner, pts };
}
function regionView() {
  const reg = R.karta.regioner[P.region]; const b = reg.bb;
  const bw = b[2] - b[0], bh = b[3] - b[1];
  const k = Math.min(900 / bw, 700 / bh);
  return { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, k, sy: 800 };
}
function fullView() {
  const b = MAP.bb; const bw = b[2] - b[0], bh = b[3] - b[1];
  const k = Math.min(820 / bw, 1340 / bh);
  return { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, k, sy: 1010 };
}
function zoomInterp(p0, p1) { // van Wijk & Nuij (som d3.interpolateZoom), p = [ux, uy, w]
  const rho = Math.SQRT2, rho2 = 2, rho4 = 4;
  const [ux0, uy0, w0] = p0, [ux1, uy1, w1] = p1; const dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
  if (d2 < 1e-9) { const S = Math.log(w1 / w0) / rho; return t => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S)]; }
  const d1 = Math.sqrt(d2), b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1), b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1), S = (r1 - r0) / rho;
  return t => { const s = t * S, c0 = Math.cosh(r0), u = w0 / (rho2 * d1) * (c0 * Math.tanh(rho * s + r0) - Math.sinh(r0)); return [ux0 + u * dx, uy0 + u * dy, w0 * c0 / Math.cosh(rho * s + r0)]; };
}
function ringPath(r, cam, close = true) {
  const { cx, cy, k, sy } = cam;
  ctx.moveTo(W / 2 + (r[0] - cx) * k, sy + (r[1] - cy) * k);
  for (let i = 2; i < r.length; i += 2) ctx.lineTo(W / 2 + (r[i] - cx) * k, sy + (r[i + 1] - cy) * k);
  if (close) ctx.closePath();
}
const T_FLY0 = 0.95, T_FLY = 2.2, T_CASC = 2.75;
function camAt(lt) {
  const a = fullView(), b = regionView();
  const f = heavy(prog(lt, T_FLY0, T_FLY));
  const zi = zoomInterp([a.cx, a.cy, W / a.k], [b.cx, b.cy, W / b.k]);
  const [ux, uy, w] = zi(f);
  // långsam fortsatt inzoomning efter landning så bilden lever
  const drift = 1 + 0.03 * sineInOut(prog(lt, T_FLY0 + T_FLY - 0.2, 3.0));
  return { cx: ux, cy: uy, k: W / w * drift, sy: lerp(a.sy, b.sy, f) };
}
function sceneMap(lt) {
  background(lt + 8, -120);
  const cam = camAt(lt);
  const fly = prog(lt, T_FLY0, T_FLY);
  const z = cam.k / fullView().k;
  // grannländer (mörkare, ger sammanhang: Danmark, Norge, Finland ...)
  const nb = clamp(prog(lt, -0.3, 0.9) * 0.55 + fly * 0.45);
  if (nb > 0) {
    ctx.save(); ctx.globalAlpha = nb;
    ctx.beginPath(); for (const c of ['NO', 'FI', 'DK', 'DE', 'PL', 'EE', 'LV', 'LT']) MAP.land[c].forEach(r => ringPath(r, cam));
    ctx.fillStyle = '#122c41'; ctx.fill('nonzero');
    ctx.lineWidth = 1.1; ctx.strokeStyle = 'rgba(84,140,145,0.32)'; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
  }
  // Sverige: fyllning tonar in när konturen ritats
  const fillA = prog(lt, -0.1, 0.8);
  ctx.save(); ctx.beginPath(); MAP.se.forEach(o => ringPath(o.r, cam));
  if (fillA > 0) { ctx.globalAlpha = fillA; ctx.fillStyle = '#1c4260'; ctx.fill(); }
  ctx.restore();
  // inre länsgränser, svaga
  const lanA = prog(lt, 0.5, 0.8) * 0.55;
  if (lanA > 0) {
    ctx.save(); ctx.beginPath(); MAP.se.forEach(o => ringPath(o.r, cam)); ctx.clip();
    ctx.beginPath(); for (const s of MAP.inner) { ctx.moveTo(W / 2 + (s[0] - cam.cx) * cam.k, cam.sy + (s[1] - cam.cy) * cam.k); ctx.lineTo(W / 2 + (s[2] - cam.cx) * cam.k, cam.sy + (s[3] - cam.cy) * cam.k); }
    ctx.globalAlpha = lanA; ctx.strokeStyle = '#4f7a8c'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]); ctx.stroke();
    ctx.restore();
  }
  // konturen ritas fram (stroke reveal), största ringen först, öar tonar in
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = C.vl;
  ctx.lineWidth = lerp(1.7, 2.2, clamp(fly));
  const draw = quartInOut(prog(lt, -0.45, 1.3));
  MAP.se.forEach((o, i) => {
    const pp = i === 0 ? draw : clamp((draw - 0.25 - (i % 7) * 0.03) / 0.6);
    if (pp <= 0) return;
    const len = o.per * cam.k;
    ctx.beginPath(); ringPath(o.r, cam, false);
    if (pp < 1) { ctx.setLineDash([len * pp, len * 2 + 10]); } else ctx.setLineDash([]);
    ctx.globalAlpha = i === 0 ? 1 : 0.85; ctx.stroke();
  });
  ctx.restore();
  // ljuspunkter
  const rv = regionView();
  const rcx = W / 2, rcy = rv.sy;
  const coreR = lerp(1.1, 1.9, clamp(fly)), glowR = lerp(6, 16, clamp(fly));
  const dimIn = prog(lt, 0.0, 0.9);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const maxD = 620;
  for (const p of MAP.pts) {
    const X = W / 2 + (p.x - cam.cx) * cam.k, Y = cam.sy + (p.y - cam.cy) * cam.k;
    if (X < -30 || X > W + 30 || Y < -30 || Y > H + 30) continue;
    // svag grundnivå för alla punkter i landet, söder-till-norr
    const base = dimIn > 0 ? clamp((dimIn * 1.6 - (1 - (p.y - MAP.bb[1]) / (MAP.bb[3] - MAP.bb[1])) * 0.6)) : 0;
    let a = 0.16 * base, gl = 0, sz = p.s;
    if (p.reg >= 0 && R.meta.regioner[p.reg] === P.region) {
      // kaskad från regionens mitt, räknat i landad kamera
      const fx = rcx + (p.x - rv.cx) * rv.k, fy = rcy + (p.y - rv.cy) * rv.k;
      const d = Math.hypot(fx - rcx, fy - rcy);
      const q = prog(lt, T_CASC + Math.min(1, d / maxD) * 1.2 + p.j * 0.12, 0.5);
      if (q > 0) { const e = expoOut(q); a = lerp(a, 0.9, e); gl = 0.16 + 0.75 * Math.pow(1 - q, 2); sz = p.s * (0.7 + 0.3 * e + 0.6 * Math.pow(1 - q, 3)); }
    }
    if (a <= 0.003) continue;
    if (gl > 0) { ctx.globalAlpha = gl * 0.45; const g = glowR * sz; ctx.drawImage(GLOW, X - g, Y - g, g * 2, g * 2); }
    ctx.globalAlpha = a; const c = coreR * sz * 1.9; ctx.drawImage(CORE, X - c, Y - c, c * 2, c * 2);
  }
  ctx.restore();
  // rubrik över hela landet
  // regionens namn
  const ty = 1560;
  // läsbarhet: mjuk mörk ton bakom texten
  const sh = prog(lt, T_FLY0 + 0.9, 1.0);
  if (sh > 0) { const gr = ctx.createLinearGradient(0, 1080, 0, H); gr.addColorStop(0, 'rgba(6,17,27,0)'); gr.addColorStop(0.3, `rgba(6,17,27,${0.72 * sh})`); gr.addColorStop(1, `rgba(6,17,27,${0.9 * sh})`); ctx.fillStyle = gr; ctx.fillRect(0, 1080, W, H - 1080); }
  const t0 = T_FLY0 + T_FLY - 0.6;
  if (lt > t0) {
    ctx.save(); const rp = expoOut(prog(lt, t0, 0.8)); ctx.fillStyle = C.red; ctx.fillRect(SAFE.x0, ty - 214, 52 * rp, 5); ctx.restore();
    kicker('DITT OMRÅDE', SAFE.x0 + 70, ty - 200, lt, t0 + 0.1, C.t2, 34);
    const z = fitSize(P.region, 800, BS, 864, 178, -0.01);
    letters(P.region, SAFE.x0 - 4, ty, z, 800, BS, -0.01 * z, { t: lt, t0: t0 + 0.2, stagger: 0.035, dur: 0.9, rise: z * 0.9, blur: 12, mask: true });
    words('Varje ljuspunkt är ett jobb vi har gjort.', SAFE.x0, ty + 86, 40, 400, OS, 0, { t: lt, t0: t0 + 0.7, stagger: 0.05, dur: 0.8, rise: 16, color: C.t2 });
  }
}


function drawPhoto(img, fx, fy, kb) {
  const s = (W / img.width) * (1 + 0.055 * kb);
  const w = img.width * s, h = img.height * s;
  ctx.drawImage(img, W * fx - w * fx, H * fy - h * fy, w, h);
}
function chip(s, x, y, align, bg) {
  setFont(700, 30, OS, 30 * 0.22);
  const w = textW(s) + 54, h = 58; const x0 = align === 'right' ? x - w : x;
  ctx.save(); ctx.fillStyle = bg; ctx.beginPath();
  const sl = h * Math.tan(Math.PI / 6); // sned kant i 30°
  ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); ctx.lineTo(x0 + w - sl, y + h); ctx.lineTo(x0 - sl, y + h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = C.white; ctx.fillText(s, x0 + 24 - sl / 2, y + 40); ctx.restore();
}

// 5. Ett starkt före/efter
function sceneBeforeAfter(lt) {
  const b = R.meta.bilder[(P.takt.fore_efter || 3) - 1]; const fo = R.img.baF, ef = R.img.baE; const [fx, fy] = b.fokus;
  const kb = sineInOut(clamp((lt + 0.4) / 4.6));
  drawPhoto(fo, fx, fy, kb);
  const wp = sineInOut(prog(lt, 0.45, 1.15));
  const s = lerp(NMIN - 20, NMAX + 20, wp);
  if (wp > 0) {
    ctx.save(); bandPoly(ctx, -6000, s); ctx.clip(); drawPhoto(ef, fx, fy, kb); ctx.restore();
    if (wp < 1) {
      ctx.save(); ctx.strokeStyle = 'rgba(6,17,27,0.35)'; ctx.lineWidth = 14; ctx.filter = 'blur(7px)'; lineAt(ctx, s + 6); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.strokeStyle = C.red; ctx.lineWidth = 6; lineAt(ctx, s); ctx.stroke(); ctx.restore();
    }
  }
  const gr = ctx.createLinearGradient(0, 0, 0, 420); gr.addColorStop(0, 'rgba(6,17,27,0.5)'); gr.addColorStop(1, 'rgba(6,17,27,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, 420);
  const sNow = wp > 0 ? s : NMIN - 400;
  const fa = clamp(prog(lt, -0.1, 0.4)) * clamp((560 - sNow) / 160);
  const ea = expoOut(clamp((sNow - 300) / 260));
  if (fa > 0) { ctx.save(); ctx.globalAlpha = fa; chip('FÖRE', SAFE.x1, 250, 'right', 'rgba(6,17,27,0.72)'); ctx.restore(); }
  if (ea > 0) { ctx.save(); ctx.globalAlpha = clamp(ea * 1.5); ctx.translate(-30 * (1 - ea), 0); chip('EFTER', SAFE.x0 + 30, 250, 'left', C.red); ctx.restore(); }
}

// 6. Hälsning från gruppledaren (valfri, filmens känslomässiga topp)
function sceneHalsning(lt) {
  ctx.fillStyle = C.n1; ctx.fillRect(0, 0, W, H);
  const h = P.halsning; const f = clamp(Math.floor(lt * 30), 0, h.frames - 1);
  const img = R.clip['h' + f];
  if (img) { const push = 1 + 0.06 * sineInOut(clamp(lt / h.langd)); drawCover(img, 0.5, 0.5, push); }
  const gr = ctx.createLinearGradient(0, 1180, 0, H); gr.addColorStop(0, 'rgba(6,17,27,0)'); gr.addColorStop(0.6, 'rgba(6,17,27,0.62)'); gr.addColorStop(1, 'rgba(6,17,27,0.85)'); ctx.fillStyle = gr; ctx.fillRect(0, 1180, W, H - 1180);
  const t0 = 0.55; const ty = 1560;
  ctx.save(); const rp = expoOut(prog(lt, t0, 0.8)); ctx.fillStyle = C.red; ctx.fillRect(SAFE.x0, ty - 150, 52 * rp, 5); ctx.restore();
  const z = fitSize(P.gruppledare + ',', 800, BS, 760, 150, -0.01);
  letters(P.gruppledare + ',', SAFE.x0 - 4, ty, z, 800, BS, -0.01 * z, { t: lt, t0: t0 + 0.1, stagger: 0.04, dur: 0.85, rise: z * 0.9, blur: 12, mask: true });
  words('din gruppledare', SAFE.x0, ty + 70, 44, 600, OS, 0, { t: lt, t0: t0 + 0.55, stagger: 0.08, dur: 0.8, rise: 18, color: C.t2 });
}

// 7. Vi ses måndag. Ett kompakt block över den rena stenen, nedtonad mot marin
function sceneSee(lt) {
  const ef = R.img.nwE;
  drawCover(ef, 0.5, 0.55, 1.22 + 0.05 * sineInOut(clamp((lt + 0.3) / 5.3)));
  ctx.fillStyle = 'rgba(10,27,42,0.80)'; ctx.fillRect(0, 0, W, H);
  const gr = ctx.createLinearGradient(0, 0, W, H); gr.addColorStop(0, 'rgba(15,38,58,0.0)'); gr.addColorStop(1, 'rgba(6,17,27,0.55)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  const x = SAFE.x0;
  const s2 = P.startdag + '.';
  const z2 = fitSize(s2, 800, BS, 864, 330, -0.015);
  const z1 = Math.min(240, z2 * 0.78);
  const y1 = 700, y2 = y1 + z2 * 0.97;
  const push = 1 + 0.02 * sineInOut(prog(lt, 0, 5));
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(push, push); ctx.translate(-W / 2, -H / 2);
  letters('Vi ses', x - 4, y1, z1, 800, BS, -0.01 * z1, { t: lt, t0: -0.05, stagger: 0.04, dur: 0.85, rise: z1 * 0.95, blur: 12, mask: true });
  const last = [...s2].length - 1;
  letters(s2, x - 6, y2, z2, 800, BS, -0.015 * z2, { t: lt, t0: 0.2, stagger: 0.05, dur: 0.95, rise: z2 * 0.9, blur: 16, mask: true, color: i => i === last ? C.red : C.white });
  const lp = expoOut(prog(lt, 0.9, 1.0));
  ctx.fillStyle = 'rgba(134,174,176,0.45)'; ctx.fillRect(x, y2 + 80, 864 * lp, 2);
  let yy = y2 + 160;
  words(P.datumTid, x, yy, 50, 600, OS, 0, { t: lt, t0: 1.05, stagger: 0.07, dur: 0.8, rise: 20, color: C.white });
  yy += 68;
  words(P.platsText, x, yy, 46, 400, OS, 0, { t: lt, t0: 1.2, stagger: 0.06, dur: 0.8, rise: 20, color: C.t2 });
  yy += 100;
  words(P.gruppledare + ' möter dig.', x, yy, 54, 700, OS, 0, { t: lt, t0: 1.6, stagger: 0.09, dur: 0.85, rise: 22, color: C.vl });
  ctx.restore();
}

// 8. Slutbild
function sceneEnd(lt) {
  background(lt + 40, 30);
  const S = 128;
  drawLockup(W / 2, H * 0.47, S, lt, 0.45, { p: [prog(lt, 0.0, 0.8), prog(lt, 0.08, 0.8), prog(lt, 0.16, 0.8)] });
  setFont(600, 40, OS, 40 * 0.06); const s = 'nanostone.se'; const w = textW(s);
  words(s, W / 2 - w / 2, H * 0.47 + S / 2 + 110, 40, 600, OS, 40 * 0.06, { t: lt, t0: 0.8, stagger: 0, dur: 0.9, rise: 14, color: C.vl });
}

// ------------------------------------------------------------ tidslinje på takten
let P = null, SC = [];
const TD = 0.5, TPRE = 0.25; // övergången är ett slag lång och centrerad på scengränsen
function buildTimeline() {
  const T = P.takt; const beat = 60 / T.bpm; const sl = T.slag;
  const list = [['Bomärke', sl.bomarke, sceneMark], ['Namn', sl.namn, sceneName], ['Montage', P.montageSlag, sceneMontage],
    ['Karta', sl.karta, sceneMap], ['Före/efter', sl.fore_efter, sceneBeforeAfter]];
  if (P.halsning) list.push(['Hälsning', Math.ceil(P.halsning.langd / beat), sceneHalsning]);
  list.push(['Vi ses', sl.vi_ses, sceneSee], ['Slut', sl.slut, sceneEnd]);
  let b = 0; SC = list.map(([namn, slag, fn]) => { const o = { namn, start: b * beat, dur: slag * beat, slag0: b, slag, fn }; b += slag; return o; });
  window.duration = b * beat;
  window.timeline = SC.map(s => ({ namn: s.namn, start: +s.start.toFixed(2), slut: +(s.start + s.dur).toFixed(2), slag: s.slag0, antalSlag: s.slag }));
  // ljudhändelser för ljudbädden (rendera.js syntetiserar dem)
  const at = n => SC.find(s => s.namn === n);
  const ev = [{ typ: 'hit', t: 0.42, styrka: 1 }];
  SC.slice(1).forEach(s => ev.push({ typ: 'whoosh', t: s.start - TPRE, dur: TD, styrka: 0.8 }));
  const nm = at('Namn'); ev.push({ typ: 'spray', t0: nm.start + NW.TS, t1: nm.start + NW.TE, bana: NW.sprayPath.map(([t, x]) => [+(nm.start + t).toFixed(3), x]), bokstav: NW.L.map(l => [+(nm.start + l.t0).toFixed(3), +(nm.start + l.t0 + l.per).toFixed(3)]) });
  const mp = at('Karta'); ev.push({ typ: 'shimmer', t0: mp.start + T_CASC, t1: mp.start + T_CASC + 1.5 });
  const ba = at('Före/efter'); ev.push({ typ: 'whoosh', t: ba.start + 0.45, dur: 1.15, styrka: 0.45 });
  const hs = at('Hälsning'); if (hs) ev.push({ typ: 'riser', t1: hs.start - 0.05, dur: 1.6 });
  const en = at('Slut'); ev.push({ typ: 'hit', t: en.start + 0.45, styrka: 0.55 });
  ev.push({ typ: 'luft', t0: 0.1, t1: window.duration - 0.2, tyst: hs ? [hs.start - 0.2, hs.start + hs.dur + 0.1] : null });
  window.ljud = ev;
}
let ACC = null;
function fastAt(t) { // antal delbilder (rörelseoskärpa): fler där rörelsen är snabbast
  for (let i = 1; i < SC.length; i++) { const u = (t - (SC[i].start - TPRE)) / TD; if (u > -0.05 && u < 1.05) return u > 0.2 && u < 0.8 ? 10 : 6; }
  const m = SC.find(s => s.namn === 'Karta'); if (m) { const lt = t - m.start; if (lt > T_FLY0 && lt < T_FLY0 + T_FLY) { const u = (lt - T_FLY0) / T_FLY; return u > 0.2 && u < 0.8 ? 10 : 6; } }
  const ba = SC.find(s => s.namn === 'Före/efter'); if (ba) { const u = t - ba.start; if (u > 0.4 && u < 1.65) return [4, 0.18]; }
  const mo = SC.find(s => s.namn === 'Montage'); if (mo && P.montageSegs[0].typ === 'foto') { const u = t - mo.start; for (const s of P.montageSegs) if (Math.abs(u - s.start) < 0.2 && s.start > 0) return [6, 0.35]; }
  const nm = SC.find(s => s.namn === 'Namn'); if (nm) { const u = t - nm.start; if (u > NW.TS && u < NW.TE + 0.4) return [3, 0.5]; }
  if (t > 0.02 && t < 0.75) return 6;
  return 1;
}
function renderAt(t, opt = {}) {
  const fps = opt.fps || 30;
  let n = opt.sub != null ? opt.sub : fastAt(t), sh = 0.5;
  if (Array.isArray(n)) [n, sh] = n;
  if (n <= 1) { drawFrame(t); finish(t); fadeEdges(t); return n; }
  if (!ACC) ACC = offscreen(W, H);
  const a = ACC.getContext('2d');
  const shutter = sh / fps;
  for (let k = 0; k < n; k++) { drawFrame(t + shutter * ((k + 0.5) / n - 0.5)); a.globalAlpha = 1 / (k + 1); a.drawImage(cv, 0, 0); }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.drawImage(ACC, 0, 0); finish(t); fadeEdges(t); return n;
}
function fadeEdges(t) {
  const fin = clamp(t / 0.25), fout = 1 - prog(t, window.duration - 0.4, 0.4);
  const a = 1 - Math.min(fin, fout);
  if (a > 0) { ctx.fillStyle = `rgba(6,17,27,${a})`; ctx.fillRect(0, 0, W, H); }
}
function drawFrame(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  let i = SC.findIndex(s => t < s.start + s.dur); if (i < 0) i = SC.length - 1;
  const cur = SC[i], next = SC[i + 1];
  if (next && t >= next.start - TPRE) wipe((t - (next.start - TPRE)) / TD, () => cur.fn(t - cur.start), () => next.fn(t - next.start));
  else if (i > 0 && t < cur.start - TPRE + TD) { const prev = SC[i - 1]; wipe((t - (cur.start - TPRE)) / TD, () => prev.fn(t - prev.start), () => cur.fn(t - cur.start)); }
  else cur.fn(t - cur.start);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
/* Kontroll av att texterna får plats (körs efter init, med riktiga typsnitt). */
function validate() {
  const fel = [];
  if (NW.size * 1.36 < 190) fel.push(`förnamnet "${P.fornamn}" är för långt för namnscenen (max cirka 11 tecken)`);
  const zReg = fitSize(P.region, 800, BS, 864, 178, -0.01); if (zReg < 120) fel.push('regionnamnet är för långt');
  const zDay = fitSize(P.startdag + '.', 800, BS, 864, 330, -0.015); if (zDay < 200) fel.push('startdagen blir för liten');
  const zGl = fitSize(P.gruppledare + ',', 800, BS, 760, 150, -0.01); if (zGl < 110) fel.push(`gruppledarens namn "${P.gruppledare}" är för långt`);
  setFont(700, 54, OS, 0); if (textW(P.gruppledare + ' möter dig.') > 864) fel.push(`"${P.gruppledare} möter dig." får inte plats på en rad`);
  setFont(400, 46, OS, 0); if (textW(P.platsText) > 864) fel.push(`platsen "${P.platsText}" är för lång (max en rad, cirka 30 tecken)`);
  setFont(600, 50, OS, 0); if (textW(P.datumTid) > 864) fel.push('datum och tid får inte plats');
  return fel;
}
window.validate = () => validate();

// ------------------------------------------------------------ init
async function init(person) {
  P = person;
  R.meta = await (await fetch('assets/meta.json')).json();
  R.karta = await (await fetch('assets/karta.json')).json();
  const nb = R.meta.bilder[(P.takt.namnbild || 1) - 1], fb = R.meta.bilder[(P.takt.fore_efter || 3) - 1];
  const jobs = [loadImg('assets/ordbild.png').then(i => R.img.ordbild = i),
    loadImg(nb.fore).then(i => R.img.nwF = i), loadImg(nb.efter).then(i => R.img.nwE = i),
    loadImg(fb.fore).then(i => R.img.baF = i), loadImg(fb.efter).then(i => R.img.baE = i)];
  // montage: klipp (bildrutor laddas i prepare) eller reservfoton
  const beat = 60 / P.takt.bpm;
  if (P.montage && P.montage.length) {
    let b = 0; P.montageSegs = P.montage.map(m => { const slag = Math.max(2, Math.round(m.langd / beat)); const o = { typ: 'klipp', start: b * beat, dur: slag * beat, frames: m.frames, url: m.url }; b += slag; return o; });
    P.montageSlag = b;
  } else {
    const rs = R.meta.reservbilder || []; const slag = P.takt.slag.montage_reserv; const each = Math.floor(slag / rs.length);
    P.montageSegs = rs.map((r, k) => ({ typ: 'foto', start: k * each * beat, dur: (k === rs.length - 1 ? slag - each * k : each) * beat, fokus: r.fokus }));
    rs.forEach((r, k) => jobs.push(loadImg(r.fil).then(i => R.img['res' + k] = i)));
    P.montageSlag = slag;
  }
  const fonts = ['800 100px "BSD"', '700 100px "BSD"', '400 40px "OS"', '600 40px "OS"', '700 40px "OS"'];
  await Promise.all([...jobs, ...fonts.map(f => document.fonts.load(f, 'ÅÄÖåäö'))]);
  await document.fonts.ready;
  for (const f of fonts) if (!document.fonts.check(f, 'Åäö')) throw new Error('Typsnitt saknas: ' + f);
  buildStatic(); prepMap(); prepNameWash(); buildTimeline();
  return { duration: window.duration, timeline: window.timeline, ljud: window.ljud };
}
async function prepare(t) {
  if (!P) return;
  const need = [];
  const hs = SC.find(x => x.namn === 'Hälsning');
  if (hs) { const lt = t - hs.start; if (lt > -TPRE - 0.1 && lt < hs.dur + 0.4) { const f = clamp(Math.floor(lt * 30), 0, P.halsning.frames - 1); for (const g of [f - 1, f, f + 1]) if (g >= 0 && g < P.halsning.frames) need.push(['h' + g, P.halsning.url + String(g + 1).padStart(5, '0') + '.jpg']); } }
  const mo = SC.find(x => x.namn === 'Montage');
  if (mo && P.montageSegs[0].typ === 'klipp') {
    const lt = t - mo.start;
    P.montageSegs.forEach((s, k) => { const u = lt - s.start; if (u > -0.4 && u < s.dur + 0.4) { const f = clamp(Math.floor(u * 30), 0, s.frames - 1); for (const g of [f - 1, f, f + 1]) if (g >= 0 && g < s.frames) need.push(['m' + k + '_' + g, s.url + String(g + 1).padStart(5, '0') + '.jpg']); } });
  }
  const keep = new Set(need.map(n => n[0]));
  for (const [k, u] of need) if (!R.clip[k]) R.clip[k] = await loadImg(u);
  for (const k in R.clip) if (!keep.has(k)) delete R.clip[k];
}
window.init = init; window.renderAt = renderAt; window.prepare = prepare;
})();
