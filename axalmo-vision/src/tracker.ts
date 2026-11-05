import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/** Spårad person. Positioner i videopixlar (ej spegelvända). Ingen identifiering – bara löpnummer. */
export interface Track {
  id: number;
  x: number;
  y: number;
  vx: number; // px/s
  vy: number; // px/s
  width: number; // axelbredd px (för närmar sig/avlägsnar sig)
  depthRate: number; // relativ storleksändring per sekund
  box: { x0: number; y0: number; x1: number; y1: number };
  landmarks: NormalizedLandmark[];
  lastT: number;
  age: number; // antal uppdateringar
}

const VIS = 0.5;
const POS_ALPHA = 0.5;
const VEL_ALPHA = 0.25;
const MAX_GAP_MS = 1000;

const visible = (l?: NormalizedLandmark) => !!l && (l.visibility ?? 1) > VIS;

function anchorOf(lm: NormalizedLandmark[], w: number, h: number) {
  const [ls, rs, lh, rh] = [lm[11], lm[12], lm[23], lm[24]];
  if (visible(lh) && visible(rh)) return { x: ((lh.x + rh.x) / 2) * w, y: ((lh.y + rh.y) / 2) * h };
  if (visible(ls) && visible(rs)) return { x: ((ls.x + rs.x) / 2) * w, y: ((ls.y + rs.y) / 2) * h };
  return null;
}

function boxOf(lm: NormalizedLandmark[], w: number, h: number) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of lm) {
    if (!visible(l)) continue;
    x0 = Math.min(x0, l.x); y0 = Math.min(y0, l.y); x1 = Math.max(x1, l.x); y1 = Math.max(y1, l.y);
  }
  if (!isFinite(x0)) return null;
  const px = (x1 - x0) * 0.08, py = (y1 - y0) * 0.06;
  return {
    x0: Math.max(0, (x0 - px) * w), y0: Math.max(0, (y0 - py) * h),
    x1: Math.min(w, (x1 + px) * w), y1: Math.min(h, (y1 + py) * h),
  };
}

export class Tracker {
  tracks: Track[] = [];
  private nextId = 1;

  reset() {
    this.tracks = [];
    this.nextId = 1;
  }

  update(poses: NormalizedLandmark[][], t: number, w: number, h: number): Track[] {
    const used = new Set<Track>();
    // En person i bild och ett spår: behåll samma ID oavsett hopp.
    const maxDist = poses.length === 1 && this.tracks.length === 1 ? Infinity : Math.max(w, h) * 0.3;
    const next: Track[] = [];

    for (const lm of poses) {
      const box = boxOf(lm, w, h);
      if (!box) continue;
      const a = anchorOf(lm, w, h) ?? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
      const sw = visible(lm[11]) && visible(lm[12]) ? Math.hypot((lm[11].x - lm[12].x) * w, (lm[11].y - lm[12].y) * h) : 0;

      // Närmaste befintliga spår (enkel girig matchning – räcker för 1–3 personer).
      let best: Track | null = null;
      let bestD = maxDist;
      for (const tr of this.tracks) {
        if (used.has(tr)) continue;
        const d = Math.hypot(tr.x - a.x, tr.y - a.y);
        if (d < bestD) { bestD = d; best = tr; }
      }

      if (best && t - best.lastT >= MAX_GAP_MS) {
        // För långt glapp (t.ex. första långsamma GPU-bildrutan): behåll ID, nollställ hastighet.
        used.add(best);
        Object.assign(best, { x: a.x, y: a.y, vx: 0, vy: 0, depthRate: 0, width: sw, box, landmarks: lm, lastT: t, age: 1 });
        next.push(best);
      } else if (best) {
        used.add(best);
        const dt = (t - best.lastT) / 1000;
        const nx = best.x + POS_ALPHA * (a.x - best.x);
        const ny = best.y + POS_ALPHA * (a.y - best.y);
        if (dt > 0.001) {
          best.vx += VEL_ALPHA * ((nx - best.x) / dt - best.vx);
          best.vy += VEL_ALPHA * ((ny - best.y) / dt - best.vy);
          if (sw > 0 && best.width > 0) {
            const nw = best.width + POS_ALPHA * (sw - best.width);
            best.depthRate += VEL_ALPHA * ((nw - best.width) / best.width / dt - best.depthRate);
            best.width = nw;
          } else if (sw > 0) best.width = sw;
        }
        Object.assign(best, { x: nx, y: ny, box, landmarks: lm, lastT: t, age: best.age + 1 });
        next.push(best);
      } else {
        next.push({ id: this.nextId++, x: a.x, y: a.y, vx: 0, vy: 0, width: sw, depthRate: 0, box, landmarks: lm, lastT: t, age: 1 });
      }
    }
    // Behåll kortvarigt tappade spår så att ID inte hoppar vid en missad bildruta.
    for (const tr of this.tracks) if (!used.has(tr) && !next.includes(tr) && t - tr.lastT < MAX_GAP_MS) next.push(tr);
    this.tracks = next;
    return next.filter((tr) => tr.lastT === t);
  }
}

export const STILL_PX_S = 20;

/** Riktning som användaren ser den (hänsyn till spegling). */
export function directionLabel(tr: Track, mirrored: boolean): string {
  const vx = mirrored ? -tr.vx : tr.vx;
  const speed = Math.hypot(vx, tr.vy);
  const parts: string[] = [];
  if (speed >= STILL_PX_S) {
    const ang = (Math.atan2(tr.vy, vx) * 180) / Math.PI; // 0 = höger, 90 = ner
    const dirs = ['→ höger', '↘ höger/ner', '↓ ner', '↙ vänster/ner', '← vänster', '↖ vänster/upp', '↑ upp', '↗ höger/upp'];
    parts.push(dirs[((Math.round(ang / 45) % 8) + 8) % 8]);
  }
  if (tr.depthRate > 0.15) parts.push('närmar sig');
  else if (tr.depthRate < -0.15) parts.push('avlägsnar sig');
  return parts.length ? parts.join(' · ') : 'stilla';
}
