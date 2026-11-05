import {
  STATUS_TRANSITIONS, ValidationError, isPersonLabel, newId, workspaceKind,
  type Actor, type DetectionInfo, type EventKind, type EventValue, type Item, type ItemCategory, type ItemStatus,
  type LinkableType, type MetaValue, type Observation, type ObservationCategory, type ObservationSource,
  type ObservationStatus, type OntologyEvent, type OntologyObject, type Property, type Relation, type RelationKind,
  type Severity, type Space, type SpaceKind, type SubjectType, type WorkspaceKind,
} from './schema.ts';
import type { OntologyStore } from './store.ts';

/**
 * Actions – det enda sättet att ändra ontologin. Varje action skriver objektet och en händelse
 * atomiskt, så att händelseloggen alltid är ett komplett revisionsspår.
 */
export class Ontology {
  readonly store: OntologyStore;
  /** Klocka kan bytas ut i tester och för syntetisk data. */
  now: () => Date = () => new Date();
  actor: Actor = 'inspektör';

  constructor(store: OntologyStore) {
    this.store = store;
  }

  private stamp() {
    return this.now().toISOString();
  }

  private event(kind: EventKind, subjectType: SubjectType, subjectId: string, propertyId: string, summary: string, data?: Record<string, EventValue>): OntologyEvent {
    return { type: 'event', id: newId('event'), at: this.stamp(), kind, subjectType, subjectId, propertyId, summary, actor: this.actor, data };
  }

  private newWorkspace(input: { name: string; kind?: WorkspaceKind; address?: string; municipality?: string; buildYear?: number }) {
    const t = this.stamp();
    const p: Property = { ...input, type: 'property', id: newId('property'), createdAt: t, updatedAt: t };
    const label = workspaceKind(p) === 'fastighet' ? 'Fastighet' : `Arbetsyta (${p.kind})`;
    return [p, this.event('skapad', 'property', p.id, p.id, `${label} skapad: ${p.name}`, p.kind ? { kind: p.kind } : undefined)] as const;
  }

  /** v1-kompatibel: fastighet (kind kan anges för andra arbetsytor). */
  async createProperty(input: { name: string; address?: string; kind?: WorkspaceKind; municipality?: string; buildYear?: number }): Promise<Property> {
    const [p, e] = this.newWorkspace(input);
    await this.store.commit([p, e]);
    return p;
  }

  /** Arbetsyta/projekt: hem, bil, förråd, elektronik, projekt … */
  createWorkspace(input: { name: string; kind: WorkspaceKind; address?: string }): Promise<Property> {
    return this.createProperty(input);
  }

  private newSpace(input: { propertyId: string; name: string; kind: SpaceKind; parentSpaceId?: string; floor?: number; areaM2?: number }) {
    const t = this.stamp();
    const s: Space = { ...input, type: 'space', id: newId('space'), createdAt: t, updatedAt: t };
    return [s, this.event('skapad', 'space', s.id, s.propertyId, `Plats skapad: ${s.name} (${s.kind})`, { kind: s.kind })] as const;
  }

  private newItem(input: { propertyId: string; spaceId?: string; name: string; category: ItemCategory; status?: ItemStatus; brand?: string; model?: string; note?: string }) {
    const t = this.stamp();
    const i: Item = { ...input, status: input.status ?? 'aktiv', type: 'item', id: newId('item'), createdAt: t, updatedAt: t };
    return [i, this.event('skapad', 'item', i.id, i.propertyId, `Föremål skapat: ${i.name} (${i.category})`, { category: i.category, spaceId: i.spaceId ?? null })] as const;
  }

  async createItem(input: { propertyId: string; spaceId?: string; name: string; category: ItemCategory; status?: ItemStatus; brand?: string; model?: string; note?: string }): Promise<Item> {
    const [i, e] = this.newItem(input);
    await this.store.commit([i, e]);
    return i;
  }

  /** Flyttar ett föremål till en annan plats (eller ingen plats). Loggas som "flyttad" med från/till. */
  async moveItem(id: string, spaceId: string | undefined): Promise<Item> {
    const i = await this.store.get('item', id);
    if (!i) throw new ValidationError([`föremålet ${id} finns inte`]);
    const updated: Item = { ...i, spaceId, updatedAt: this.stamp() };
    if (spaceId === undefined) delete updated.spaceId;
    await this.store.commit([updated, this.event('flyttad', 'item', i.id, i.propertyId, `${i.name} flyttad`, { från: i.spaceId ?? null, till: spaceId ?? null })]);
    return updated;
  }

