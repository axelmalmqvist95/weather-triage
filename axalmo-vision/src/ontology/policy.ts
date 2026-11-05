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
  switch (o.type) {
    case 'property': return [o.name, o.address, o.municipality ?? ''];
    case 'space': return [o.name];
    case 'observation': return [o.title, o.note ?? ''];
    case 'event': return [o.summary, ...Object.values(o.data ?? {}).filter((v): v is string => typeof v === 'string')];
  }
}

export function privacyIssues(o: OntologyObject): string[] {
  const issues: string[] = [];
  if (o.type === 'event' && o.data) {
    for (const k of Object.keys(o.data)) if (FORBIDDEN_KEY.test(k)) issues.push(`fältet "${k}" är inte tillåtet (persondata)`);
  }
  for (const t of textFields(o)) {
    for (const p of PATTERNS) if (p.re.test(t)) issues.push(`text verkar innehålla ${p.what}`);
  }
  return issues;
}
