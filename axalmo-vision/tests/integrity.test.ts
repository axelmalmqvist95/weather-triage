import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError, newId, validateObservation, type Observation } from '../src/ontology/schema.ts';
import { freshOntology } from './helpers.ts';

test('föremål: plats i annan arbetsyta avvisas', async () => {
  const { ont, store } = await freshOntology();
  const hem = await ont.createWorkspace({ name: 'Hem', kind: 'hem' });
  const bil = await ont.createWorkspace({ name: 'Bil', kind: 'bil' });
  const bag = await ont.createSpace({ propertyId: bil.id, name: 'Bagage', kind: 'fordon' });
  await assert.rejects(ont.createItem({ propertyId: hem.id, spaceId: bag.id, name: 'X', category: 'övrigt' }), /annan arbetsyta/);
  assert.equal((await store.counts()).item, 0);
});

test('relation: över arbetsytor, till saknat objekt och till sig själv avvisas', async () => {
  const { ont, store } = await freshOntology();
  const hem = await ont.createWorkspace({ name: 'Hem', kind: 'hem' });
  const bil = await ont.createWorkspace({ name: 'Bil', kind: 'bil' });
  const a = await ont.createItem({ propertyId: hem.id, name: 'A', category: 'övrigt' });
  const b = await ont.createItem({ propertyId: bil.id, name: 'B', category: 'övrigt' });
  await assert.rejects(ont.relate({ fromType: 'item', fromId: a.id, toType: 'item', toId: b.id, kind: 'relaterad' }), /annan arbetsyta/);
  await assert.rejects(ont.relate({ fromType: 'item', fromId: a.id, toType: 'item', toId: 'item_saknas', kind: 'relaterad' }), /finns inte/);
  await assert.rejects(ont.relate({ fromType: 'item', fromId: a.id, toType: 'item', toId: a.id, kind: 'relaterad' }), /sig självt/);
  assert.equal((await store.counts()).relation, 0);
  const ok = await ont.relate({ fromType: 'item', fromId: a.id, toType: 'property', toId: hem.id, kind: 'tillhör' });
  assert.equal(ok.propertyId, hem.id);
});

test('observation: kräver plats eller föremål; v1-observation (bara plats) är fortsatt giltig', () => {
  const T = '2026-01-01T10:00:00.000Z';
  const base: Observation = {
    type: 'observation', id: newId('observation'), createdAt: T, updatedAt: T, propertyId: newId('property'),
    title: 'X', category: 'fukt', severity: 2, status: 'öppen', source: 'manuell', observedAt: T,
  };
  assert.ok(validateObservation(base).some((i) => i.includes('spaceId eller itemId')));
  assert.deepEqual(validateObservation({ ...base, spaceId: newId('space') }), []);
  assert.deepEqual(validateObservation({ ...base, itemId: newId('item') }), []);
  assert.ok(validateObservation({ ...base, itemId: newId('item'), source: 'kamera' }).some((i) => i.includes('kräver detection')));
  assert.ok(validateObservation({ ...base, itemId: newId('item'), detection: { label: 'person', score: 0.9, model: 'm' } }).some((i) => i.includes('personer')));
});

test('arbetsyta: adress krävs bara för fastighet', async () => {
  const { ont } = await freshOntology();
  await assert.rejects(ont.createProperty({ name: 'Hus' }), ValidationError);
  const bil = await ont.createWorkspace({ name: 'Bil', kind: 'bil' });
  assert.equal(bil.kind, 'bil');
});

test('flytt av föremål loggas med från/till', async () => {
  const { ont, store } = await freshOntology();
  const hem = await ont.createWorkspace({ name: 'Hem', kind: 'hem' });
  const a = await ont.createSpace({ propertyId: hem.id, name: 'A', kind: 'rum' });
  const b = await ont.createSpace({ propertyId: hem.id, name: 'B', kind: 'förråd' });
  const i = await ont.createItem({ propertyId: hem.id, spaceId: a.id, name: 'Lampa', category: 'elektronik' });
  const moved = await ont.moveItem(i.id, b.id);
  assert.equal(moved.spaceId, b.id);
  const [e] = (await store.byIndex('event', 'subjectId', i.id)).filter((x) => x.kind === 'flyttad');
  assert.deepEqual([e.data?.['från'], e.data?.['till']], [a.id, b.id]);
});
