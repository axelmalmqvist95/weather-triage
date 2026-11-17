/* Välkomstfilm, Nanostone AB.
 * Hela filmen är en ren funktion av tiden: window.renderAt(t) ritar bildrutan för t sekunder.
 * Inga CSS-animationer, inga timers, ingen slump utom seedad PRNG. Allt ritas på en canvas 1080x1920.
 *
 * API (anropas av rendera.js):
 *   await window.init(person)   person = färdigformaterade texter från rendera.js
 *   window.duration             filmens längd i sekunder
 *   await window.prepare(t)     laddar det som behövs för t (hälsningsklippets bildruta)
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
// Beskurna grafiska motivet (inte logotypen): mittbandet och högra triangeln, som i trycksakernas sidhuvud
const STRIPE = MARK.stripe, TRI = MARK.triR;

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

// Stort beskuret bomärke i ljusare marin, som grafiskt ankare i nederkanten
function ghostMark(lt, x, y, S, alpha = 1) {
  const k = S / 208; const dx = -lt * 9 * DIR[0], dy = -lt * 9 * DIR[1];
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.fillStyle = '#163754'; poly(ctx, STRIPE, x + dx, y + dy, k); ctx.fill();
  ctx.fillStyle = '#132f48'; poly(ctx, TRI, x + dx * 1.6, y + dy * 1.6, k); ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------ övergång: diagonal ridå med röd kant
function wipe(p, drawOld, drawNew) {
  const e = quartInOut(clamp(p));
  const band = 150;
  const s = lerp(NMIN - band - 30, NMAX + 30, e);
  ctx.save(); ctx.translate(NRM[0] * e * 70, NRM[1] * e * 70); drawOld(); ctx.restore();
  // skugga framför ridån
  ctx.save(); bandPoly(ctx, s + band, s + band + 90);
  const gx0 = NRM[0] * (s + band), gy0 = NRM[1] * (s + band), gx1 = NRM[0] * (s + band + 90), gy1 = NRM[1] * (s + band + 90);
  const gr = ctx.createLinearGradient(gx0, gy0, gx1, gy1); gr.addColorStop(0, 'rgba(3,10,16,0.45)'); gr.addColorStop(1, 'rgba(3,10,16,0)');
  ctx.fillStyle = gr; ctx.fill(); ctx.restore();
  // ridån
  ctx.save(); bandPoly(ctx, s, s + band); ctx.fillStyle = C.n1; ctx.fill(); ctx.restore();
  // ny scen
  ctx.save(); bandPoly(ctx, -6000, s + 0.5); ctx.clip();
  ctx.translate(-NRM[0] * (1 - e) * 110, -NRM[1] * (1 - e) * 110); drawNew(); ctx.restore();
  // röd ledkant
  ctx.save(); ctx.strokeStyle = C.red; ctx.lineWidth = 5; lineAt(ctx, s + band - 2.5); ctx.stroke(); ctx.restore();
}

// ============================================================ SCENER
// Varje scen: draw(lt) ritar hela bilden för lokal tid lt (kan vara lite negativ under inkommande ridå).

// 1. Bomärket byggs
function sceneMark(lt) {
  background(lt);
  const S0 = 300, S1 = 156;
  const om = R.meta.ordbild;
  const m = heavy(prog(lt, 1.35, 1.0));
  const S = lerp(S0, S1, m);
  const total1 = (om.x0 + om.w) * S1 / om.h;
  const x = lerp(W / 2 - S0 / 2, W / 2 - total1 / 2, m), y = lerp(H * 0.47 - S0 / 2, H * 0.47 - S1 / 2, m);
  // svag glöd bakom märket när det landar
  const gl = prog(lt, 0.4, 0.8) * (1 - prog(lt, 1.2, 0.8));
  if (gl > 0) { ctx.save(); ctx.globalAlpha = gl * 0.25; ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(GLOW, x + S / 2 - S * 1.4, y + S / 2 - S * 1.4, S * 2.8, S * 2.8); ctx.restore(); }
  drawMark(x, y, S, [prog(lt, 0.18, 1.05), prog(lt, 0.3, 1.05), prog(lt, 0.42, 1.05)]);
  if (lt > 1.6) {
    const k = S1 / om.h, wx = x + om.x0 * k, ww = om.w * k;
    const p = prog(lt, 1.75, 0.95), e = expoOut(p);
    const edge = lerp(-0.2, 1.25, e);
    ctx.save(); ctx.beginPath(); ctx.moveTo(wx - 40, y - 10); ctx.lineTo(wx + ww * edge + S1 * 0.58, y - 10); ctx.lineTo(wx + ww * edge, y + S1 + 10); ctx.lineTo(wx - 40, y + S1 + 10); ctx.closePath(); ctx.clip();
    ctx.globalAlpha = clamp(p * 1.6); ctx.filter = blurF((1 - e) * 6);
    ctx.drawImage(R.img.ordbild, wx - 30 * (1 - e), y, ww, S1);
    ctx.restore(); ctx.filter = 'none';
  }
  // diskret säsongsrad under loggan
  if (lt > 2.2) { setFont(600, 31, OS, 31 * 0.28); const s = P.sasong; const w = textW(s); kicker(s, W / 2 - w / 2, H * 0.47 + S1 / 2 + 100, lt, 2.25, C.vl, 31); }
}

// 2. Välkommen, Erik.
function sceneHello(lt) {
  background(lt + 4);
  ghostMark(lt, 470, 1290, 900, clamp(prog(lt, -0.3, 1.2)));
  const x = SAFE.x0;
  const s1 = 'Välkommen,';
  const z1 = fitSize(s1, 800, BS, 864, 236, -0.01);
  const name = P.fornamn + '.';
  const z2 = fitSize(name, 800, BS, 864, 430, -0.015);
  const yTop = 760 - (z2 - 300) * 0.35;
  const push = 1 + 0.025 * sineInOut(prog(lt, 0, 3.8));
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(push, push); ctx.translate(-W / 2, -H / 2);
  letters(s1, x - 4, yTop, z1, 800, BS, -0.01 * z1, { t: lt, t0: 0.08, stagger: 0.03, dur: 0.85, rise: z1 * 0.95, blur: 12, mask: true });
  const y2 = yTop + z2 * 0.98;
  const last = [...name].length - 1;
  letters(name, x - 6, y2, z2, 800, BS, -0.015 * z2, { t: lt, t0: 0.45, stagger: 0.055, dur: 0.95, rise: z2 * 0.9, blur: 16, mask: true, color: i => i === last ? C.red : C.white });
  words(P.subline, x, y2 + 118, 46, 600, OS, 0, { t: lt, t0: 1.3, stagger: 0.075, dur: 0.8, rise: 22, color: C.t2 });
  ctx.restore();
}

// 3. Kartan
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
const T_FLY0 = 2.55, T_FLY = 2.5, T_CASC = 4.55;
function camAt(lt) {
  const a = fullView(), b = regionView();
  const f = heavy(prog(lt, T_FLY0, T_FLY));
  const zi = zoomInterp([a.cx, a.cy, W / a.k], [b.cx, b.cy, W / b.k]);
  const [ux, uy, w] = zi(f);
  // långsam fortsatt inzoomning efter landning så bilden lever
  const drift = 1 + 0.035 * sineInOut(prog(lt, T_FLY0 + T_FLY - 0.2, 3.5));
  return { cx: ux, cy: uy, k: W / w * drift, sy: lerp(a.sy, b.sy, f) };
}
function sceneMap(lt) {
  background(lt + 8, -120);
  const cam = camAt(lt);
  const fly = prog(lt, T_FLY0, T_FLY);
  const z = cam.k / fullView().k;
  // grannländer (mörkare, ger sammanhang: Danmark, Norge, Finland ...)
  const nb = clamp(prog(lt, 0.9, 1.2) * 0.55 + fly * 0.45);
  if (nb > 0) {
    ctx.save(); ctx.globalAlpha = nb;
    ctx.beginPath(); for (const c of ['NO', 'FI', 'DK', 'DE', 'PL', 'EE', 'LV', 'LT']) MAP.land[c].forEach(r => ringPath(r, cam));
    ctx.fillStyle = '#122c41'; ctx.fill('nonzero');
    ctx.lineWidth = 1.1; ctx.strokeStyle = 'rgba(84,140,145,0.32)'; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
  }
  // Sverige: fyllning tonar in när konturen ritats
  const fillA = prog(lt, 1.15, 1.1);
  ctx.save(); ctx.beginPath(); MAP.se.forEach(o => ringPath(o.r, cam));
  if (fillA > 0) { ctx.globalAlpha = fillA; ctx.fillStyle = '#1c4260'; ctx.fill(); }
  ctx.restore();
  // inre länsgränser, svaga
  const lanA = prog(lt, 1.6, 0.9) * 0.55;
  if (lanA > 0) {
    ctx.save(); ctx.beginPath(); MAP.se.forEach(o => ringPath(o.r, cam)); ctx.clip();
    ctx.beginPath(); for (const s of MAP.inner) { ctx.moveTo(W / 2 + (s[0] - cam.cx) * cam.k, cam.sy + (s[1] - cam.cy) * cam.k); ctx.lineTo(W / 2 + (s[2] - cam.cx) * cam.k, cam.sy + (s[3] - cam.cy) * cam.k); }
    ctx.globalAlpha = lanA; ctx.strokeStyle = '#4f7a8c'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]); ctx.stroke();
    ctx.restore();
  }
  // konturen ritas fram (stroke reveal), största ringen först, öar tonar in
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = C.vl;
  ctx.lineWidth = lerp(1.7, 2.2, clamp(fly));
  const draw = quartInOut(prog(lt, -0.15, 1.9));
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
  const dimIn = prog(lt, 1.5, 1.1);
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
      const q = prog(lt, T_CASC + Math.min(1, d / maxD) * 1.45 + p.j * 0.14, 0.55);
      if (q > 0) { const e = expoOut(q); a = lerp(a, 0.9, e); gl = 0.16 + 0.75 * Math.pow(1 - q, 2); sz = p.s * (0.7 + 0.3 * e + 0.6 * Math.pow(1 - q, 3)); }
    }
    if (a <= 0.003) continue;
    if (gl > 0) { ctx.globalAlpha = gl * 0.45; const g = glowR * sz; ctx.drawImage(GLOW, X - g, Y - g, g * 2, g * 2); }
    ctx.globalAlpha = a; const c = coreR * sz * 1.9; ctx.drawImage(CORE, X - c, Y - c, c * 2, c * 2);
  }
  ctx.restore();
  // rubrik över hela landet
  const outA = 1 - prog(lt, T_FLY0 + 0.1, 0.6);
  if (outA > 0) {
    ctx.save(); ctx.globalAlpha = outA;
    kicker('HÄR JOBBAR VI', SAFE.x0, 262, lt, 0.05, C.vl, 34);
    ctx.restore();
  }
  // regionens namn
  const ty = 1560;
  // läsbarhet: mjuk mörk ton bakom texten
  const sh = prog(lt, T_FLY0 + 1.2, 1.2);
  if (sh > 0) { const gr = ctx.createLinearGradient(0, 1080, 0, H); gr.addColorStop(0, 'rgba(6,17,27,0)'); gr.addColorStop(0.3, `rgba(6,17,27,${0.72 * sh})`); gr.addColorStop(1, `rgba(6,17,27,${0.9 * sh})`); ctx.fillStyle = gr; ctx.fillRect(0, 1080, W, H - 1080); }
  const t0 = T_FLY0 + T_FLY - 0.55;
  if (lt > t0) {
    ctx.save(); const rp = expoOut(prog(lt, t0, 0.8)); ctx.fillStyle = C.red; ctx.fillRect(SAFE.x0, ty - 214, 52 * rp, 5); ctx.restore();
    kicker('DITT OMRÅDE', SAFE.x0 + 70, ty - 200, lt, t0 + 0.1, C.t2, 34);
    const z = fitSize(P.region, 800, BS, 864, 178, -0.01);
    letters(P.region, SAFE.x0 - 4, ty, z, 800, BS, -0.01 * z, { t: lt, t0: t0 + 0.2, stagger: 0.035, dur: 0.9, rise: z * 0.9, blur: 12, mask: true });
    words('Varje ljuspunkt är ett jobb vi har gjort.', SAFE.x0, ty + 86, 40, 400, OS, 0, { t: lt, t0: t0 + 0.9, stagger: 0.05, dur: 0.8, rise: 16, color: C.t2 });
  }
}

// 4. Det här gör vi: före/efter
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
const PANEL = 8 / 3;
function scenePhotos(lt) {
  const n = R.meta.bilder.length;
  const idx = clamp(Math.floor((lt + 0.32) / PANEL), 0, n - 1);
  const drawPanel = (i, u) => {
    const b = R.meta.bilder[i]; const fo = R.img['f' + i], ef = R.img['e' + i];
    const kb = sineInOut(clamp((u + 0.6) / (PANEL + 0.9)));
    const [fx, fy] = b.fokus;
    drawPhoto(fo, fx, fy, kb);
    const wp = sineInOut(prog(u, 0.6, 1.2));
    const s = lerp(NMIN - 20, NMAX + 20, wp);
    if (wp > 0) {
      ctx.save(); bandPoly(ctx, -6000, s); ctx.clip(); drawPhoto(ef, fx, fy, kb); ctx.restore();
      if (wp < 1) {
        // tunn röd kant med mjuk ljuskant
        ctx.save(); ctx.strokeStyle = 'rgba(6,17,27,0.35)'; ctx.lineWidth = 14; ctx.filter = 'blur(7px)'; lineAt(ctx, s + 6); ctx.stroke(); ctx.restore();
        ctx.save(); ctx.strokeStyle = C.red; ctx.lineWidth = 6; lineAt(ctx, s); ctx.stroke(); ctx.restore();
      }
    }
    // tonplattor för läsbarhet
    let gr = ctx.createLinearGradient(0, 0, 0, 420); gr.addColorStop(0, 'rgba(6,17,27,0.55)'); gr.addColorStop(1, 'rgba(6,17,27,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, 420);
    gr = ctx.createLinearGradient(0, 1150, 0, H); gr.addColorStop(0, 'rgba(6,17,27,0)'); gr.addColorStop(0.55, 'rgba(6,17,27,0.62)'); gr.addColorStop(1, 'rgba(6,17,27,0.86)'); ctx.fillStyle = gr; ctx.fillRect(0, 1150, W, H - 1150);
    // FÖRE / EFTER: varje etikett lever på sin sida av torkkanten
    // etiketterna byter när torkkanten passerat: FÖRE tonar ut före kanten, EFTER glider in efter den
    const sNow = wp > 0 ? s : NMIN - 400;
    const fa = clamp(prog(u, 0.12, 0.45)) * clamp((560 - sNow) / 160);
    const ea = expoOut(clamp((sNow - 300) / 260));
    if (fa > 0) { ctx.save(); ctx.globalAlpha = fa; ctx.translate(-14 * (1 - fa), 0); chip('FÖRE', SAFE.x1, 250, 'right', 'rgba(6,17,27,0.72)'); ctx.restore(); }
    if (ea > 0) { ctx.save(); ctx.globalAlpha = clamp(ea * 1.5); ctx.translate(-30 * (1 - ea), 0); chip('EFTER', SAFE.x0 + 30, 250, 'left', C.red); ctx.restore(); }
    // tjänst
    const z = fitSize(b.tjanst, 800, BS, 864, 200, -0.01);
    letters(b.tjanst, SAFE.x0 - 4, 1590, z, 800, BS, -0.01 * z, { t: u, t0: 0.12, stagger: 0.035, dur: 0.8, rise: z * 0.9, blur: 12, mask: true });
  };
  const drawAt = i => drawPanel(i, lt - i * PANEL);
  // byte mellan bildpar med samma diagonala ridå
  const tb = idx * PANEL;
  if (idx > 0 && lt < tb + 0.42) wipe(prog(lt, tb - 0.32, 0.74), () => drawAt(idx - 1), () => drawAt(idx));
  else drawAt(idx);
  // fast rubrik för hela scenen
  kicker('DET HÄR GÖR VI', SAFE.x0, 1590 - fitSize(R.meta.bilder[idx].tjanst, 800, BS, 864, 200, -0.01) * 0.92 - 4, lt, 0.2, C.t2, 32);
}

// 5. Din första vecka: redaktionell kalender, stora datumsiffror
const WEEK = { x0: 108, tx: 336, tw: 636, size: 42, lh: 56 };
function weekRows() {
  setFont(400, WEEK.size, OS, 0);
  return P.dagar.map(d => { const lines = wrap(d.text, WEEK.tw); return { ...d, lines, h: Math.max(200, 96 + lines.length * WEEK.lh) }; });
}
function sceneWeek(lt) {
  background(lt + 20, 140);
  ghostMark(lt, 640, 1560, 520, 0.7 * clamp(prog(lt, -0.3, 1.2)));
  kicker(P.veckaText, SAFE.x0, 372, lt, 0.15, C.vl, 34);
  letters('Din första vecka', SAFE.x0 - 4, 520, 150, 800, BS, -1.5, { t: lt, t0: 0.22, stagger: 0.022, dur: 0.85, rise: 130, blur: 12, mask: true });
  let y = 640;
  weekRows().forEach((d, i) => {
    const t0 = 0.85 + i * 0.42;
    const p = prog(lt, t0, 1.1); const e = expoOut(p);
    if (p > 0) {
      // hårlinje som ritas fram, röd markering på första dagen
      ctx.save(); ctx.fillStyle = 'rgba(134,174,176,0.32)'; ctx.fillRect(WEEK.x0, y, 864 * e, 2);
      if (i === 0) { ctx.fillStyle = C.red; ctx.fillRect(WEEK.x0, y - 1, 64 * expoOut(prog(lt, t0 + 0.25, 0.8)), 4); }
      ctx.restore();
      const off = 260 * (1 - e);
      ctx.save(); ctx.translate(DIR[0] * off * 0.35, DIR[1] * off * 0.35);
      letters(d.nr, WEEK.x0 - 6, y + 178, 168, 800, BS, -2, { t: lt, t0: t0 + 0.05, stagger: 0.07, dur: 0.95, rise: 150, blur: 14, mask: true });
      kicker(d.veckodag, WEEK.tx, y + 64, lt, t0 + 0.2, i === 0 ? C.white : C.vl, 32);
      d.lines.forEach((ln, j) => words(ln, WEEK.tx, y + 64 + 62 + j * WEEK.lh, WEEK.size, 400, OS, 0, { t: lt, t0: t0 + 0.38 + j * 0.1, stagger: 0.04, dur: 0.75, rise: 18, color: C.t2 }));
      ctx.restore();
    }
    y += d.h + 34;
  });
}

// 5b. Hälsning från gruppledaren (valfri)
function sceneHalsning(lt) {
  ctx.fillStyle = C.n1; ctx.fillRect(0, 0, W, H);
  const h = P.halsning; const f = clamp(Math.floor(lt * 30), 0, h.frames - 1);
  const img = R.clip[f];
  if (img) {
    const push = 1 + 0.06 * sineInOut(clamp(lt / h.langd));
    const s = (W / img.width) * push; const w = img.width * s, hh = img.height * s;
    ctx.drawImage(img, (W - w) / 2, (H - hh) / 2, w, hh);
  }
  const gr = ctx.createLinearGradient(0, 1180, 0, H); gr.addColorStop(0, 'rgba(6,17,27,0)'); gr.addColorStop(0.6, 'rgba(6,17,27,0.62)'); gr.addColorStop(1, 'rgba(6,17,27,0.85)'); ctx.fillStyle = gr; ctx.fillRect(0, 1180, W, H - 1180);
  const t0 = 0.55; const ty = 1560;
  ctx.save(); const rp = expoOut(prog(lt, t0, 0.8)); ctx.fillStyle = C.red; ctx.fillRect(SAFE.x0, ty - 150, 52 * rp, 5); ctx.restore();
  const z = fitSize(P.gruppledare + ',', 800, BS, 760, 150, -0.01);
  letters(P.gruppledare + ',', SAFE.x0 - 4, ty, z, 800, BS, -0.01 * z, { t: lt, t0: t0 + 0.1, stagger: 0.04, dur: 0.85, rise: z * 0.9, blur: 12, mask: true });
  words('din gruppledare', SAFE.x0, ty + 70, 44, 600, OS, 0, { t: lt, t0: t0 + 0.55, stagger: 0.08, dur: 0.8, rise: 18, color: C.t2 });
}

// 6. Vi ses måndag.
function sceneSee(lt) {
  background(lt + 30, 60);
  ghostMark(lt, 560, 1420, 760, clamp(prog(lt, -0.3, 1.2)));
  const x = SAFE.x0;
  const s1 = 'Vi ses';
  const s2 = P.startdag + '.';
  const z2 = fitSize(s2, 800, BS, 864, 330, -0.015);
  const z1 = Math.min(240, z2 * 0.78);
  const y1 = 640, y2 = y1 + z2 * 0.97;
  const push = 1 + 0.02 * sineInOut(prog(lt, 0, 4.2));
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(push, push); ctx.translate(-W / 2, -H / 2);
  letters(s1, x - 4, y1, z1, 800, BS, -0.01 * z1, { t: lt, t0: 0.06, stagger: 0.04, dur: 0.85, rise: z1 * 0.95, blur: 12, mask: true });
  const last = [...s2].length - 1;
  letters(s2, x - 6, y2, z2, 800, BS, -0.015 * z2, { t: lt, t0: 0.3, stagger: 0.05, dur: 0.95, rise: z2 * 0.9, blur: 16, mask: true, color: i => i === last ? C.red : C.white });
  // linje
  const lp = expoOut(prog(lt, 1.05, 1.0));
  ctx.fillStyle = 'rgba(134,174,176,0.45)'; ctx.fillRect(x, y2 + 80, 864 * lp, 2);
  let yy = y2 + 160;
  words(P.datumTid, x, yy, 50, 600, OS, 0, { t: lt, t0: 1.2, stagger: 0.07, dur: 0.8, rise: 20, color: C.white });
  yy += 68;
  words(P.platsText, x, yy, 46, 400, OS, 0, { t: lt, t0: 1.38, stagger: 0.06, dur: 0.8, rise: 20, color: C.t2 });
  yy += 118;
  words(P.gruppledare + ' möter dig.', x, yy, 54, 700, OS, 0, { t: lt, t0: 1.85, stagger: 0.09, dur: 0.85, rise: 22, color: C.vl });
  ctx.restore();
}

// 7. Slutbild
function sceneEnd(lt) {
  background(lt + 40, 30);
  const om = R.meta.ordbild; const S = 128;
  drawLockup(W / 2, H * 0.47, S, lt, 0.55, { p: [prog(lt, 0.08, 0.9), prog(lt, 0.18, 0.9), prog(lt, 0.28, 0.9)] });
  setFont(600, 40, OS, 40 * 0.06); const s = 'nanostone.se'; const w = textW(s);
  words(s, W / 2 - w / 2, H * 0.47 + S / 2 + 110, 40, 600, OS, 40 * 0.06, { t: lt, t0: 1.0, stagger: 0, dur: 0.9, rise: 14, color: C.vl });
}

// ------------------------------------------------------------ tidslinje
let P = null, SC = [];
const TD = 0.74, TPRE = 0.32; // ridåns längd och hur långt före scengränsen den startar
function buildTimeline() {
  const list = [
    ['Bomärke', 3.5, sceneMark],
    ['Välkommen', 3.5, sceneHello],
    ['Karta', 7.6, sceneMap],
    ['Det här gör vi', 8.0, scenePhotos],
    ['Din första vecka', 6.6, sceneWeek],
  ];
  if (P.halsning) list.push(['Hälsning', P.halsning.langd + 0.1, sceneHalsning]);
  list.push(['Vi ses', 4.2, sceneSee], ['Slut', 3.0, sceneEnd]);
  let t = 0; SC = list.map(([namn, dur, fn]) => { const o = { namn, start: t, dur, fn }; t += dur; return o; });
  window.duration = t;
  window.timeline = SC.map(s => ({ namn: s.namn, start: +s.start.toFixed(2), slut: +(s.start + s.dur).toFixed(2) }));
}
/* Rörelseoskärpa: under snabba rörelser (ridåer, kartflygning, torkningar, snabba textintåg) ritas
 * flera delbilder inom en halv bildrutas slutartid och medelvärdesbildas. Kornet läggs på efteråt. */
