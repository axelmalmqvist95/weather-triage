import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { openStore, migrateDump, type Dump } from '../src/ontology/store.ts';
import { Ontology } from '../src/ontology/actions.ts';
import { validate } from '../src/ontology/schema.ts';

/** Fryst v1-export, skapad med v0.1-koden (commit 267a953) innan v2-ändringarna. */
const V1: Dump = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/intelligence-dump-v1.json'), 'utf8'));

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** Skapar en databas med EXAKT v1-schemat (kopia av v0.1) och fyller den med v1-data. */
async function createV1Database(factory: IDBFactory, name: string) {
  const open = factory.open(name, 1);
  open.onupgradeneeded = () => {
    const db = open.result;
    db.createObjectStore('properties', { keyPath: 'id' });
    const sp = db.createObjectStore('spaces', { keyPath: 'id' });
    sp.createIndex('propertyId', 'propertyId');
    sp.createIndex('parentSpaceId', 'parentSpaceId');
    const ob = db.createObjectStore('observations', { keyPath: 'id' });
    for (const i of ['propertyId', 'spaceId', 'status', 'category']) ob.createIndex(i, i);
    const ev = db.createObjectStore('events', { keyPath: 'id' });
    for (const i of ['at', 'subjectId', 'propertyId', 'kind']) ev.createIndex(i, i);
  };
  const db = await req(open);
  const tx = db.transaction(['properties', 'spaces', 'observations', 'events'], 'readwrite');
  for (const p of V1.properties) tx.objectStore('properties').put(p);
  for (const s of V1.spaces) tx.objectStore('spaces').put(s);
  for (const o of V1.observations) tx.objectStore('observations').put(o);
  for (const e of V1.events) tx.objectStore('events').put(e);
  await new Promise((r) => (tx.oncomplete = r));
  db.close();
}

test('IndexedDB v1 → v2: befintlig data orörd, nya lager och index skapas', async () => {
  const factory = new IDBFactory();
  await createV1Database(factory, 'mig');
  const store = await openStore(factory, 'mig');
  const dump = await store.exportDump(new Date(V1.exportedAt));
  assert.equal(dump.schemaVersion, 2);
  assert.deepEqual(dump.properties, V1.properties);
  assert.deepEqual(dump.spaces, V1.spaces);
  assert.deepEqual(dump.observations, V1.observations);
  assert.deepEqual(dump.events, V1.events);
  assert.deepEqual(dump.items, []);
  assert.deepEqual(dump.relations, []);
  // v1-poster är giltiga enligt v2-valideringen
  for (const o of [...dump.properties, ...dump.spaces, ...dump.observations, ...dump.events]) assert.deepEqual(validate(o), [], o.id);
  // nytt index fungerar
  assert.deepEqual(await store.byIndex('observation', 'itemId', 'item_x'), []);
  store.close();
});

test('efter migrering kan befintlig fastighet användas som arbetsyta i Memory', async () => {
  const factory = new IDBFactory();
  await createV1Database(factory, 'mig2');
  const store = await openStore(factory, 'mig2');
  const ont = new Ontology(store);
  const [prop] = V1.properties;
  const tvatt = V1.spaces.find((s) => s.name === 'Tvättstuga')!;
  const r = await ont.capture({
    workspace: { id: prop.id }, place: { id: tvatt.id }, item: { new: { name: 'Tvättmaskin', category: 'vitvara' } },
    observation: { title: 'Registrerad: Tvättmaskin', category: 'inventering' }, detection: { label: 'refrigerator', score: 0.55, model: 'efficientdet_lite0' },
  });
  assert.equal(r.item.propertyId, prop.id);
  assert.equal((await store.counts()).event, V1.events.length + 2);
});

test('JSON-import av v1-export migreras till v2 och ger identisk data', async () => {
  const store = await openStore(new IDBFactory(), 'imp');
  await store.importDump(structuredClone(V1));
  const dump = await store.exportDump(new Date(V1.exportedAt));
  assert.equal(dump.schemaVersion, 2);
  assert.deepEqual({ ...dump, schemaVersion: 1, items: undefined, relations: undefined }, { ...V1, items: undefined, relations: undefined });
  // v2-export → v2-import rundresa
  const again = await openStore(new IDBFactory(), 'imp2');
  await again.importDump(JSON.parse(JSON.stringify(dump)));
  assert.deepEqual(await again.exportDump(new Date(V1.exportedAt)), dump);
});

test('migrateDump: okända versioner och trasiga filer avvisas', () => {
  assert.throws(() => migrateDump({ ...V1, schemaVersion: 3 }), /stöds inte/);
  assert.throws(() => migrateDump({ ...V1, format: 'annat' as never }), /filformat/);
  assert.throws(() => migrateDump({ ...V1, events: undefined as never }), /events saknas/);
  const m = migrateDump(V1);
  assert.equal(m.schemaVersion, 2);
  assert.deepEqual(m.items, []);
});

test('en äldre öppen anslutning släpps när en nyare version öppnas (onversionchange)', async () => {
  const factory = new IDBFactory();
  const store = await openStore(factory, 'vc');
  const v3 = factory.open('vc', 3);
  const db3 = await req(v3);
  db3.close();
  await assert.rejects(async () => store.all('property'), /uppgraderats i en annan flik/);
});
