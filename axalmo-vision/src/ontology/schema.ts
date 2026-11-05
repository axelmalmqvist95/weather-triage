/**
 * Axalmo Intelligence – ontologi v1.
 *
 * Objekttyper: Fastighet (property), Yta (space), Observation (observation), Händelse (event).
 * Länkar härleds från referensfält:
 *   property ─har-yta→ space ─del-av→ space
 *   space ─har-observation→ observation
 *   event ─avser→ (property | space | observation)
 *
 * Integritet: ontologin har ingen objekttyp för personer. Aktören är alltid en roll, aldrig en individ,
 * och policy.ts avvisar data som ser ut att identifiera personer.
 */

export const SCHEMA_VERSION = 1;

export const OBJECT_TYPES = ['property', 'space', 'observation', 'event'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];
export type SubjectType = Exclude<ObjectType, 'event'>;

export const SPACE_KINDS = [
  'rum', 'kök', 'badrum', 'tvättstuga', 'källare', 'vind', 'trapphus', 'garage', 'fasad', 'tak', 'utomhus', 'teknikrum', 'övrigt',
] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];

export const OBSERVATION_CATEGORIES = [
  'fukt', 'mögel', 'spricka', 'rost', 'läckage', 'skada', 'brandskydd', 'el', 'ventilation', 'saknas', 'övrigt',
] as const;
export type ObservationCategory = (typeof OBSERVATION_CATEGORIES)[number];

export const SEVERITIES = [1, 2, 3, 4] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABEL: Record<Severity, string> = { 1: 'Notering', 2: 'Låg', 3: 'Hög', 4: 'Kritisk' };

export const OBSERVATION_STATUSES = ['öppen', 'bekräftad', 'åtgärdad', 'avvisad'] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];

/** Tillåtna statusövergångar – ett avvisat AI-förslag kan inte bli åtgärdat utan att först bekräftas. */
export const STATUS_TRANSITIONS: Record<ObservationStatus, readonly ObservationStatus[]> = {
  öppen: ['bekräftad', 'avvisad'],
  bekräftad: ['åtgärdad', 'öppen'],
  åtgärdad: ['öppen'],
  avvisad: ['öppen'],
};

export const OBSERVATION_SOURCES = ['manuell', 'ai-förslag', 'import', 'syntetisk'] as const;
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];

