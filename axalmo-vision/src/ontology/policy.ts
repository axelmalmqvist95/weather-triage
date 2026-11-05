import type { OntologyObject } from './schema.ts';

/**
 * Integritetspolicy: ontologin får inte bli ett register över personer.
 * Kontrollen är ett skyddsnät (mönsterbaserad) – inte en garanti. Fritext bör hållas saklig.
 */

const FORBIDDEN_KEY = /person|personnummer|ssn|ansikt|face|biometr|e-?post|email|telefon|phone|identitet|identity|namn|fullname/i;
const PATTERNS: { re: RegExp; what: string }[] = [
  { re: /\b(19|20)?\d{6}[-+]?\d{4}\b/, what: 'personnummer' },
  { re: /[\w.+-]+@[\w-]+\.[\w.]+/, what: 'e-postadress' },
  { re: /(\+46|\b0)\s?7\d([\s-]?\d){7}\b/, what: 'mobilnummer' },
];

function textFields(o: OntologyObject): string[] {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (o.type) {
    case 'property': return [o.name, str(o.address), str(o.municipality)];
    case 'space': return [o.name];
    case 'item': return [o.name, str(o.brand), str(o.model), str(o.note)];
    case 'observation': return [o.title, str(o.note), ...Object.values(o.metadata ?? {}).map(str)];
    case 'relation': return [str(o.note)];
    case 'event': return [o.summary, ...Object.values(o.data ?? {}).map(str)];
  }
}

export function privacyIssues(o: OntologyObject): string[] {
  const issues: string[] = [];
  const keyed = o.type === 'event' ? o.data : o.type === 'observation' ? o.metadata : undefined;
  if (keyed) {
    for (const k of Object.keys(keyed)) if (FORBIDDEN_KEY.test(k)) issues.push(`fältet "${k}" är inte tillåtet (persondata)`);
  }
  for (const t of textFields(o)) {
    for (const p of PATTERNS) if (p.re.test(t)) issues.push(`text verkar innehålla ${p.what}`);
  }
  return issues;
}
