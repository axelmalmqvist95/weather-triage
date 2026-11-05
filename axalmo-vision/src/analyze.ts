import type { Category } from './labels';
import { STILL_PX_S, speedOf, type Obj } from './tracker';

/**
 * Lokal "AI-analys": tolkar detektioner + kroppshållning + rörelse till svenska meningar och händelser.
 * Regelbaserad – ingen molntjänst, ingen identifiering av individer.
 */

export interface Insight { text: string; cat: Category | 'ai' | 'alert' }
export interface Analysis {
  scene: string;
  light: string;
  level: string;
  lines: Insight[];
  events: Insight[];
  acts: Map<number, string>;
}

const HOLDABLE = new Set([
  'cell phone', 'cup', 'bottle', 'wine glass', 'book', 'remote', 'laptop', 'umbrella', 'handbag', 'backpack',
  'sports ball', 'tennis racket', 'baseball bat', 'frisbee', 'knife', 'scissors', 'banana', 'apple', 'sandwich',
  'orange', 'donut', 'hot dog', 'pizza', 'toothbrush', 'hair drier', 'teddy bear', 'mouse', 'keyboard', 'suitcase',
]);

const SCENES: { name: string; labels: string[]; min: number }[] = [
  { name: 'Kök', labels: ['refrigerator', 'oven', 'microwave', 'sink', 'toaster'], min: 1 },
  { name: 'Sovrum', labels: ['bed'], min: 1 },
  { name: 'Vardagsrum', labels: ['couch', 'tv', 'remote', 'potted plant'], min: 1 },
  { name: 'Kontor / arbetsplats', labels: ['laptop', 'keyboard', 'mouse'], min: 1 },
  { name: 'Badrum', labels: ['toilet', 'toothbrush', 'hair drier'], min: 1 },
  { name: 'Matbord', labels: ['dining table', 'fork', 'knife', 'spoon', 'bowl', 'wine glass', 'pizza', 'cake'], min: 2 },
  { name: 'Gata / trafik', labels: ['car', 'truck', 'bus', 'traffic light', 'stop sign', 'motorcycle', 'parking meter', 'fire hydrant'], min: 1 },
  { name: 'Sport / aktivitet', labels: ['sports ball', 'skateboard', 'skis', 'snowboard', 'surfboard', 'tennis racket', 'frisbee', 'kite'], min: 1 },
  { name: 'Utomhus / natur', labels: ['bird', 'horse', 'sheep', 'cow', 'bench', 'boat'], min: 1 },
];

interface PState {
  cand: string;
  candSince: number;
  act: string;
  torso: { t: number; up: boolean }[];
  fallAt: number;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const center = (o: Obj) => ({ x: o.x, y: o.y });
const bodyLen = (o: Obj) => Math.max(o.box.y1 - o.box.y0, o.box.x1 - o.box.x0, 1);
const overlap = (a: Obj, b: Obj) => {
  const ix = Math.max(0, Math.min(a.box.x1, b.box.x1) - Math.max(a.box.x0, b.box.x0));
  const iy = Math.max(0, Math.min(a.box.y1, b.box.y1) - Math.max(a.box.y0, b.box.y0));
  const small = Math.min((a.box.x1 - a.box.x0) * (a.box.y1 - a.box.y0), (b.box.x1 - b.box.x0) * (b.box.y1 - b.box.y0));
  return small > 0 ? (ix * iy) / small : 0;
};

function angle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  const a1 = Math.atan2(ay - by, ax - bx), a2 = Math.atan2(cy - by, cx - bx);
  let d = Math.abs(((a1 - a2) * 180) / Math.PI);
  if (d > 180) d = 360 - d;
  return d;
}

/** Hållning från kroppspunkter (videopixlar). null om skelett saknas. */
function posture(o: Obj, t: number, w: number, h: number) {
  const lm = o.landmarks;
  if (!lm || !o.poseT || t - o.poseT > 700) return null;
  const P = (i: number) => ({ x: lm[i].x * w, y: lm[i].y * h, ok: (lm[i].visibility ?? 1) > 0.5 });
  const [ls, rs, lh, rh, lk, rk, la, ra, lw, rw, nose] = [11, 12, 23, 24, 25, 26, 27, 28, 15, 16, 0].map(P);
  if (!(ls.ok && rs.ok && lh.ok && rh.ok)) return null;
  const sm = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }, hm = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
  const torsoLen = Math.hypot(sm.x - hm.x, sm.y - hm.y) || 1;
  const tilt = (Math.atan2(Math.abs(sm.x - hm.x), Math.abs(sm.y - hm.y)) * 180) / Math.PI; // 0 = upprätt
  const knees: number[] = [];
  if (lk.ok && la.ok) knees.push(angle(lh.x, lh.y, lk.x, lk.y, la.x, la.y));
  if (rk.ok && ra.ok) knees.push(angle(rh.x, rh.y, rk.x, rk.y, ra.x, ra.y));
  const knee = knees.length ? knees.reduce((a, b) => a + b) / knees.length : 180;
  const kneeY = lk.ok && rk.ok ? (lk.y + rk.y) / 2 : lk.ok ? lk.y : rk.ok ? rk.y : NaN;
  const hipsAtKnees = !isNaN(kneeY) && Math.abs(hm.y - kneeY) < 0.45 * torsoLen;
  const handsUp = nose.ok ? [lw, rw].filter((p) => p.ok && p.y < nose.y).length : 0;
  return { tilt, knee, hipsAtKnees, handsUp, wrists: [lw, rw].filter((p) => p.ok) };
}