  async updateItem(id: string, patch: Partial<Pick<Item, 'name' | 'category' | 'status' | 'brand' | 'model' | 'note'>>): Promise<Item> {
    const i = await this.store.get('item', id);
    if (!i) throw new ValidationError([`föremålet ${id} finns inte`]);
    const updated: Item = { ...i, ...patch, updatedAt: this.stamp() };
    await this.store.commit([updated, this.event('uppdaterad', 'item', i.id, i.propertyId, `${updated.name}: ändrade ${Object.keys(patch).join(', ')}`)]);
    return updated;
  }

  /** Explicit relation mellan två objekt i samma arbetsyta. */
  async relate(input: { fromType: LinkableType; fromId: string; toType: LinkableType; toId: string; kind: RelationKind; note?: string }): Promise<Relation> {
    const from = await this.store.get(input.fromType, input.fromId);
    if (!from) throw new ValidationError([`objektet ${input.fromId} finns inte`]);
    const propertyId = from.type === 'property' ? from.id : from.propertyId;
    const t = this.stamp();
    const r: Relation = { ...input, propertyId, type: 'relation', id: newId('relation'), createdAt: t, updatedAt: t };
    await this.store.commit([r, this.event('relation', 'relation', r.id, propertyId, `Relation: ${r.kind}`, { från: r.fromId, till: r.toId })]);
    return r;
  }

  async createSpace(input: { propertyId: string; name: string; kind: SpaceKind; parentSpaceId?: string; floor?: number; areaM2?: number }): Promise<Space> {
    const [s, e] = this.newSpace(input);
    await this.store.commit([s, e]);
    return s;
  }

  async createObservation(input: {
    spaceId?: string; itemId?: string; title: string; category: ObservationCategory; severity: Severity;
    source?: ObservationSource; confidence?: number; note?: string; observedAt?: string;
    detection?: DetectionInfo; metadata?: Record<string, MetaValue>;
  }): Promise<Observation> {
    const item = input.itemId ? await this.store.get('item', input.itemId) : undefined;
    if (input.itemId && !item) throw new ValidationError([`föremålet ${input.itemId} finns inte`]);
    // Platsen ögonblicksbild: anges ingen plats används föremålets nuvarande plats.
    const spaceId = input.spaceId ?? item?.spaceId;
    const space = spaceId ? await this.store.get('space', spaceId) : undefined;
    if (spaceId && !space) throw new ValidationError([`ytan ${spaceId} finns inte`]);
    if (!space && !item) throw new ValidationError(['plats eller föremål krävs']);
    const t = this.stamp();
    const source = input.source ?? 'manuell';
    const o: Observation = {
      ...input,
      spaceId,
      type: 'observation', id: newId('observation'), createdAt: t, updatedAt: t, propertyId: (space ?? item)!.propertyId,
      status: 'öppen', source, observedAt: input.observedAt ?? t,
    };
    const kind: EventKind = source === 'ai-förslag' ? 'ai-förslag' : 'skapad';
    const summary = source === 'ai-förslag'
      ? `AI-förslag i ${space?.name ?? item!.name}: ${o.title} (${Math.round((o.confidence ?? 0) * 100)} %)`
      : `Observation i ${space?.name ?? item!.name}: ${o.title}`;
    await this.store.commit([o, this.event(kind, 'observation', o.id, o.propertyId, summary, { category: o.category, severity: o.severity, spaceId: space?.id ?? null, itemId: item?.id ?? null })]);
    return o;
  }

  async setObservationStatus(id: string, status: ObservationStatus, comment?: string): Promise<Observation> {
    const o = await this.store.get('observation', id);
    if (!o) throw new ValidationError([`observationen ${id} finns inte`]);
    if (!STATUS_TRANSITIONS[o.status].includes(status)) {
      throw new ValidationError([`statusändring ${o.status} → ${status} är inte tillåten`]);
    }
    const updated: Observation = { ...o, status, updatedAt: this.stamp() };
    const summary = `${o.title}: ${o.status} → ${status}${comment ? ` – ${comment}` : ''}`;
    await this.store.commit([updated, this.event('status-ändrad', 'observation', o.id, o.propertyId, summary, { från: o.status, till: status })]);
    return updated;
  }

  async updateObservation(id: string, patch: Partial<Pick<Observation, 'title' | 'note' | 'severity' | 'category'>>): Promise<Observation> {
    const o = await this.store.get('observation', id);
    if (!o) throw new ValidationError([`observationen ${id} finns inte`]);
    const updated: Observation = { ...o, ...patch, updatedAt: this.stamp() };
    const changed = Object.keys(patch).join(', ');
    await this.store.commit([updated, this.event('uppdaterad', 'observation', o.id, o.propertyId, `${updated.title}: ändrade ${changed}`)]);
    return updated;
  }

