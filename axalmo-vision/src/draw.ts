import { POSE_CONNECTIONS } from './pose';
import { STILL_PX_S, type Track } from './tracker';

export interface View { cw: number; ch: number; vw: number; vh: number; mirrored: boolean }

/** object-fit: cover – videopixel -> skärm (CSS-px). */
export function toScreen(v: View, x: number, y: number) {
  const s = Math.max(v.cw / v.vw, v.ch / v.vh);
  const sx = x * s + (v.cw - v.vw * s) / 2;
  const sy = y * s + (v.ch - v.vh * s) / 2;
  return { x: v.mirrored ? v.cw - sx : sx, y: sy, s };
}

/** Skärm (CSS-px) -> videopixel. */
export function toVideo(v: View, x: number, y: number) {
  const s = Math.max(v.cw / v.vw, v.ch / v.vh);
  const sx = v.mirrored ? v.cw - x : x;
  return { x: (sx - (v.cw - v.vw * s) / 2) / s, y: (y - (v.ch - v.vh * s) / 2) / s };
}

const CYAN = '#00e5ff';
const COLORS = [CYAN, '#ff3df2', '#b6ff3d'];
// Ansiktspunkter 1–10 ritas inte (ingen fokus på ansiktet).
const SKIP = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  v: View,
  tracks: Track[],
  labels: Map<number, string[]>,
  calib: { x: number; y: number }[],
  extrapMs = 0,
) {
  ctx.clearRect(0, 0, v.cw, v.ch);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const tr of tracks) {
    const col = COLORS[(tr.id - 1) % COLORS.length];
    const lm = tr.landmarks;
    // Flytta ritningen med uppmätt hastighet mellan inferenserna -> mjukare rörelse.
    const ex = Math.min(extrapMs, 120) / 1000;
    const dx = tr.vx * ex, dy = tr.vy * ex;
    const P = (i: number) => toScreen(v, lm[i].x * v.vw + dx, lm[i].y * v.vh + dy);
    const ok = (i: number) => (lm[i]?.visibility ?? 1) > 0.5;

    // Skelett
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const { start, end } of POSE_CONNECTIONS) {
      if (SKIP.has(start) || SKIP.has(end) || !ok(start) || !ok(end)) continue;
      const a = P(start), b = P(end);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < lm.length; i++) {
      if (SKIP.has(i) || !ok(i)) continue;
      const p = P(i);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Markeringsruta med hörn
    const a = toScreen(v, tr.box.x0 + dx, tr.box.y0 + dy), b = toScreen(v, tr.box.x1 + dx, tr.box.y1 + dy);
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = a.y, y1 = b.y;
    const c = Math.min(22, (x1 - x0) / 4);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.35;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + c); ctx.lineTo(x0, y0); ctx.lineTo(x0 + c, y0);
    ctx.moveTo(x1 - c, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + c);
    ctx.moveTo(x0, y1 - c); ctx.lineTo(x0, y1); ctx.lineTo(x0 + c, y1);
    ctx.moveTo(x1 - c, y1); ctx.lineTo(x1, y1); ctx.lineTo(x1, y1 - c);
    ctx.stroke();

    // Rörelsepil från ankarpunkten (0,4 s framåt)
    const o = toScreen(v, tr.x + dx, tr.y + dy);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(o.x, o.y, 6, 0, Math.PI * 2);
    ctx.fill();
    if (Math.hypot(tr.vx, tr.vy) >= STILL_PX_S) {
      const e = toScreen(v, tr.x + dx + tr.vx * 0.4, tr.y + dy + tr.vy * 0.4);
      const ang = Math.atan2(e.y - o.y, e.x - o.x);
      ctx.strokeStyle = col;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(o.x, o.y); ctx.lineTo(e.x, e.y);
      ctx.lineTo(e.x - 14 * Math.cos(ang - 0.45), e.y - 14 * Math.sin(ang - 0.45));
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x - 14 * Math.cos(ang + 0.45), e.y - 14 * Math.sin(ang + 0.45));
      ctx.stroke();
    }

    // Etikett
    const lines = labels.get(tr.id) ?? [];
    ctx.font = '600 13px ui-monospace, Menlo, monospace';
    const lw = Math.max(...lines.map((l) => ctx.measureText(l).width), 30) + 14;
    const lh = 17 * lines.length + 8;
    const lx = Math.min(Math.max(4, x0), v.cw - lw - 4);
    const ly = Math.min(Math.max(4, y0 - lh - 6), v.ch - lh - 4);
    ctx.fillStyle = 'rgba(5,8,13,0.75)';
    ctx.fillRect(lx, ly, lw, lh);
    ctx.fillStyle = col;
    ctx.fillRect(lx, ly, 3, lh);
    ctx.fillStyle = '#e6fbff';
    lines.forEach((l, i) => ctx.fillText(l, lx + 9, ly + 17 + i * 17));
  }

  // Kalibreringslinje
  if (calib.length) {
    ctx.strokeStyle = '#ffd23d';
    ctx.fillStyle = '#ffd23d';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    const pts = calib.map((p) => toScreen(v, p.x, p.y));
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
