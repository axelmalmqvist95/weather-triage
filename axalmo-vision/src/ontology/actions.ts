import {
  STATUS_TRANSITIONS, ValidationError, newId,
  type Actor, type EventKind, type EventValue, type Observation, type ObservationCategory, type ObservationSource,
  type ObservationStatus, type OntologyEvent, type Property, type Severity, type Space, type SpaceKind, type SubjectType,
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

  async createProperty(input: { name: string; address: string; municipality?: string; buildYear?: number }): Promise<Property> {
    const t = this.stamp();
    const p: Property = { type: 'property', id: newId('property'), createdAt: t, updatedAt: t, ...input };
    await this.store.commit([p, this.event('skapad', 'property', p.id, p.id, `Fastighet skapad: ${p.name}`)]);
    return p;
  }

  async createSpace(input: { propertyId: string; name: string; kind: SpaceKind; parentSpaceId?: string; floor?: number; areaM2?: number }): Promise<Space> {
    const t = this.stamp();
    const s: Space = { type: 'space', id: newId('space'), createdAt: t, updatedAt: t, ...input };
    await this.store.commit([s, this.event('skapad', 'space', s.id, s.propertyId, `Yta skapad: ${s.name} (${s.kind})`, { kind: s.kind })]);
    return s;
  }

  async createObservation(input: {
    spaceId: string; title: string; category: ObservationCategory; severity: Severity;
    source?: ObservationSource; confidence?: number; note?: string; observedAt?: string;
  }): Promise<Observation> {
    const space = await this.store.get('space', input.spaceId);
    if (!space) throw new ValidationError([`ytan ${input.spaceId} finns inte`]);
    const t = this.stamp();
    const source = input.source ?? 'manuell';
    const o: Observation = {
      ...input,
      type: 'observation', id: newId('observation'), createdAt: t, updatedAt: t, propertyId: space.propertyId,
      status: 'öppen', source, observedAt: input.observedAt ?? t,
    };
    const kind: EventKind = source === 'ai-förslag' ? 'ai-förslag' : 'skapad';
    const summary = source === 'ai-förslag'
      ? `AI-förslag i ${space.name}: ${o.title} (${Math.round((o.confidence ?? 0) * 100)} %)`
      : `Observation i ${space.name}: ${o.title}`;
    await this.store.commit([o, this.event(kind, 'observation', o.id, o.propertyId, summary, { category: o.category, severity: o.severity, spaceId: space.id })]);
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
}
