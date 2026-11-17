/* Syntetisk ljudbädd för välkomstfilmen. Deterministisk (seedat brus), 48 kHz stereo, skrivs som WAV.
 * Händelserna kommer från film.js (window.ljud): basslag på bomärket, vinddrag (whoosh) på övergångar,
 * högtryckstvätt synkad med namnscenen (panorerad efter munstycket), glitter när kartans punkter tänds,
 * en stigande ton in i hälsningen. Allt hålls lågt; den slutliga loudness-normaliseringen sker i rendera.js. */
'use strict';
const fs = require('fs');
const SR = 48000;

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

class Biquad { // RBJ-filter, koefficienter kan uppdateras löpande
  constructor(type, f, q) { this.type = type; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(f, q); }
  set(f, q) {
    const w = 2 * Math.PI * Math.min(f, SR * 0.45) / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    let b0, b1, b2; const a0 = 1 + al;
    if (this.type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else if (this.type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
  }
  p(x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
}
const noise = seed => { const r = mulberry32(seed); return () => r() * 2 - 1; };
function add(L, R, i, v, pan) { if (i < 0 || i >= L.length) return; const a = (pan + 1) * Math.PI / 4; L[i] += v * Math.cos(a); R[i] += v * Math.sin(a); }

function hit(L, R, ev, k) {
  const g = 0.55 * (ev.styrka ?? 1); const i0 = Math.round(ev.t * SR); const n = Math.round(1.6 * SR);
  const nz = noise(100 + k), lp = new Biquad('lp', 160, 0.7); let ph = 0;
  for (let j = 0; j < n; j++) {
    const tau = j / SR; const f = 41 + 36 * Math.exp(-tau / 0.07); ph += 2 * Math.PI * f / SR;
    const env = Math.exp(-tau / 0.55) * (1 - Math.exp(-tau / 0.004));
    const thump = lp.p(nz()) * Math.exp(-tau / 0.045) * 1.6;
    add(L, R, i0 + j, g * (Math.sin(ph) * env + thump), 0);
  }
}
function whoosh(L, R, ev, k) {
  const g = 0.28 * (ev.styrka ?? 1); const pre = 0.18, len = ev.dur + 0.42; const i0 = Math.round((ev.t - pre) * SR); const n = Math.round(len * SR);
  const nz = noise(200 + k), bp = new Biquad('bp', 300, 0.9), lp = new Biquad('lp', 420, 0.7);
  for (let j = 0; j < n; j++) {
    const x = j / n; if (j % 32 === 0) bp.set(260 * Math.pow(2600 / 260, Math.pow(x, 0.8)), 0.9);
    const env = Math.pow(Math.sin(Math.PI * Math.pow(x, 0.85)), 2);
    const s = nz(); const v = (bp.p(s) * 1.0 + lp.p(s) * 0.35) * env;
    add(L, R, i0 + j, g * v, -0.55 + 1.1 * x);
  }
}
function spray(L, R, ev) {
  const t0 = ev.t0 - 0.05, t1 = ev.t1 + 0.3; const i0 = Math.round(t0 * SR), n = Math.round((t1 - t0) * SR);
  const nz1 = noise(301), nz2 = noise(302), nz3 = noise(303), nz4 = noise(304);
  const hp1 = new Biquad('hp', 2400, 0.7), hp2 = new Biquad('hp', 2400, 0.7), lp1 = new Biquad('lp', 9500, 0.7);
  const bpW = new Biquad('bp', 850, 0.8), bpS = new Biquad('bp', 3600, 1.8), crk = new Biquad('lp', 35, 0.7), rum = new Biquad('lp', 160, 0.7);
  const r = mulberry32(305); const ph = [r(), r(), r()].map(x => x * 6.28);
  const bana = ev.bana; let bi = 0;
  let gate = 0;
  for (let j = 0; j < n; j++) {
    const t = t0 + j / SR;
    const on = ev.bokstav.some(([a, b]) => t >= a && t <= b) ? 1 : 0;
    gate += (on - gate) * (on > gate ? 1 / (0.025 * SR) : 1 / (0.09 * SR));
    gate = clamp(gate);
    while (bi < bana.length - 1 && bana[bi + 1][0] < t) bi++;
    const x = bana.length ? (bi < bana.length - 1 ? bana[bi][1] + (bana[bi + 1][1] - bana[bi][1]) * clamp((t - bana[bi][0]) / Math.max(1e-3, bana[bi + 1][0] - bana[bi][0])) : bana[bi][1]) : 0.5;
    const pan = clamp((x - 0.5) * 1.3, -0.8, 0.8);
    const am = 0.72 + 0.12 * Math.sin(2 * Math.PI * 11.3 * t + ph[0]) + 0.09 * Math.sin(2 * Math.PI * 17.9 * t + ph[1]) + 0.07 * Math.sin(2 * Math.PI * 29.1 * t + ph[2]);
    const hiss = lp1.p(hp2.p(hp1.p(nz1()))) * 0.11;
    const water = bpW.p(nz2()) * 0.16 * am;
    const c = crk.p(Math.abs(nz4())); const splat = bpS.p(nz3()) * 0.07 * (0.4 + 4 * c);
    const body = rum.p(nz2()) * 0.05;
    add(L, R, i0 + j, 2.0 * gate * (hiss + water + splat + body), pan);
  }
}
function shimmer(L, R, ev) {
  const r = mulberry32(401); const notes = [1318.5, 1568, 1760, 1975.5, 2349.3, 2637]; const cnt = 13;
  const tl = [...Array(cnt)].map(() => ev.t0 + (ev.t1 - ev.t0) * Math.pow(r(), 0.8)).sort((a, b) => a - b);
  const dl = Math.round(0.113 * SR), dr = Math.round(0.157 * SR); const tmpL = new Float32Array(L.length), tmpR = new Float32Array(R.length);
  tl.forEach((t, k) => {
    const f = notes[Math.floor(r() * notes.length)] * (1 + (r() - 0.5) * 0.004); const pan = (r() - 0.5) * 1.0; const g = 0.03 * (0.6 + r() * 0.4);
    const i0 = Math.round(t * SR), n = Math.round(1.2 * SR);
    for (let j = 0; j < n; j++) { const tau = j / SR; const env = Math.exp(-tau / 0.42) * (1 - Math.exp(-tau / 0.006)); const v = (Math.sin(2 * Math.PI * f * tau) + 0.25 * Math.sin(2 * Math.PI * 2 * f * tau)) * env * g; add(tmpL, tmpR, i0 + j, v, pan); }
  });
  for (let i = 0; i < L.length; i++) { // enkel stereoeko som rum
    if (i >= dl) tmpL[i] += tmpR[i - dl] * 0.33; if (i >= dr) tmpR[i] += tmpL[i - dr] * 0.33;
    L[i] += tmpL[i]; R[i] += tmpR[i];
  }
}
function riser(L, R, ev) {
  const len = ev.dur; const i0 = Math.round((ev.t1 - len) * SR), n = Math.round(len * SR);
  const nz = noise(501), bp = new Biquad('bp', 300, 1.4); let ph = 0;
  for (let j = 0; j < n; j++) {
    const x = j / n; if (j % 32 === 0) bp.set(280 * Math.pow(3800 / 280, x), 1.4);
    const env = Math.pow(x, 2.2) * (1 - Math.pow(clamp((x - 0.96) / 0.04), 2));
    const f = 110 * Math.pow(2, x); ph += 2 * Math.PI * f / SR;
    add(L, R, i0 + j, (bp.p(nz()) * 0.15 + Math.sin(ph) * 0.025) * env, 0);
  }
}

function luft(L, R, ev) { // mycket svag rumston/luft så att filmen aldrig blir helt död, sänks under hälsningen
  const nzL = noise(601), nzR = noise(602); const lpL = new Biquad('lp', 650, 0.7), lpR = new Biquad('lp', 650, 0.7), hpL = new Biquad('hp', 70, 0.7), hpR = new Biquad('hp', 70, 0.7);
  const i0 = Math.round(ev.t0 * SR), i1 = Math.round(ev.t1 * SR);
  for (let i = i0; i < i1 && i < L.length; i++) {
    const t = i / SR; let g = 0.022 * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.11 * t)) * clamp((t - ev.t0) / 1.0) * clamp((ev.t1 - t) / 1.5);
    if (ev.tyst) g *= 1 - clamp(Math.min((t - ev.tyst[0]) / 0.4, (ev.tyst[1] - t) / 0.4));
    L[i] += g * hpL.p(lpL.p(nzL())); R[i] += g * hpR.p(lpR.p(nzR()));
  }
}
function syntes(events, duration, ut) {
  const n = Math.round(duration * SR); const L = new Float32Array(n), R = new Float32Array(n);
  events.forEach((ev, k) => {
    if (ev.typ === 'hit') hit(L, R, ev, k);
    else if (ev.typ === 'whoosh') whoosh(L, R, ev, k);
    else if (ev.typ === 'spray') spray(L, R, ev);
    else if (ev.typ === 'shimmer') shimmer(L, R, ev);
    else if (ev.typ === 'riser') riser(L, R, ev);
    else if (ev.typ === 'luft') luft(L, R, ev);
  });
  // mjuk in-/uttoning i början och slutet, 24-bitars WAV
  for (let i = 0; i < 480 && i < n; i++) { L[i] *= i / 480; R[i] *= i / 480; }
  const buf = Buffer.alloc(44 + n * 6);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 6, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 6, 28); buf.writeUInt16LE(6, 32); buf.writeUInt16LE(24, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 6, 40);
  let peak = 0;
  for (let i = 0; i < n; i++) for (const [c, A] of [[0, L], [1, R]]) {
    const v = Math.max(-1, Math.min(1, A[i])); peak = Math.max(peak, Math.abs(v));
    buf.writeIntLE(Math.round(v * 8388607), 44 + i * 6 + c * 3, 3);
  }
  fs.writeFileSync(ut, buf);
  return { peak };
}
module.exports = { syntes };