  async addComment(subjectType: SubjectType, subjectId: string, text: string): Promise<OntologyEvent> {
    const subj = await this.store.get(subjectType, subjectId);
    if (!subj) throw new ValidationError([`objektet ${subjectId} finns inte`]);
    const propertyId = subj.type === 'property' ? subj.id : subj.propertyId;
    const e = this.event('kommentar', subjectType, subjectId, propertyId, text);
    await this.store.commit([e]);
    return e;
  }

  async recordInspection(propertyId: string, summary: string, data?: Record<string, EventValue>): Promise<OntologyEvent> {
    const e = this.event('inspektion', 'property', propertyId, propertyId, summary, data);
    await this.store.commit([e]);
    return e;
  }

  /**
   * CAPTURE → MEMORY: sparar ett granskat kameraförslag. Ny arbetsyta/plats/föremål skapas vid behov.
   * Allt (objekt + händelser) skrivs i EN transaktion – avbryts något sparas ingenting.
   * Personetiketter avvisas. Inga bilder sparas – bara text/tal om vad modellen såg.
   */
  async capture(input: CaptureInput): Promise<CaptureResult> {
    if (isPersonLabel(input.detection.label)) throw new ValidationError(['detektioner av personer får inte sparas i minnet']);
    const prevActor = this.actor;
    this.actor = 'användare';
    try {
      const objects: OntologyObject[] = [];
      let ws: Property;
      if ('id' in input.workspace) {
        const found = await this.store.get('property', input.workspace.id);
        if (!found) throw new ValidationError([`arbetsytan ${input.workspace.id} finns inte`]);
        ws = found;
      } else {
        const [p, e] = this.newWorkspace(input.workspace.new);
        ws = p;
        objects.push(p, e);
      }
      let place: Space | undefined;
      if (input.place && 'id' in input.place) {
        place = await this.store.get('space', input.place.id);
        if (!place) throw new ValidationError([`platsen ${input.place.id} finns inte`]);
      } else if (input.place) {
        const [s, e] = this.newSpace({ ...input.place.new, propertyId: ws.id });
        place = s;
        objects.push(s, e);
      }
      let item: Item;
      if ('id' in input.item) {
        const found = await this.store.get('item', input.item.id);
        if (!found) throw new ValidationError([`föremålet ${input.item.id} finns inte`]);
        item = found;
        // Sett på en annan plats än registrerat → flytta föremålet i samma transaktion.
        if (place && place.id !== found.spaceId) {
          item = { ...found, spaceId: place.id, updatedAt: this.stamp() };
          objects.push(item, this.event('flyttad', 'item', item.id, ws.id, `${item.name} flyttad till ${place.name}`, { från: found.spaceId ?? null, till: place.id }));
        }
      } else {
        const [i, e] = this.newItem({ ...input.item.new, propertyId: ws.id, spaceId: place?.id });
        item = i;
        objects.push(i, e);
      }
      const t = this.stamp();
      const o: Observation = {
        type: 'observation', id: newId('observation'), createdAt: t, updatedAt: t,
        propertyId: ws.id, spaceId: place?.id ?? item.spaceId, itemId: item.id,
        title: input.observation.title, category: input.observation.category, severity: input.observation.severity ?? 1,
        note: input.observation.note, metadata: input.observation.metadata,
        status: 'bekräftad', // användaren har granskat och godkänt förslaget
        source: 'kamera', confidence: input.detection.score, detection: input.detection,
        observedAt: input.observedAt ?? t,
      };
      objects.push(o, this.event('skapad', 'observation', o.id, ws.id,
        `Sparad i minnet: ${item.name} – ${o.title} (kamera ${Math.round(input.detection.score * 100)} %)`,
        { itemId: item.id, spaceId: o.spaceId ?? null, label: input.detection.label, score: input.detection.score }));
      await this.store.commit(objects);
      return { workspace: ws, place, item, observation: o };
    } finally {
      this.actor = prevActor;
    }
  }
}

export interface CaptureInput {
  workspace: { id: string } | { new: { name: string; kind: WorkspaceKind; address?: string } };
  place?: { id: string } | { new: { name: string; kind: SpaceKind; parentSpaceId?: string } };
  item: { id: string } | { new: { name: string; category: ItemCategory; brand?: string; model?: string; note?: string } };
  observation: { title: string; category: ObservationCategory; severity?: Severity; note?: string; metadata?: Record<string, MetaValue> };
  detection: DetectionInfo;
  observedAt?: string;
}

export interface CaptureResult { workspace: Property; place?: Space; item: Item; observation: Observation }
