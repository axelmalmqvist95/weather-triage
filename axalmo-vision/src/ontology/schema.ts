/**
 * Axalmo Intelligence – ontologi v1.
 *
 * Objekttyper (v2):
 *   Arbetsyta/projekt (property – id-prefix "prop_" behålls för bakåtkompatibilitet; kind anger typ),
 *   Plats (space), Föremål (item), Observation (observation), Relation (relation), Händelse (event).
 * Implicita länkar via referensfält:
 *   property ─har-plats→ space ─del-av→ space
 *   space ─innehåller→ item ;  (space | item) ─har-observation→ observation
 *   event ─avser→ (property | space | item | observation | relation)
 * Explicita länkar: relation (från → till, med typ).
 *
 * Schemahistorik: v1 = property/space/observation/event. v2 = tillägg av item, relation, property.kind,
 * observation.itemId/detection/metadata (spaceId valfritt om itemId finns). Inga v1-poster behöver skrivas om.
 *
 * Integritet: ontologin har ingen objekttyp för personer. Aktören är alltid en roll, aldrig en individ,
 * och policy.ts avvisar data som ser ut att identifiera personer.
 */

export const SCHEMA_VERSION = 2;
export const SUPPORTED_IMPORT_VERSIONS = [1, 2] as const;

export const OBJECT_TYPES = ['property', 'space', 'item', 'observation', 'relation', 'event'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];
export type SubjectType = Exclude<ObjectType, 'event'>;
export const SUBJECT_TYPES: readonly SubjectType[] = ['property', 'space', 'item', 'observation', 'relation'];

export const SPACE_KINDS = [
  'rum', 'kök', 'badrum', 'tvättstuga', 'källare', 'vind', 'trapphus', 'garage', 'fasad', 'tak', 'utomhus', 'teknikrum', 'övrigt',
  // v2: allmänna platser
  'förråd', 'skåp', 'hylla', 'låda', 'fordon', 'kontor', 'verkstad',
] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];

/** v2: typ av arbetsyta. Saknas fältet (v1-data) tolkas det som "fastighet". */
export const WORKSPACE_KINDS = ['fastighet', 'hem', 'bil', 'förråd', 'elektronik', 'projekt', 'övrigt'] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];
export const workspaceKind = (p: { kind?: WorkspaceKind }): WorkspaceKind => p.kind ?? 'fastighet';