let ACC = null;
function fastAt(t) { // antal delbilder: fler där rörelsen är snabbast så att oskärpan blir slät, inte stroboskopisk
  for (let i = 1; i < SC.length; i++) { const b = SC[i].start; const u = (t - (b - TPRE)) / TD; if (u > -0.03 && u < 1.03) return u > 0.2 && u < 0.8 ? 10 : 5; }
  const m = SC.find(s => s.namn === 'Karta'); if (m) { const lt = t - m.start; if (lt > T_FLY0 && lt < T_FLY0 + T_FLY) { const u = (lt - T_FLY0) / T_FLY; return u > 0.2 && u < 0.8 ? 10 : 5; } }
  const ph = SC.find(s => s.namn === 'Det här gör vi');
  if (ph) { const lt = t - ph.start; for (let k = 0; k < 3; k++) { const u = lt - k * PANEL; if (u > 0.6 && u < 1.8) return [4, 0.18]; } }
  const mk = SC[0]; if (t - mk.start > 0.15 && t - mk.start < 1.1) return 6;
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
  for (let k = 0; k < n; k++) {
    drawFrame(t + shutter * ((k + 0.5) / n - 0.5));
    a.globalAlpha = 1 / (k + 1); a.drawImage(cv, 0, 0);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.drawImage(ACC, 0, 0); finish(t); fadeEdges(t); return n;
}
function fadeEdges(t) {
  const fin = clamp(t / 0.35), fout = 1 - prog(t, window.duration - 0.45, 0.45);
  const a = 1 - Math.min(fin, fout);
  if (a > 0) { ctx.fillStyle = `rgba(6,17,27,${a})`; ctx.fillRect(0, 0, W, H); }
}
function drawFrame(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  let i = SC.findIndex(s => t < s.start + s.dur); if (i < 0) i = SC.length - 1;
  const cur = SC[i], next = SC[i + 1];
  if (next && t >= next.start - TPRE) {
    wipe((t - (next.start - TPRE)) / TD, () => cur.fn(t - cur.start), () => next.fn(t - next.start));
  } else if (i > 0 && t < cur.start - TPRE + TD) {
    const prev = SC[i - 1];
    wipe((t - (cur.start - TPRE)) / TD, () => prev.fn(t - prev.start), () => cur.fn(t - cur.start));
  } else cur.fn(t - cur.start);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
/* Kontroll av att texterna får plats i layouten (körs efter init, med riktiga typsnitt). */
function validate() {
  const fel = [];
  const zName = fitSize(P.fornamn + '.', 800, BS, 864, 430, -0.015);
  if (zName < 230) fel.push(`förnamnet "${P.fornamn}" är för långt för rubriken (max cirka 9 tecken)`);
  const zReg = fitSize(P.region, 800, BS, 864, 178, -0.01); if (zReg < 120) fel.push('regionnamnet är för långt');
  const zDay = fitSize(P.startdag + '.', 800, BS, 864, 330, -0.015); if (zDay < 200) fel.push('startdagen blir för liten');
  const zGl = fitSize(P.gruppledare + ',', 800, BS, 760, 150, -0.01); if (zGl < 110) fel.push(`gruppledarens namn "${P.gruppledare}" är för långt`);
  setFont(700, 54, OS, 0); if (textW(P.gruppledare + ' möter dig.') > 864) fel.push(`"${P.gruppledare} möter dig." får inte plats på en rad`);
  setFont(400, 46, OS, 0); if (textW(P.platsText) > 864) fel.push(`platsen "${P.platsText}" är för lång (max en rad, cirka 30 tecken)`);
  setFont(600, 50, OS, 0); if (textW(P.datumTid) > 864) fel.push('datum och tid får inte plats');
  weekRows().forEach((d, i) => { if (d.lines.length > 3) fel.push(`dag${i + 1}: texten "${d.text}" blir ${d.lines.length} rader, max 3 (korta texten)`); });
  return fel;
}
window.validate = () => validate();

// ------------------------------------------------------------ init
async function init(person) {
  P = person;
  R.meta = await (await fetch('assets/meta.json')).json();
  R.karta = await (await fetch('assets/karta.json')).json();
  const jobs = [loadImg('assets/ordbild.png').then(i => R.img.ordbild = i)];
  R.meta.bilder.forEach((b, i) => { jobs.push(loadImg(b.fore).then(x => R.img['f' + i] = x)); jobs.push(loadImg(b.efter).then(x => R.img['e' + i] = x)); });
  const fonts = ['800 100px "BSD"', '700 100px "BSD"', '400 40px "OS"', '600 40px "OS"', '700 40px "OS"'];
  await Promise.all([...jobs, ...fonts.map(f => document.fonts.load(f, 'ÅÄÖåäö'))]);
  await document.fonts.ready;
  for (const f of fonts) if (!document.fonts.check(f, 'Åäö')) throw new Error('Typsnitt saknas: ' + f);
  buildStatic(); prepMap(); buildTimeline();
  return { duration: window.duration, timeline: window.timeline };
}
async function prepare(t) {
  if (!P || !P.halsning) return;
  const s = SC.find(x => x.namn === 'Hälsning'); if (!s) return;
  const lt = t - s.start;
  if (lt < -TPRE - 0.1 || lt > s.dur + 0.5) return;
  const f = clamp(Math.floor(lt * 30), 0, P.halsning.frames - 1);
  for (const g of [f - 1, f, f + 1]) {
    if (g < 0 || g >= P.halsning.frames || R.clip[g]) continue;
    R.clip[g] = await loadImg(P.halsning.url + String(g + 1).padStart(5, '0') + '.jpg');
  }
  for (const k in R.clip) if (+k < f - 3) delete R.clip[k];
}
window.init = init; window.renderAt = renderAt; window.prepare = prepare;
})();