export class Analyzer {
  private ps = new Map<number, PState>();
  private seenLabels = new Map<string, number>();
  private scene = 'Okänd miljö';
  private sceneCand = '';
  private sceneCandSince = 0;
  private lastLight = '';
  private closePair = false;

  reset() {
    this.ps.clear();
    this.seenLabels.clear();
    this.scene = 'Okänd miljö';
    this.lastLight = '';
    this.closePair = false;
  }

  analyze(objs: Obj[], t: number, w: number, h: number, mirrored: boolean, luma: number | null): Analysis {
    const events: Insight[] = [];
    const lines: Insight[] = [];
    const acts = new Map<number, string>();
    const people = objs.filter((o) => o.label === 'person');

    // --- Miljö (stabil i 3 s innan byte) ---
    for (const o of objs) this.seenLabels.set(o.label, t);
    const recent = new Set([...this.seenLabels].filter(([, ts]) => t - ts < 15000).map(([l]) => l));
    const match = SCENES.find((s) => s.labels.filter((l) => recent.has(l)).length >= s.min)?.name ?? 'Okänd miljö';
    if (match !== this.sceneCand) {
      this.sceneCand = match;
      this.sceneCandSince = t;
    } else if (match !== this.scene && t - this.sceneCandSince > 3000) {
      this.scene = match;
      if (match !== 'Okänd miljö') events.push({ text: `Miljö: ${match}`, cat: 'ai' });
    }

    // --- Ljus ---
    const light = luma === null ? '–' : luma < 45 ? 'mörkt' : luma < 95 ? 'dämpat' : 'bra';
    if (light !== this.lastLight && this.lastLight && light === 'mörkt') events.push({ text: 'Lågt ljus – analysen blir osäkrare', cat: 'ai' });
    this.lastLight = light;

    // --- Per objekt ---
    let energy = 0;
    for (const o of objs) {
      const L = bodyLen(o);
      const rel = speedOf(o) / L; // kroppslängder per sekund
      if (o.cat === 'människa' || o.cat === 'djur') energy += rel;
      const vx = mirrored ? -o.vx : o.vx;
      const dirs: string[] = [];
      if (speedOf(o) >= STILL_PX_S && rel > 0.12) {
        if (Math.abs(vx) > Math.abs(o.vy) * 1.3) dirs.push(vx > 0 ? 'åt höger' : 'åt vänster');
        else if (Math.abs(o.vy) > Math.abs(vx) * 1.3) dirs.push(o.vy > 0 ? 'nedåt' : 'uppåt');
        else dirs.push(`snett ${o.vy > 0 ? 'ner' : 'upp'} åt ${vx > 0 ? 'höger' : 'vänster'}`);
      }
      if (o.sizeRate > 0.15) dirs.push('mot kameran');
      else if (o.sizeRate < -0.15) dirs.push('bort från kameran');

      const name = `${o.name} ${o.id}`;
      if (o.label !== 'person') {
        let verb: string;
        if (o.cat === 'djur') verb = rel < 0.12 ? 'står still' : rel < 1.0 ? 'rör sig' : 'springer';
        else if (o.cat === 'fordon') verb = rel < 0.08 ? 'står still' : rel < 0.6 ? 'rör sig långsamt' : 'kör förbi';
        else verb = rel < 0.12 ? 'syns i bilden' : 'rör sig';
        acts.set(o.id, verb);
        if (o.cat !== 'föremål' || rel >= 0.12) lines.push({ text: `${name} ${verb}${dirs.length ? ' ' + dirs.join(', ') : ''}.`, cat: o.cat });
        continue;
      }

      // Person: aktivitet från hållning + fart
      const p = posture(o, t, w, h);
      let act = rel < 0.15 ? 'står still' : rel < 0.9 ? 'går' : 'springer';
      if (p) {
        if (p.tilt > 60) act = 'ligger ner';
        else if (p.knee < 125 && p.hipsAtKnees && rel < 0.4) act = 'sitter';
        else if (p.knee < 115 && p.tilt < 35 && rel < 0.4) act = 'är på huk';
        if (o.vy < -0.9 * L && Math.abs(vx) < 0.5 * L && act !== 'ligger ner') act = 'hoppar';
      }

      const extras: string[] = [];
      if (act !== 'ligger ner') {
        if (p?.handsUp === 2) extras.push('har armarna uppe');
        else if (p?.handsUp === 1) extras.push('räcker upp en hand');
      }

      // Samspel med andra objekt
      for (const q of objs) {
        if (q === o) continue;
        const ov = overlap(o, q);
        if ((q.label === 'bicycle' || q.label === 'motorcycle') && ov > 0.3 && o.y < q.y) {
          act = q.label === 'bicycle' ? 'cyklar' : 'kör motorcykel';
        } else if (['chair', 'couch', 'bed', 'bench'].includes(q.label) && ov > 0.25 && (act === 'sitter' || act === 'ligger ner' || act === 'står still')) {
          const where = { chair: 'på en stol', couch: 'i soffan', bed: 'i sängen', bench: 'på en bänk' }[q.label as 'chair'];
          if (act === 'står still') act = 'sitter';
          extras.push(where);
        } else if (HOLDABLE.has(q.label) && p?.wrists.some((wr) => Math.hypot(wr.x - q.x, wr.y - q.y) < 0.18 * L)) {
          extras.push(`håller i ${q.name === 'Mobiltelefon' ? 'en mobil' : 'en ' + lower(q.name)}`);
        } else if ((q.label === 'car' || q.label === 'truck') && ov > 0.2) {
          extras.push(`är vid en ${lower(q.name)}`);
        } else if (q.cat === 'djur' && Math.hypot(q.x - o.x, q.y - o.y) < 1.2 * L) {
          const together = speedOf(o) > STILL_PX_S && speedOf(q) > STILL_PX_S && (o.vx * q.vx + o.vy * q.vy) / (speedOf(o) * speedOf(q)) > 0.7;
          extras.push(together ? `går med ${lower(q.name) === 'hund' ? 'hunden' : 'ett djur'}` : `är nära en ${lower(q.name)}`);
        }
      }
      acts.set(o.id, act);

      // Händelser: ny aktivitet stabil i 0,7 s
      let st = this.ps.get(o.id);
      if (!st) {
        st = { cand: act, candSince: t, act, torso: [], fallAt: 0 };
        this.ps.set(o.id, st);
      }
      if (act !== st.cand) {
        st.cand = act;
        st.candSince = t;
      } else if (act !== st.act && t - st.candSince > 700) {
        const verbs: Record<string, string> = {
          går: 'började gå', springer: 'började springa', sitter: 'satte sig', 'ligger ner': 'lade sig ner',
          'står still': 'stannade', hoppar: 'hoppar', 'är på huk': 'gick ner på huk', cyklar: 'cyklar', 'kör motorcykel': 'kör motorcykel',
        };
        events.push({ text: `${name} ${verbs[act] ?? act}`, cat: 'människa' });
        st.act = act;
      }

      // Fall: upprätt -> liggande inom 1,2 s
      if (p) {
        st.torso.push({ t, up: p.tilt < 30 });
        st.torso = st.torso.filter((x) => t - x.t < 1200);
        if (p.tilt > 60 && st.torso.some((x) => x.up) && t - st.fallAt > 5000) {
          st.fallAt = t;
          events.push({ text: `⚠ Möjligt fall – ${name}`, cat: 'alert' });
        }
      }

      lines.push({
        text: `${name} ${act}${dirs.length && act !== 'står still' ? ' ' + dirs.join(', ') : ''}${extras.length ? ' och ' + extras.join(', ') : ''}.`,
        cat: 'människa',
      });
    }

    // Personer nära varandra
    let close = false;
    for (let i = 0; i < people.length; i++)
      for (let j = i + 1; j < people.length; j++) {
        const a = center(people[i]), b = center(people[j]);
        const wAvg = (people[i].box.x1 - people[i].box.x0 + people[j].box.x1 - people[j].box.x0) / 2;
        if (Math.hypot(a.x - b.x, a.y - b.y) < 1.3 * wAvg) close = true;
      }
    if (close) lines.push({ text: 'Personer står nära varandra.', cat: 'människa' });
    if (close && !this.closePair) events.push({ text: 'Två personer möts', cat: 'människa' });
    this.closePair = close;

    // Rensa gamla tillstånd
    const ids = new Set(objs.map((o) => o.id));
    for (const id of this.ps.keys()) if (!ids.has(id)) this.ps.delete(id);

    const level = objs.length === 0 ? 'ingen' : energy < 0.25 ? 'lugnt' : energy < 1.2 ? 'måttlig' : 'hög';
    // Mest intressanta först: personer, djur, fordon, föremål
    const order = { alert: 0, människa: 1, djur: 2, fordon: 3, ai: 4, föremål: 5 };
    lines.sort((a, b) => order[a.cat] - order[b.cat]);
    return { scene: this.scene, light, level, lines: lines.slice(0, 5), events, acts };
  }
}

/** Medelljus i bilden (0–255) från en liten nedskalad kopia. */
export function measureLuma(video: HTMLVideoElement, canvas: HTMLCanvasElement): number | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  canvas.width = 16;
  canvas.height = 12;
  ctx.drawImage(video, 0, 0, 16, 12);
  const d = ctx.getImageData(0, 0, 16, 12).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return s / (d.length / 4);
}
