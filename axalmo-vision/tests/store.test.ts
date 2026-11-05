import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openStore, type Dump } from '../src/ontology/store.ts';
import { ValidationError, newId, type Property, type Space, type Observation, type OntologyEvent } from '../src/ontology/schema.ts';
import { freshOntology, freshStore, sampleTree } from './helpers.ts';

const T = '2026-01-01T10:00:00.000Z';
const prop = (): Property => ({ type: 'property', id: newId('property'), createdAt: T, updatedAt: T, name: 'Hus', address: 'Gatan 1' });
const space = (propertyId: string, parentSpaceId?: string): Space => ({
  type: 'space', id: newId('space'), createdAt: T, updatedAt: T, propertyId, name: 'Rum', kind: 'rum', ...(parentSpaceId ? { parentSpaceId } : {}),
});

test('skapar objektlager och index vid första öppning', async () => {
  const { store } = await freshStore();
  assert.deepEqual(await store.counts(), { property: 0, space: 0, item: 0, observation: 0, relation: 0, event: 0 });
  store.close();
});

test('commit + get + all', async () => {
  const { store } = await freshStore();
  const p = prop();
  const s = space(p.id);
  await store.commit([p, s]);
  assert.deepEqual(await store.get('property', p.id), p);
  assert.equal((await store.all('space')).length, 1);
  assert.deepEqual(await store.byIndex('space', 'propertyId', p.id), [s]);
});

test('referensintegritet: yta utan fastighet avvisas och inget skrivs (atomiskt)', async () => {
  const { store } = await freshStore();
  const p = prop();
  const orphan = space(newId('property'));
  await assert.rejects(store.commit([p, orphan]), (e: unknown) => e instanceof ValidationError && e.issues.some((i) => i.includes('finns inte')));
  assert.deepEqual(await store.counts(), { property: 0, space: 0, item: 0, observation: 0, relation: 0, event: 0 });
});

test('referensintegritet: underyta måste tillhöra samma fastighet', async () => {
  const { store } = await freshStore();
  const a = prop(), b = prop();
  const parent = space(a.id);
  await store.commit([a, b, parent]);
  await assert.rejects(store.commit([space(b.id, parent.id)]), /annan (fastighet|arbetsyta)/);
});

test('observation på yta i annan fastighet avvisas', async () => {
  const { store } = await freshStore();
  const a = prop(), b = prop(), s = space(a.id);
  await store.commit([a, b, s]);
  const o: Observation = {
    type: 'observation', id: newId('observation'), createdAt: T, updatedAt: T, propertyId: b.id, spaceId: s.id, title: 'X',
    category: 'fukt', severity: 2, status: 'öppen', source: 'manuell', observedAt: T,
  };
  await assert.rejects(store.commit([o]), /annan (fastighet|arbetsyta)/);
});

test('schemafel och integritetsfel avvisas innan transaktion', async () => {
  const { store } = await freshStore();
  await assert.rejects(store.commit([{ ...prop(), name: '' }]), ValidationError);
  await assert.rejects(store.commit([{ ...prop(), name: 'Ägare 19800101-1234' }]), /personnummer/);
  assert.equal((await store.counts()).property, 0);
});

test('händelseloggen är append-only', async () => {
  const { store } = await freshStore();
  const p = prop();
  const e: OntologyEvent = { type: 'event', id: newId('event'), at: T, kind: 'skapad', subjectType: 'property', subjectId: p.id, propertyId: p.id, summary: 'Skapad', actor: 'system' };
  await store.commit([p, e]);
  await assert.rejects(store.commit([{ ...e, summary: 'Ändrad historik' }]), /append-only/);
  assert.equal((await store.events())[0].summary, 'Skapad');
});

test('events() sorterar nyast först', async () => {
  const { ont, store } = await freshOntology();
  await sampleTree(ont);
  const ev = await store.events();
  assert.ok(ev.length >= 4);
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i - 1].at >= ev[i].at);
});

test('data finns kvar efter att databasen stängts och öppnats igen', async () => {
  const factory = new IDBFactory();
  const s1 = await openStore(factory, 'persist');
  const p = prop();
  await s1.commit([p]);
  s1.close();
  const s2 = await openStore(factory, 'persist');
  assert.deepEqual(await s2.get('property', p.id), p);
});

test('export → import ger identisk data', async () => {
  const { ont, store } = await freshOntology();
  await sampleTree(ont);
  const dump = await store.exportDump(new Date(T));
  const { store: other } = await freshStore();
  await other.importDump(JSON.parse(JSON.stringify(dump)) as Dump);
  const again = await other.exportDump(new Date(T));
  assert.deepEqual(again, dump);
});

test('import med fel schemaversion avvisas och befintlig data behålls', async () => {
  const { ont, store } = await freshOntology();
  await sampleTree(ont);
  const before = await store.counts();
  const dump = await store.exportDump();
  await assert.rejects(store.importDump({ ...dump, schemaVersion: 99 }), /schemaversion/);
  await assert.rejects(store.importDump({ ...dump, format: 'annat' as never }), /filformat/);
  assert.deepEqual(await store.counts(), before);
});

test('import med trasig referens rullas tillbaka helt', async () => {
  const { ont, store } = await freshOntology();
  await sampleTree(ont);
  const before = await store.exportDump(new Date(T));
  const broken = { ...before, spaces: before.spaces.map((s) => ({ ...s, propertyId: newId('property') })) };
  await assert.rejects(store.importDump(broken), ValidationError);
  assert.deepEqual(await store.exportDump(new Date(T)), before);
});

test('clear tömmer alla lager', async () => {
  const { ont, store } = await freshOntology();
  await sampleTree(ont);
  await store.clear();
  assert.deepEqual(await store.counts(), { property: 0, space: 0, item: 0, observation: 0, relation: 0, event: 0 });
});
