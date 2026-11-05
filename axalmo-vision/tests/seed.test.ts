import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedSyntheticData } from '../src/ontology/seed.ts';
import { validate } from '../src/ontology/schema.ts';
import { privacyIssues } from '../src/ontology/policy.ts';
import { freshOntology } from './helpers.ts';

const BASE = new Date('2026-11-01T12:00:00.000Z');

test('syntetisk data är giltig, integritetssäker och konsekvent', async () => {
  const { ont, store } = await freshOntology();
  const r = await seedSyntheticData(ont, { seed: 7, base: BASE });
  assert.equal(r.properties, 3);
  assert.ok(r.spaces >= 15);
  assert.ok(r.observations >= 8);
  const dump = await store.exportDump();
  const all = [...dump.properties, ...dump.spaces, ...dump.observations, ...dump.events];
  for (const o of all) {
    assert.deepEqual(validate(o), [], `${o.id}`);
    assert.deepEqual(privacyIssues(o), [], `${o.id}`);
  }
  // Varje objekt har minst en händelse (revisionsspår)
  const subjects = new Set(dump.events.map((e) => e.subjectId));
  for (const o of [...dump.properties, ...dump.spaces, ...dump.observations]) assert.ok(subjects.has(o.id), o.id);
  // Tidsstämplar inom 60 dagar före bas och inte i framtiden
  for (const e of dump.events) {
    const t = Date.parse(e.at);
    assert.ok(t <= BASE.getTime() && t >= BASE.getTime() - 61 * 86400_000, e.at);
  }
  // Demodatan innehåller minst ett kritiskt, ej åtgärdat fynd
  assert.ok(dump.observations.some((o) => o.severity === 4 && o.status !== 'åtgärdad' && o.status !== 'avvisad'));
  // Klockan och aktören återställs
  assert.equal(ont.actor, 'inspektör');
});

test('samma seed ger samma mängd data', async () => {
  const a = await freshOntology();
  const b = await freshOntology();
  assert.deepEqual(await seedSyntheticData(a.ont, { seed: 3, base: BASE }), await seedSyntheticData(b.ont, { seed: 3, base: BASE }));
  assert.deepEqual(await a.store.counts(), await b.store.counts());
});
