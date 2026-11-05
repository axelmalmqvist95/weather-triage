import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openStore } from '../src/ontology/store.ts';
import { Ontology } from '../src/ontology/actions.ts';
import { recall, itemHistory, isApproved, placeWithChildren, type MemoryData } from '../src/memory/recall.ts';
import { compareObservations, CompareError } from '../src/memory/compare.ts';

const det = (label: string, score: number) => ({ label, score, model: 'efficientdet_lite0' });

async function setup() {
  const store = await openStore(new IDBFactory(), 'mem');
  const ont = new Ontology(store);
  let t = Date.parse('2026-02-01T08:00:00.000Z');
  ont.now = () => new Date((t += 3600_000));
  const a = await ont.capture({
    workspace: { new: { name: 'Hemma', kind: 'hem' } }, place: { new: { name: 'Kontor', kind: 'kontor' } },
    item: { new: { name: 'Laptop', category: 'elektronik' } },
    observation: { title: 'Registrerad: Laptop', category: 'inventering', note: 'Laddare finns.', metadata: { batteri: 'bra' } },
    detection: det('laptop', 0.86), observedAt: '2026-02-01T10:00:00.000Z',
  });
  const ws = a.workspace.id;
  const hylla = await ont.createSpace({ propertyId: ws, name: 'Hylla', kind: 'hylla', parentSpaceId: a.place!.id });
  const vard = await ont.createSpace({ propertyId: ws, name: 'Vardagsrum', kind: 'rum' });
  const b = await ont.capture({
    workspace: { id: ws }, place: { id: vard.id }, item: { id: a.item.id },
    observation: { title: 'Kontroll: Laptop', category: 'skick', severity: 2, note: 'Repa på locket.', metadata: { batteri: 'sämre' } },
    detection: det('laptop', 0.71), observedAt: '2026-02-11T10:00:00.000Z',
  });
  const bok = await ont.capture({
    workspace: { id: ws }, place: { id: hylla.id }, item: { new: { name: 'Bok', category: 'dokument' } },
    observation: { title: 'Registrerad: Bok', category: 'inventering' }, detection: det('book', 0.55), observedAt: '2026-02-05T10:00:00.000Z',
  });
  const bil = await ont.createWorkspace({ name: 'Bilen', kind: 'bil' });
  const bag = await ont.createSpace({ propertyId: bil.id, name: 'Bagage', kind: 'fordon' });
  const v = await ont.createItem({ propertyId: bil.id, spaceId: bag.id, name: 'Väska', category: 'kläder' });
  const ai = await ont.createObservation({ itemId: v.id, title: 'AI-förslag: Väska', category: 'inventering', severity: 1, source: 'ai-förslag', confidence: 0.4 });
  const rejected = await ont.createObservation({ itemId: v.id, title: 'Fel', category: 'notering', severity: 1 });
  await ont.setObservationStatus(rejected.id, 'avvisad');
  await ont.relate({ fromType: 'item', fromId: bok.item.id, toType: 'item', toId: a.item.id, kind: 'relaterad', note: 'Manual till laptopen' });
  const data: MemoryData = {
    properties: await store.all('property'), spaces: await store.all('space'), items: await store.all('item'),
    observations: await store.all('observation'), relations: await store.all('relation'), events: await store.events(),
  };
  return { a, b, bok, ws, hylla, vard, bil, v, ai, rejected, data };
}

test('RECALL: bara godkända observationer (ej avvisade, ej obekräftade AI-förslag)', async () => {
  const { data, ai, rejected } = await setup();
  const ids = recall(data, {}).map((o) => o.id);
  assert.ok(!ids.includes(ai.id));
  assert.ok(!ids.includes(rejected.id));
  assert.equal(ids.length, 3);
  assert.ok(!isApproved(data.observations.find((o) => o.id === ai.id)!));
});

test('RECALL: filter på arbetsyta, plats (inkl. underplatser), föremål, datum och fritext', async () => {
  const { data, a, ws, bil, vard, bok } = await setup();
  assert.equal(recall(data, { workspaceId: ws }).length, 3);
  assert.equal(recall(data, { workspaceId: bil.id }).length, 0);
  assert.deepEqual(recall(data, { spaceId: a.place!.id }).map((o) => o.itemId), [bok.item.id, a.item.id], 'kontor inkl. hyllan');
  assert.equal(recall(data, { spaceId: vard.id }).length, 1);
  assert.equal(recall(data, { itemId: a.item.id }).length, 2);
  assert.equal(recall(data, { from: '2026-02-04T00:00:00.000Z', to: '2026-02-06T00:00:00.000Z' }).length, 1);
  assert.equal(recall(data, { text: 'repa laptop' }).length, 1);
  assert.equal(recall(data, { text: 'BOK hylla' }).length, 1, 'matchar platsnamn, skiftlägesokänsligt');
  const r = recall(data, {});
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].observedAt >= r[i].observedAt, 'nyast först');
  assert.equal(placeWithChildren(data.spaces, a.place!.id).size, 2);
});

test('historik och relationer för ett föremål', async () => {
  const { data, a, bok, vard } = await setup();
  const h = itemHistory(data, a.item.id)!;
  assert.equal(h.observations.length, 2);
  assert.ok(h.observations[0].observedAt < h.observations[1].observedAt);
  assert.ok(h.events.some((e) => e.kind === 'flyttad'));
  assert.deepEqual(h.relations[0], { kind: 'finns-i', direction: 'ut', otherId: vard.id });
  assert.ok(h.relations.some((r) => r.kind === 'relaterad' && r.direction === 'in' && r.otherId === bok.item.id));
  assert.equal(itemHistory(data, 'item_saknas'), null);
});

test('COMPARE: visar ändringar i status, anteckning, plats och metadata – bara registrerade fält', async () => {
  const { a, b, data } = await setup();
  const names = new Map(data.spaces.map((s) => [s.id, s.name]));
  const c = compareObservations(b.observation, a.observation, names); // ordningen spelar ingen roll
  assert.equal(c.older.id, a.observation.id);
  assert.equal(c.days, 10);
  const byField = Object.fromEntries(c.changes.map((x) => [x.field, x]));
  assert.deepEqual([byField.place.before, byField.place.after], ['Kontor', 'Vardagsrum']);
  assert.deepEqual([byField.note.before, byField.note.after], ['Laddare finns.', 'Repa på locket.']);
  assert.deepEqual([byField['metadata.batteri'].before, byField['metadata.batteri'].after], ['bra', 'sämre']);
  assert.equal(byField.severity.after, '2 – Låg');
  assert.equal(byField.confidence.before, '86 %');
  assert.ok(c.unchanged.includes('Status'));
  assert.ok(c.unchanged.includes('Kamerans klass'));
  // Inga påhittade visuella fält – bara kända fältnamn
  const known = /^(status|title|category|severity|place|note|source|detection|confidence|metadata\..+)$/;
  for (const ch of c.changes) assert.match(ch.field, known);
  assert.ok(c.notes.some((n) => n.includes('Visuella skillnader jämförs inte')));
  assert.ok(c.notes.some((n) => n.includes('kamerans bedömning')));
});

test('COMPARE: olika föremål, saknat föremål och samma observation avvisas', async () => {
  const { a, b, bok, data } = await setup();
  assert.throws(() => compareObservations(a.observation, bok.observation), CompareError);
  assert.throws(() => compareObservations(a.observation, a.observation), /två olika/);
  const noItem = { ...b.observation, itemId: undefined };
  assert.throws(() => compareObservations(a.observation, noItem), /kopplade till ett föremål/);
  assert.ok(data.observations.length >= 5);
});