export const ITEM_CATEGORIES = [
  'elektronik', 'möbel', 'fordon', 'verktyg', 'köksutrustning', 'vitvara', 'sport', 'kläder', 'dokument', 'förbrukning', 'växt', 'djur', 'övrigt',
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const ITEM_STATUSES = ['aktiv', 'saknas', 'utlånad', 'såld', 'kasserad'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const RELATION_KINDS = ['finns-i', 'del-av', 'tillhör', 'ersätter', 'relaterad'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export const OBSERVATION_CATEGORIES = [
  'fukt', 'mögel', 'spricka', 'rost', 'läckage', 'skada', 'brandskydd', 'el', 'ventilation', 'saknas', 'övrigt',
  // v2: allmänna observationer
  'inventering', 'skick', 'underhåll', 'placering', 'notering',
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

/** v2: "kamera" = användaren har granskat och godkänt ett förslag från objektigenkänningen. */
export const OBSERVATION_SOURCES = ['manuell', 'ai-förslag', 'import', 'syntetisk', 'kamera'] as const;
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];

export const EVENT_KINDS = ['skapad', 'uppdaterad', 'status-ändrad', 'inspektion', 'ai-förslag', 'kommentar', 'flyttad', 'relation'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Aktör är en roll – aldrig en namngiven person. */
export const ACTORS = ['inspektör', 'användare', 'system'] as const;
export type Actor = (typeof ACTORS)[number];

interface Base {
  id: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

/** Arbetsyta/projekt. Historiskt "fastighet" (v1); kind saknas i v1-data och tolkas då som "fastighet". */
export interface Property extends Base {
  type: 'property';
  name: string;
  /** Krävs för kind "fastighet", valfri annars. */
  address?: string;
  kind?: WorkspaceKind;
  municipality?: string;
  buildYear?: number;
}

/** Föremål/tillgång (v2). Tillhör en arbetsyta, kan ha en plats. */
export interface Item extends Base {
  type: 'item';
  propertyId: string;
  spaceId?: string;
  name: string;
  category: ItemCategory;
  status: ItemStatus;
  brand?: string;
  model?: string;
  note?: string;
}

export type LinkableType = 'property' | 'space' | 'item' | 'observation';

/** Explicit relation mellan två objekt i samma arbetsyta (v2). */
export interface Relation extends Base {
  type: 'relation';
  propertyId: string;
  kind: RelationKind;
  fromType: LinkableType;
  fromId: string;
  toType: LinkableType;
  toId: string;
  note?: string;
}

/** Vad objektigenkänningen faktiskt såg – sparas bara som text/tal, aldrig som bild. */
export interface DetectionInfo {
  label: string; // modellens klass (COCO), t.ex. "laptop"
  score: number; // 0–1
  model: string; // t.ex. "efficientdet_lite0"
}

export type MetaValue = string | number | boolean;

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
  /** v1: alltid satt. v2: valfri om itemId finns. */
  spaceId?: string;
  itemId?: string;
  title: string;
  category: ObservationCategory;
  severity: Severity;
  status: ObservationStatus;
  source: ObservationSource;
  /** 0–1, bara för maskinförslag */
  confidence?: number;
  note?: string;
  observedAt: string;
  detection?: DetectionInfo;
  metadata?: Record<string, MetaValue>;
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

export type OntologyObject = Property | Space | Item | Observation | Relation | OntologyEvent;

export const ID_PREFIX: Record<ObjectType, string> = { property: 'prop', space: 'space', item: 'item', observation: 'obs', relation: 'rel', event: 'evt' };

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
  if (p.kind !== undefined && !oneOf(WORKSPACE_KINDS, p.kind)) issues.push('kind ogiltig');
  if (workspaceKind(p) === 'fastighet' ? !nonEmpty(p.address) : p.address !== undefined && !nonEmpty(p.address)) issues.push('address krävs för fastighet (1–200 tecken)');
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
  if (o.spaceId !== undefined && (typeof o.spaceId !== 'string' || !o.spaceId.startsWith('space_'))) issues.push('spaceId ogiltigt');
  if (o.itemId !== undefined && (typeof o.itemId !== 'string' || !o.itemId.startsWith('item_'))) issues.push('itemId ogiltigt');
  if (o.spaceId === undefined && o.itemId === undefined) issues.push('spaceId eller itemId krävs');
  if (!nonEmpty(o.title)) issues.push('title krävs');
  if (!oneOf(OBSERVATION_CATEGORIES, o.category)) issues.push('category ogiltig');
  if (!oneOf(SEVERITIES, o.severity)) issues.push('severity måste vara 1–4');
  if (!oneOf(OBSERVATION_STATUSES, o.status)) issues.push('status ogiltig');
  if (!oneOf(OBSERVATION_SOURCES, o.source)) issues.push('source ogiltig');
  if (o.confidence !== undefined && !(o.confidence >= 0 && o.confidence <= 1)) issues.push('confidence måste vara 0–1');
  if (o.source === 'ai-förslag' && o.confidence === undefined) issues.push('AI-förslag kräver confidence');
  if (o.note !== undefined && o.note.length > 2000) issues.push('note för lång');
  if (!isIso(o.observedAt)) issues.push('observedAt måste vara ISO-datum');
  if (o.source === 'kamera' && !o.detection) issues.push('kameraobservation kräver detection');
  if (o.detection) {
    const d = o.detection;
    if (!nonEmpty(d.label, 60) || !nonEmpty(d.model, 60)) issues.push('detection.label/model krävs');
    if (!(d.score >= 0 && d.score <= 1)) issues.push('detection.score måste vara 0–1');
    if (isPersonLabel(d.label)) issues.push('detektioner av personer får inte sparas i minnet');
  }
  if (o.metadata) {
    for (const [k, v] of Object.entries(o.metadata)) {
      if (!['string', 'number', 'boolean'].includes(typeof v)) issues.push(`metadata.${k} måste vara ett enkelt värde`);
      if (typeof v === 'string' && v.length > 500) issues.push(`metadata.${k} för lång`);
    }
  }
  return issues;
}

/** Personetiketter från objektigenkänningen – får aldrig föras över till Memory. */
export const PERSON_LABELS = ['person'] as const;
export const isPersonLabel = (label: string) => (PERSON_LABELS as readonly string[]).includes(label.trim().toLowerCase());

export function validateItem(i: Item): string[] {
  const issues: string[] = [];
  checkBase(i, 'item', issues);
  if (i.type !== 'item') issues.push('type måste vara item');
  if (typeof i.propertyId !== 'string' || !i.propertyId.startsWith('prop_')) issues.push('propertyId krävs');
  if (i.spaceId !== undefined && !i.spaceId.startsWith('space_')) issues.push('spaceId ogiltigt');
  if (!nonEmpty(i.name)) issues.push('name krävs');
  if (!oneOf(ITEM_CATEGORIES, i.category)) issues.push('category ogiltig');
  if (!oneOf(ITEM_STATUSES, i.status)) issues.push('status ogiltig');
  for (const f of ['brand', 'model'] as const) if (i[f] !== undefined && !nonEmpty(i[f], 100)) issues.push(`${f} ogiltigt`);
  if (i.note !== undefined && i.note.length > 2000) issues.push('note för lång');
  return issues;
}

const LINKABLE: readonly LinkableType[] = ['property', 'space', 'item', 'observation'];

export function validateRelation(r: Relation): string[] {
  const issues: string[] = [];
  checkBase(r, 'relation', issues);
  if (r.type !== 'relation') issues.push('type måste vara relation');
  if (typeof r.propertyId !== 'string' || !r.propertyId.startsWith('prop_')) issues.push('propertyId krävs');
  if (!oneOf(RELATION_KINDS, r.kind)) issues.push('kind ogiltig');
  if (!oneOf(LINKABLE, r.fromType) || !r.fromId?.startsWith(`${ID_PREFIX[r.fromType]}_`)) issues.push('från-objekt ogiltigt');
  if (!oneOf(LINKABLE, r.toType) || !r.toId?.startsWith(`${ID_PREFIX[r.toType]}_`)) issues.push('till-objekt ogiltigt');
  if (r.fromId === r.toId) issues.push('ett objekt kan inte relatera till sig självt');
  if (r.note !== undefined && r.note.length > 500) issues.push('note för lång');
  return issues;
}

export function validateEvent(e: OntologyEvent): string[] {
  const issues: string[] = [];
  if (e.type !== 'event') issues.push('type måste vara event');
  if (typeof e.id !== 'string' || !e.id.startsWith('evt_')) issues.push('id måste börja med evt_');
  if (!isIso(e.at)) issues.push('at måste vara ISO-datum');
  if (!oneOf(EVENT_KINDS, e.kind)) issues.push('kind ogiltig');
  if (!oneOf(SUBJECT_TYPES, e.subjectType)) issues.push('subjectType ogiltig');
  if (typeof e.subjectId !== 'string' || !e.subjectId.startsWith(`${ID_PREFIX[e.subjectType] ?? '?'}_`)) issues.push('subjectId matchar inte subjectType');
  if (typeof e.propertyId !== 'string' || !e.propertyId.startsWith('prop_')) issues.push('propertyId krävs');
  if (!nonEmpty(e.summary, 500)) issues.push('summary krävs');
  if (!oneOf(ACTORS, e.actor)) issues.push('actor måste vara en roll (inspektör/användare/system)');
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
    case 'item': return validateItem(o);
    case 'observation': return validateObservation(o);
    case 'relation': return validateRelation(o);
    case 'event': return validateEvent(o);
    default: return ['okänd objekttyp'];
  }
}