export const EVENT_KINDS = ['skapad', 'uppdaterad', 'status-ändrad', 'inspektion', 'ai-förslag', 'kommentar'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Aktör är en roll – aldrig en namngiven person. */
export const ACTORS = ['inspektör', 'system'] as const;
export type Actor = (typeof ACTORS)[number];

interface Base {
  id: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export interface Property extends Base {
  type: 'property';
  name: string;
  address: string;
  municipality?: string;
  buildYear?: number;
}

export interface Space extends Base {
  type: 'space';
  propertyId: string;
  parentSpaceId?: string;
  name: string;
  kind: SpaceKind;
  floor?: number;
  areaM2?: number;
}

export interface Observation extends Base {
  type: 'observation';
  propertyId: string;
  spaceId: string;
  title: string;
  category: ObservationCategory;
  severity: Severity;
  status: ObservationStatus;
  source: ObservationSource;
  /** 0–1, bara för maskinförslag */
  confidence?: number;
  note?: string;
  observedAt: string;
}

export type EventValue = string | number | boolean | null;

export interface OntologyEvent {
  type: 'event';
  id: string;
  at: string; // ISO 8601
  kind: EventKind;
  subjectType: SubjectType;
  subjectId: string;
  propertyId: string;
  summary: string;
  actor: Actor;
  data?: Record<string, EventValue>;
}

export type OntologyObject = Property | Space | Observation | OntologyEvent;

export const ID_PREFIX: Record<ObjectType, string> = { property: 'prop', space: 'space', observation: 'obs', event: 'evt' };

export function newId(type: ObjectType): string {
  return `${ID_PREFIX[type]}_${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------- validering

export class ValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Ogiltigt objekt: ${issues.join('; ')}`);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

const isIso = (s: unknown) => typeof s === 'string' && !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s);
const nonEmpty = (s: unknown, max = 200) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const oneOf = <T>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

function checkBase(o: Partial<Base>, type: ObjectType, issues: string[]) {
  if (typeof o.id !== 'string' || !o.id.startsWith(`${ID_PREFIX[type]}_`)) issues.push(`id måste börja med ${ID_PREFIX[type]}_`);
  if (!isIso(o.createdAt)) issues.push('createdAt måste vara ISO-datum');
  if (!isIso(o.updatedAt)) issues.push('updatedAt måste vara ISO-datum');
}

export function validateProperty(p: Property): string[] {
  const issues: string[] = [];
  checkBase(p, 'property', issues);
  if (p.type !== 'property') issues.push('type måste vara property');
  if (!nonEmpty(p.name)) issues.push('name krävs (1–200 tecken)');
  if (!nonEmpty(p.address)) issues.push('address krävs (1–200 tecken)');
  if (p.buildYear !== undefined && (!Number.isInteger(p.buildYear) || p.buildYear < 1000 || p.buildYear > 2100)) issues.push('buildYear ogiltigt');
  return issues;
}

export function validateSpace(s: Space): string[] {
  const issues: string[] = [];
  checkBase(s, 'space', issues);
  if (s.type !== 'space') issues.push('type måste vara space');
  if (typeof s.propertyId !== 'string' || !s.propertyId.startsWith('prop_')) issues.push('propertyId krävs');
  if (s.parentSpaceId !== undefined && !s.parentSpaceId.startsWith('space_')) issues.push('parentSpaceId ogiltigt');
  if (s.parentSpaceId === s.id) issues.push('en yta kan inte vara del av sig själv');
  if (!nonEmpty(s.name)) issues.push('name krävs');
  if (!oneOf(SPACE_KINDS, s.kind)) issues.push(`kind måste vara en av: ${SPACE_KINDS.join(', ')}`);
  if (s.areaM2 !== undefined && !(s.areaM2 > 0 && s.areaM2 < 100000)) issues.push('areaM2 ogiltig');
  if (s.floor !== undefined && !Number.isInteger(s.floor)) issues.push('floor måste vara heltal');
  return issues;
}

export function validateObservation(o: Observation): string[] {
  const issues: string[] = [];
  checkBase(o, 'observation', issues);
  if (o.type !== 'observation') issues.push('type måste vara observation');
  if (typeof o.propertyId !== 'string' || !o.propertyId.startsWith('prop_')) issues.push('propertyId krävs');
  if (typeof o.spaceId !== 'string' || !o.spaceId.startsWith('space_')) issues.push('spaceId krävs');
  if (!nonEmpty(o.title)) issues.push('title krävs');
  if (!oneOf(OBSERVATION_CATEGORIES, o.category)) issues.push('category ogiltig');
  if (!oneOf(SEVERITIES, o.severity)) issues.push('severity måste vara 1–4');
  if (!oneOf(OBSERVATION_STATUSES, o.status)) issues.push('status ogiltig');
  if (!oneOf(OBSERVATION_SOURCES, o.source)) issues.push('source ogiltig');
  if (o.confidence !== undefined && !(o.confidence >= 0 && o.confidence <= 1)) issues.push('confidence måste vara 0–1');
  if (o.source === 'ai-förslag' && o.confidence === undefined) issues.push('AI-förslag kräver confidence');
  if (o.note !== undefined && o.note.length > 2000) issues.push('note för lång');
  if (!isIso(o.observedAt)) issues.push('observedAt måste vara ISO-datum');
  return issues;
}

export function validateEvent(e: OntologyEvent): string[] {
  const issues: string[] = [];
  if (e.type !== 'event') issues.push('type måste vara event');
  if (typeof e.id !== 'string' || !e.id.startsWith('evt_')) issues.push('id måste börja med evt_');
  if (!isIso(e.at)) issues.push('at måste vara ISO-datum');
  if (!oneOf(EVENT_KINDS, e.kind)) issues.push('kind ogiltig');
  if (!oneOf(['property', 'space', 'observation'] as const, e.subjectType)) issues.push('subjectType ogiltig');
  if (typeof e.subjectId !== 'string' || !e.subjectId.startsWith(`${ID_PREFIX[e.subjectType] ?? '?'}_`)) issues.push('subjectId matchar inte subjectType');
  if (typeof e.propertyId !== 'string' || !e.propertyId.startsWith('prop_')) issues.push('propertyId krävs');
  if (!nonEmpty(e.summary, 500)) issues.push('summary krävs');
  if (!oneOf(ACTORS, e.actor)) issues.push('actor måste vara en roll (inspektör/system)');
  if (e.data) {
    for (const [k, v] of Object.entries(e.data)) {
      if (!(v === null || ['string', 'number', 'boolean'].includes(typeof v))) issues.push(`data.${k} måste vara ett enkelt värde`);
    }
  }
  return issues;
}

export function validate(o: OntologyObject): string[] {
  switch (o.type) {
    case 'property': return validateProperty(o);
    case 'space': return validateSpace(o);
    case 'observation': return validateObservation(o);
    case 'event': return validateEvent(o);
    default: return ['okänd objekttyp'];
  }
}
