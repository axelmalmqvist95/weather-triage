import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from '../src/ontology/schema.ts';
import { buildCaptureDraft, itemCategoryFor, uncertaintyOf } from '../src/memory/capture.ts';
import { freshOntology } from './helpers.ts';

const det = (label: string, score = 0.8) => ({ label, score, model: 'efficientdet_lite0' });

test('CAPTURE-förslag bygger bara på det kameran såg', () => {
  const d = buildCaptureDraft({ label: 'laptop', name: 'Laptop', score: 0.7834, scene: 'Kontor / arbetsplats' })!;
  assert.equal(d.itemName, 'Laptop');
  assert.equal(d.itemCategory, 'elektronik');
  assert.deepEqual(d.detection, { label: 'laptop', score: 0.78, model: 'efficientdet_lite0' });
  assert.equal(d.placeKind, 'kontor');
  assert.equal(d.uncertainty, 'hög');
  assert.equal(itemCategoryFor('okänd-klass'), 'övrigt');
  assert.equal(uncertaintyOf(0.49), 'låg');
  assert.equal(uncertaintyOf(0.6), 'medel');
});

test('CAPTURE: personer ger inget förslag', () => {
  assert.equal(buildCaptureDraft({ label: 'person', name: 'Människa', score: 0.99 }), null);
  assert.equal(buildCaptureDraft({ label: ' Person ', name: 'Människa', score: 0.99 }), null);
});

test('CAPTURE → MEMORY: ny arbetsyta, plats, föremål och observation sparas atomiskt med källa, tid och osäkerhet', async () => {
  const { ont, store } = await freshOntology();
  const r = await ont.capture({
    workspace: { new: { name: 'Hemma', kind: 'hem' } },
    place: { new: { name: 'Kök', kind: 'kök' } },
    item: { new: { name: 'Mikrovågsugn', category: 'vitvara' } },
    observation: { title: 'Registrerad: Mikro', category: 'inventering', note: 'Fungerar' },
    detection: det('microwave', 0.67),
    observedAt: '2026-03-01T10:00:00.000Z',
  });
  const c = await store.counts();
  assert.deepEqual(c, { property: 1, space: 1, item: 1, observation: 1, relation: 0, event: 4 });
  const o = r.observation;
  assert.equal(o.source, 'kamera');
  assert.equal(o.status, 'bekräftad');
  assert.equal(o.confidence, 0.67);
  assert.deepEqual(o.detection, det('microwave', 0.67));
  assert.equal(o.observedAt, '2026-03-01T10:00:00.000Z');
  assert.equal(o.itemId, r.item.id);
  assert.equal(o.spaceId, r.place!.id);
  assert.equal(r.item.spaceId, r.place!.id);
  const evs = await store.events();
  assert.ok(evs.every((e) => e.actor === 'användare'), 'aktören är en roll');
  assert.equal(ont.actor, 'inspektör', 'aktören återställs');
  assert.ok(!JSON.stringify(await store.exportDump()).match(/data:image|blob:|\.jpg|\.png/), 'inga bilder sparas');
});

test('CAPTURE av befintligt föremål på ny plats registrerar flytt i samma transaktion', async () => {
  const { ont, store } = await freshOntology();
  const first = await ont.capture({
    workspace: { new: { name: 'Hemma', kind: 'hem' } }, place: { new: { name: 'Kontor', kind: 'kontor' } },
    item: { new: { name: 'Laptop', category: 'elektronik' } }, observation: { title: 'A', category: 'inventering' }, detection: det('laptop'),
  });
  const vard = await ont.createSpace({ propertyId: first.workspace.id, name: 'Vardagsrum', kind: 'rum' });
  const second = await ont.capture({
    workspace: { id: first.workspace.id }, place: { id: vard.id }, item: { id: first.item.id },
    observation: { title: 'B', category: 'skick' }, detection: det('laptop', 0.6),
  });
  assert.equal(second.item.spaceId, vard.id);
  assert.equal((await store.get('item', first.item.id))?.spaceId, vard.id);
  const moved = (await store.byIndex('event', 'subjectId', first.item.id)).filter((e) => e.kind === 'flyttad');
  assert.equal(moved.length, 1);
  assert.equal(moved[0].data?.['från'], first.place!.id);
});

test('CAPTURE avvisar personetiketter och skriver ingenting', async () => {
  const { ont, store } = await freshOntology();
  await assert.rejects(ont.capture({
    workspace: { new: { name: 'Hemma', kind: 'hem' } }, item: { new: { name: 'X', category: 'övrigt' } },
    observation: { title: 'X', category: 'notering' }, detection: det('person', 0.95),
  }), /personer/);
  assert.equal((await store.counts()).property, 0);
});

test('CAPTURE är atomisk: fel referens → inget av arbetsyta/plats/föremål sparas', async () => {
  const { ont, store } = await freshOntology();
  const other = await ont.createWorkspace({ name: 'Bilen', kind: 'bil' });
  const otherPlace = await ont.createSpace({ propertyId: other.id, name: 'Bagage', kind: 'fordon' });
  const before = await store.counts();
  await assert.rejects(ont.capture({
    workspace: { new: { name: 'Hemma', kind: 'hem' } }, place: { id: otherPlace.id },
    item: { new: { name: 'Väska', category: 'kläder' } }, observation: { title: 'X', category: 'inventering' }, detection: det('backpack'),
  }), ValidationError);
  assert.deepEqual(await store.counts(), before);
});

test('CAPTURE: persondata i fritext och metadata avvisas', async () => {
  const { ont, store } = await freshOntology();
  await assert.rejects(ont.capture({
    workspace: { new: { name: 'Hemma', kind: 'hem' } }, item: { new: { name: 'Mobil', category: 'elektronik' } },
    observation: { title: 'Mobil', category: 'inventering', note: 'Ägare 19800101-1234' }, detection: det('cell phone'),
  }), /personnummer/);
  await assert.rejects(ont.capture({
    workspace: { new: { name: 'Hemma', kind: 'hem' } }, item: { new: { name: 'Mobil', category: 'elektronik' } },
    observation: { title: 'Mobil', category: 'inventering', metadata: { ägarnamn: 'x' } }, detection: det('cell phone'),
  }), /persondata/);
  assert.equal((await store.counts()).property, 0);
});
