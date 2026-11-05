import type { EventKind, OntologyEvent, SubjectType } from './schema.ts';

export interface EventFilter {
  text?: string;
  kinds?: EventKind[];
  subjectTypes?: SubjectType[];
  propertyId?: string;
  subjectId?: string;
  from?: string; // ISO, inklusive
  to?: string; // ISO, inklusive
}

const norm = (s: string) => s.toLocaleLowerCase('sv-SE').trim();

/**
 * Filtrerar och söker i händelseloggen. Fritext matchar sammanfattning, händelsetyp, datavärden och
 * (via labels) namnet på objektet/fastigheten. Alla ord måste matcha. Resultatet sorteras nyast först.
 */
export function filterEvents(events: OntologyEvent[], f: EventFilter, labels: Map<string, string> = new Map()): OntologyEvent[] {
  const words = f.text ? norm(f.text).split(/\s+/).filter(Boolean) : [];
  const out = events.filter((e) => {
    if (f.kinds?.length && !f.kinds.includes(e.kind)) return false;
    if (f.subjectTypes?.length && !f.subjectTypes.includes(e.subjectType)) return false;
    if (f.propertyId && e.propertyId !== f.propertyId) return false;
    if (f.subjectId && e.subjectId !== f.subjectId) return false;
    if (f.from && e.at < f.from) return false;
    if (f.to && e.at > f.to) return false;
    if (words.length) {
      const hay = norm(
        [e.summary, e.kind, e.subjectType, labels.get(e.subjectId) ?? '', labels.get(e.propertyId) ?? '', ...Object.values(e.data ?? {}).map(String)].join(' '),
      );
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** Antal händelser per typ – för filterchips. */
export function countByKind(events: OntologyEvent[]): Partial<Record<EventKind, number>> {
  const c: Partial<Record<EventKind, number>> = {};
  for (const e of events) c[e.kind] = (c[e.kind] ?? 0) + 1;
  return c;
}
