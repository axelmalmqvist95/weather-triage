import type { Detection, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { OneEuro } from './filter';
import { describe, type Category } from './labels';

export interface Box { x0: number; y0: number; x1: number; y1: number }

/** Spårat objekt. Koordinater i videopixlar (ej spegelvända). Bara löpnummer – ingen identifiering. */
export interface Obj {
  id: number;
  label: string;
  name: string;
  cat: Category;
  score: number;
  box: Box;
  x: number;
  y: number;
  vx: number; // px/s
  vy: number;
  sizeRate: number; // relativ storleksändring per sekund (+ = närmar sig)
  firstSeen: number;
  lastT: number;
  hits: number;
  maxSpeed: number; // px/s
  dist: number; // tillryggalagd sträcka i px
  landmarks?: NormalizedLandmark[];
  poseT?: number;
  filt: OneEuro[];
}

export interface TrackEvent { kind: 'in' | 'ut'; obj: Obj; t: number }

const VEL_ALPHA = 0.3;
const MAX_GAP_MS = 800;
const CONFIRM_HITS = 4;
export const STILL_PX_S = 20;

const iou = (a: Box, b: Box) => {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  const u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
  return u > 0 ? inter / u : 0;
};

export const isConfirmed = (o: Obj) => o.hits >= CONFIRM_HITS;
export const speedOf = (o: Obj) => Math.hypot(o.vx, o.vy);

export class ObjectTracker {
  objs: Obj[] = [];
  private nextId = 1;

  reset() {
    this.objs = [];
    this.nextId = 1;
  }

  /** Uppdaterar med nya detektioner. Returnerar händelser (in/ut ur bild). */
  update(dets: Detection[], t: number, cam: { vx: number; vy: number } = { vx: 0, vy: 0 }): TrackEvent[] {
    const events: TrackEvent[] = [];
    const used = new Set<Obj>();

    // Högst poäng först -> stabilare matchning.
    const sorted = [...dets].sort((a, b) => (b.categories[0]?.score ?? 0) - (a.categories[0]?.score ?? 0));
    for (const d of sorted) {
      const bb = d.boundingBox;
      const c = d.categories[0];
      if (!bb || !c) continue;
      const raw: Box = { x0: bb.originX, y0: bb.originY, x1: bb.originX + bb.width, y1: bb.originY + bb.height };
      const cx = (raw.x0 + raw.x1) / 2, cy = (raw.y0 + raw.y1) / 2;
      const diag = Math.hypot(bb.width, bb.height);

      let best: Obj | null = null;
      let bestScore = 0;
      for (const o of this.objs) {
        if (used.has(o) || o.label !== c.categoryName) continue;
        let s = iou(o.box, raw);
        if (s === 0) {
          const dd = Math.hypot(o.x - cx, o.y - cy);
          if (dd < diag * 0.6) s = 0.01 * (1 - dd / (diag * 0.6));
        }
        if (s > bestScore) { bestScore = s; best = o; }
      }

      if (best) {
        used.add(best);
        const f = best.filt;
        const box = { x0: f[0].filter(raw.x0, t), y0: f[1].filter(raw.y0, t), x1: f[2].filter(raw.x1, t), y1: f[3].filter(raw.y1, t) };
        const nx = (box.x0 + box.x1) / 2, ny = (box.y0 + box.y1) / 2;
        const dt = (t - best.lastT) / 1000;
        if (dt > 0.001) {
          // Dra bort kamerans egen rörelse -> fart relativt omgivningen.
          best.vx += VEL_ALPHA * ((nx - best.x) / dt - cam.vx - best.vx);
          best.vy += VEL_ALPHA * ((ny - best.y) / dt - cam.vy - best.vy);
          const s0 = Math.sqrt(Math.max(1, (best.box.x1 - best.box.x0) * (best.box.y1 - best.box.y0)));
          const s1 = Math.sqrt(Math.max(1, (box.x1 - box.x0) * (box.y1 - box.y0)));
          best.sizeRate += VEL_ALPHA * ((s1 - s0) / s0 / dt - best.sizeRate);
          const sp = speedOf(best);
          if (sp >= STILL_PX_S) best.dist += sp * dt;
          if (best.hits > 5) best.maxSpeed = Math.max(best.maxSpeed, sp);
        }
        Object.assign(best, { box, x: nx, y: ny, score: c.score, lastT: t, hits: best.hits + 1 });
        if (best.hits === CONFIRM_HITS) events.push({ kind: 'in', obj: best, t });
      } else {
        const { name, cat } = describe(c.categoryName);
        const filt = [0, 1, 2, 3].map(() => new OneEuro(1.0, 0.02));
        [raw.x0, raw.y0, raw.x1, raw.y1].forEach((v, i) => filt[i].filter(v, t));
        const o: Obj = {
          id: this.nextId++, label: c.categoryName, name, cat, score: c.score, box: raw, x: cx, y: cy,
          vx: 0, vy: 0, sizeRate: 0, firstSeen: t, lastT: t, hits: 1, maxSpeed: 0, dist: 0, filt,
        };
        this.objs.push(o);
        used.add(o);
      }
    }

    // Ta bort objekt som varit borta för länge.
    this.objs = this.objs.filter((o) => {
      if (t - o.lastT < MAX_GAP_MS) return true;
      // Korta flimmer (< 1 s) loggas inte som att något lämnat bilden.
      if (isConfirmed(o) && o.lastT - o.firstSeen >= 1000) events.push({ kind: 'ut', obj: o, t });
      return false;
    });
    return events;
  }

  /** Synliga, bekräftade objekt (sedda nyligen). */
  visible(t: number) {
    return this.objs.filter((o) => isConfirmed(o) && t - o.lastT < 400);
  }

  /** Kopplar skelett till närmaste person vars ruta innehåller höftmitten. */
  attachPoses(poses: NormalizedLandmark[][], t: number, w: number, h: number) {
    for (const lm of poses) {
      const hx = ((lm[23].x + lm[24].x) / 2) * w, hy = ((lm[23].y + lm[24].y) / 2) * h;
      let best: Obj | null = null;
      let bestD = Infinity;
      for (const o of this.objs) {
        if (o.label !== 'person') continue;
        const pad = (o.box.x1 - o.box.x0) * 0.15;
        if (hx < o.box.x0 - pad || hx > o.box.x1 + pad || hy < o.box.y0 - pad || hy > o.box.y1 + pad) continue;
        const d = Math.hypot(o.x - hx, o.y - hy);
        if (d < bestD) { bestD = d; best = o; }
      }
      if (!best) continue;
      best.landmarks = smoothLandmarks(best, lm, t, w, h);
      best.poseT = t;
    }
  }
}

// One Euro per kroppspunkt (i pixlar) – stabilt men utan att släpa efter.
const poseFilters = new WeakMap<Obj, OneEuro[]>();
function smoothLandmarks(o: Obj, lm: NormalizedLandmark[], t: number, w: number, h: number) {
  let f = poseFilters.get(o);
  if (!f || f.length !== lm.length * 2) {
    f = lm.flatMap(() => [new OneEuro(1.2, 0.03), new OneEuro(1.2, 0.03)]);
    poseFilters.set(o, f);
  }
  return lm.map((l, i) => ({ ...l, x: f![2 * i].filter(l.x * w, t) / w, y: f![2 * i + 1].filter(l.y * h, t) / h }));
}

/** Riktning som användaren ser den (hänsyn till spegling). */
export function directionLabel(o: Obj, mirrored: boolean): string {
  const vx = mirrored ? -o.vx : o.vx;
  const parts: string[] = [];
  if (Math.hypot(vx, o.vy) >= STILL_PX_S) {
    const ang = (Math.atan2(o.vy, vx) * 180) / Math.PI;
    const dirs = ['→ höger', '↘ höger/ner', '↓ ner', '↙ vänster/ner', '← vänster', '↖ vänster/upp', '↑ upp', '↗ höger/upp'];
    parts.push(dirs[((Math.round(ang / 45) % 8) + 8) % 8]);
  }
  if (o.sizeRate > 0.15) parts.push('närmar sig');
  else if (o.sizeRate < -0.15) parts.push('avlägsnar sig');
  return parts.length ? parts.join(' · ') : 'stilla';
}
