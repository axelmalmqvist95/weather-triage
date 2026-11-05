import type { Item, Observation, OntologyEvent, Property, Relation, Space } from '../ontology/schema.ts';

export interface MemoryData {
  properties: Property[];
  spaces: Space[];
  items: Item[];
  observations: Observation[];
  relations: Relation[];
  events: OntologyEvent[];
}

export interface RecallFilter {
  text?: string;
  workspaceId?: string;
  spaceId?: string; // inkluderar underplatser
  itemId?: string;
  from?: string; // ISO, inklusive
  to?: string; // ISO, inklusive
}

/** Godkända observationer: allt utom avvisade och obekräftade AI-förslag. */
export const isApproved = (o: Observation) => o.status !== 'avvisad' && !(o.source === 'ai-förslag' && o.status === 'öppen');

const norm = (s: string) => s.toLocaleLowerCase('sv-SE');

/** Platsen och alla dess underplatser. */
export function placeWithChildren(spaces: Space[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of spaces) if (s.parentSpaceId && ids.has(s.parentSpaceId) && !ids.has(s.id)) { ids.add(s.id); grew = true; }
  }
  return ids;
}

/** RECALL: sök bland godkända observationer. Nyast först. */
export function recall(data: MemoryData, f: RecallFilter): Observation[] {
  const items = new Map(data.items.map((i) => [i.id, i]));
  const spaces = new Map(data.spaces.map((s) => [s.id, s]));
  const places = f.spaceId ? placeWithChildren(data.spaces, f.spaceId) : null;
  const words = f.text ? norm(f.text).split(/\s+/).filter(Boolean) : [];
  return data.observations
    .filter((o) => {
      if (!isApproved(o)) return false;
      if (f.workspaceId && o.propertyId !== f.workspaceId) return false;
      if (f.itemId && o.itemId !== f.itemId) return false;
      if (places && !(o.spaceId && places.has(o.spaceId))) return false;
      if (f.from && o.observedAt < f.from) return false;
      if (f.to && o.observedAt > f.to) return false;
      if (words.length) {
        const item = o.itemId ? items.get(o.itemId) : undefined;
        const hay = norm([
          o.title, o.note ?? '', o.category, item?.name ?? '', item?.brand ?? '', item?.model ?? '',
          o.spaceId ? spaces.get(o.spaceId)?.name ?? '' : '', o.detection?.label ?? '', ...Object.values(o.metadata ?? {}).map(String),
        ].join(' '));
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    })
    .sort((a, b) => (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : 0));
}

export interface ItemHistory {
  item: Item;
  observations: Observation[]; // äldst först
  events: OntologyEvent[]; // äldst först, för föremålet och dess observationer
  relations: { kind: string; direction: 'ut' | 'in'; otherId: string }[];
}

export function itemHistory(data: MemoryData, itemId: string): ItemHistory | null {
  const item = data.items.find((i) => i.id === itemId);
  if (!item) return null;
  const observations = data.observations.filter((o) => o.itemId === itemId).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const ids = new Set([itemId, ...observations.map((o) => o.id)]);
  const events = data.events.filter((e) => ids.has(e.subjectId)).sort((a, b) => a.at.localeCompare(b.at));
  const relations = data.relations
    .filter((r) => r.fromId === itemId || r.toId === itemId)
    .map((r) => (r.fromId === itemId ? { kind: r.kind, direction: 'ut' as const, otherId: r.toId } : { kind: r.kind, direction: 'in' as const, otherId: r.fromId }));
  if (item.spaceId) relations.unshift({ kind: 'finns-i', direction: 'ut', otherId: item.spaceId });
  return { item, observations, events, relations };
}
