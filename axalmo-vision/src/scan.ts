import { CATEGORY_PLURAL, countName, type Category } from './labels';
import { speedOf, type Obj } from './tracker';

/** Samlar in allt som syns under några sekunder och sammanställer en lägesrapport. */
export interface ScanReport { title: string; lines: string[]; summary: string }

interface Seen { name: string; cat: Category; act?: string; maxSpeed: number }

const CATS: Category[] = ['människa', 'djur', 'fordon', 'föremål'];
export const SCAN_MS = 3000;

export class Scan {
  endsAt = 0;
  private seen = new Map<number, Seen>();
  private scene = '';
  private light = '';
  private cam = new Set<string>();

  get active() {
    return this.endsAt > 0;
  }

  start(t: number) {
    this.endsAt = t + SCAN_MS;
    this.seen.clear();
    this.cam.clear();
  }

  add(objs: Obj[], acts: Map<number, string>, scene: string, light: string, cam: string) {
    for (const o of objs) {
      const s = this.seen.get(o.id) ?? { name: o.name, cat: o.cat, maxSpeed: 0 };
      s.act = acts.get(o.id) ?? s.act;
      s.maxSpeed = Math.max(s.maxSpeed, speedOf(o));
      this.seen.set(o.id, s);
    }
    this.scene = scene;
    this.light = light;
    this.cam.add(cam);
  }

  finish(): ScanReport {
    this.endsAt = 0;
    const all = [...this.seen.values()];
    const lines: string[] = [];
    const short: string[] = [];
    for (const c of CATS) {
      const items = all.filter((s) => s.cat === c);
      if (!items.length) continue;
      const n = items.length;
      if (c === 'föremål') {
        const names = [...new Set(items.map((s) => s.name.toLowerCase()))];
        lines.push(`Föremål (${n}): ${names.join(', ')}`);
        short.push(`${n} föremål`);
        continue;
      }
      // Gruppera efter namn och aktivitet, t.ex. "2 går, 1 sitter"
      const byName = new Map<string, Seen[]>();
      for (const s of items) byName.set(s.name, [...(byName.get(s.name) ?? []), s]);
      for (const [name, group] of byName) {
        const acts = new Map<string, number>();
        for (const s of group) if (s.act) acts.set(s.act, (acts.get(s.act) ?? 0) + 1);
        const actTxt = [...acts].map(([a, k]) => `${k} ${a}`).join(', ');
        const label = c === 'människa' ? `${group.length} ${CATEGORY_PLURAL[c][group.length === 1 ? 0 : 1]}` : countName(name, group.length);
        lines.push(`${label}${actTxt ? ': ' + actTxt : ''}`);
      }
      short.push(`${n} ${CATEGORY_PLURAL[c][n === 1 ? 0 : 1]}`);
    }
    if (!all.length) lines.push('Inget igenkänt i bilden.');
    const fastest = all.filter((s) => s.cat !== 'föremål').sort((a, b) => b.maxSpeed - a.maxSpeed)[0];
    if (fastest && fastest.maxSpeed >= 20) lines.push(`Snabbast: ${fastest.name} – ${Math.round(fastest.maxSpeed)} px/s`);
    const camTxt = this.cam.has('snabb rörelse') ? 'kameran rörde sig mycket – lägre säkerhet' : this.cam.has('rör sig') ? 'kameran rörde sig' : 'kameran stilla';
    return {
      title: `${this.scene} · ljus ${this.light} · ${camTxt}`,
      lines,
      summary: short.length ? short.join(', ') : 'Inget igenkänt',
    };
  }
}
