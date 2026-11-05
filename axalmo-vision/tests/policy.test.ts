import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privacyIssues } from '../src/ontology/policy.ts';
import { newId, type Observation, type OntologyEvent } from '../src/ontology/schema.ts';

const T = '2026-01-01T10:00:00.000Z';
const obs = (title: string, note?: string): Observation => ({
  type: 'observation', id: newId('observation'), createdAt: T, updatedAt: T, propertyId: newId('property'), spaceId: newId('space'),
  title, note, category: 'fukt', severity: 2, status: 'öppen', source: 'manuell', observedAt: T,
});

test('saklig text godkänns', () => {
  assert.deepEqual(privacyIssues(obs('Fuktfläck 30 cm vid golvbrunn', 'Mätt 2026-01-01, 18 % RF')), []);
});

test('personnummer, e-post och mobilnummer i fritext avvisas', () => {
  assert.ok(privacyIssues(obs('Ägare 19800101-1234')).some((i) => i.includes('personnummer')));
  assert.ok(privacyIssues(obs('Kontakt', 'mejla test@example.se')).some((i) => i.includes('e-post')));
  assert.ok(privacyIssues(obs('Ring 070-123 45 67')).some((i) => i.includes('mobilnummer')));
});

test('persondatafält i händelsedata avvisas', () => {
  const e: OntologyEvent = {
    type: 'event', id: newId('event'), at: T, kind: 'kommentar', subjectType: 'property', subjectId: newId('property'),
    propertyId: newId('property'), summary: 'Kommentar', actor: 'inspektör', data: { personnamn: 'x', ansiktsId: 'y', antal: 1 },
  };
  const issues = privacyIssues(e);
  assert.equal(issues.filter((i) => i.includes('inte tillåtet')).length, 2);
});
