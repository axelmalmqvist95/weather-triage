import { SEVERITY_LABEL, type Observation } from '../ontology/schema.ts';

export interface FieldChange { field: string; label: string; before: string; after: string }
export interface Comparison {
  older: Observation;
  newer: Observation;
  days: number;
  changes: FieldChange[];
  unchanged: string[];
  notes: string[];
}

export class CompareError extends Error {}

const show = (v: unknown) => (v === undefined || v === null || v === '' ? '–' : String(v));

/**
 * COMPARE: jämför två lagrade observationer av samma föremål, fält för fält.
 * Jämför ENDAST registrerade data – inga bilder finns, så inga visuella skillnader påstås.
 */
export function compareObservations(a: Observation, b: Observation, names: Map<string, string> = new Map()): Comparison {
  if (!a.itemId || !b.itemId) throw new CompareError('Båda observationerna måste vara kopplade till ett föremål.');
  if (a.itemId !== b.itemId) throw new CompareError('Observationerna gäller olika föremål och kan inte jämföras.');
  if (a.id === b.id) throw new CompareError('Välj två olika observationer.');
  const [older, newer] = a.observedAt <= b.observedAt ? [a, b] : [b, a];
  const place = (o: Observation) => (o.spaceId ? names.get(o.spaceId) ?? o.spaceId : undefined);
  const pct = (o: Observation) => (o.confidence !== undefined ? `${Math.round(o.confidence * 100)} %` : undefined);

  const fields: [string, string, (o: Observation) => unknown][] = [
    ['status', 'Status', (o) => o.status],
    ['title', 'Rubrik', (o) => o.title],
    ['category', 'Kategori', (o) => o.category],
    ['severity', 'Allvarlighet', (o) => `${o.severity} – ${SEVERITY_LABEL[o.severity]}`],
    ['place', 'Plats', place],
    ['note', 'Anteckning', (o) => o.note],
    ['source', 'Källa', (o) => o.source],
    ['detection', 'Kamerans klass', (o) => o.detection?.label],
    ['confidence', 'Modellens säkerhet', pct],
  ];
  const keys = [...new Set([...Object.keys(older.metadata ?? {}), ...Object.keys(newer.metadata ?? {})])].sort();
  for (const k of keys) fields.push([`metadata.${k}`, `Metadata: ${k}`, (o) => o.metadata?.[k]]);

  const changes: FieldChange[] = [];
  const unchanged: string[] = [];
  for (const [field, label, get] of fields) {
    const before = show(get(older)), after = show(get(newer));
    if (before !== after) changes.push({ field, label, before, after });
    else unchanged.push(label);
  }
  const notes = ['Visuella skillnader jämförs inte – inga bilder sparas. Jämförelsen gäller bara registrerade uppgifter.'];
  if (changes.some((c) => c.field === 'confidence')) {
    notes.push('Ändrad säkerhet speglar kamerans bedömning (ljus, vinkel, avstånd) – inte att föremålet förändrats.');
  }
  const days = Math.round(((Date.parse(newer.observedAt) - Date.parse(older.observedAt)) / 86400_000) * 10) / 10;
  return { older, newer, days, changes, unchanged, notes };
}
