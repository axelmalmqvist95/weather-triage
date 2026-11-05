import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from '../src/ontology/schema.ts';
import { freshOntology, sampleTree } from './helpers.ts';

test('varje action skriver objekt och händelse', async () => {
  const { ont, store } = await freshOntology();
  const { p, tvätt, obs } = await sampleTree(ont);
  const c = await store.counts();
  assert.deepEqual(c, { property: 1, space: 2, item: 0, observation: 1, relation: 0, event: 4 });
  assert.equal(obs.propertyId, p.id, 'observation ärver fastighet från ytan');
  const evObs = await store.byIndex('event', 'subjectId', obs.id);
  assert.equal(evObs.length, 1);
  assert.equal(evObs[0].kind, 'skapad');
  assert.equal(evObs[0].data?.spaceId, tvätt.id);
});

test('AI-förslag loggas som ai-förslag och kräver konfidens', async () => {
  const { ont, store } = await freshOntology();
  const { tvätt } = await sampleTree(ont);
  await assert.rejects(ont.createObservation({ spaceId: tvätt.id, title: 'Rost', category: 'rost', severity: 2, source: 'ai-förslag' }), ValidationError);
  const o = await ont.createObservation({ spaceId: tvätt.id, title: 'Rost', category: 'rost', severity: 2, source: 'ai-förslag', confidence: 0.81 });
  const [e] = await store.byIndex('event', 'subjectId', o.id);
  assert.equal(e.kind, 'ai-förslag');
  assert.match(e.summary, /81 %/);
});

test('statuslivscykel loggas med från/till', async () => {
  const { ont, store } = await freshOntology();
  const { obs } = await sampleTree(ont);
  await ont.setObservationStatus(obs.id, 'bekräftad');
  const done = await ont.setObservationStatus(obs.id, 'åtgärdad', 'Tätat');
  assert.equal(done.status, 'åtgärdad');
  const ev = (await store.byIndex('event', 'subjectId', obs.id)).filter((e) => e.kind === 'status-ändrad');
  assert.equal(ev.length, 2);
  assert.ok(ev.some((e) => e.data?.['från'] === 'bekräftad' && e.data?.['till'] === 'åtgärdad'));
});

test('otillåten statusändring avvisas och lämnar objektet orört', async () => {
  const { ont, store } = await freshOntology();
  const { obs } = await sampleTree(ont);
  await assert.rejects(ont.setObservationStatus(obs.id, 'åtgärdad'), /inte tillåten/);
  assert.equal((await store.get('observation', obs.id))?.status, 'öppen');
});

test('updateObservation och addComment skapar händelser; klockan styr tidsstämpeln', async () => {
  const { ont, store } = await freshOntology();
  const { obs, p } = await sampleTree(ont);
  ont.now = () => new Date('2026-02-02T12:00:00.000Z');
  const u = await ont.updateObservation(obs.id, { severity: 4 });
  assert.equal(u.severity, 4);
  assert.equal(u.updatedAt, '2026-02-02T12:00:00.000Z');
  const c = await ont.addComment('property', p.id, 'Uppföljning planerad');
  assert.equal(c.at, '2026-02-02T12:00:00.000Z');
  assert.equal((await store.counts()).event, 6);
});

test('actions avvisar persondata via policyn', async () => {
  const { ont, store } = await freshOntology();
  const { p } = await sampleTree(ont);
  await assert.rejects(ont.addComment('property', p.id, 'Ring ägaren på 070-123 45 67'), /mobilnummer/);
  assert.equal((await store.counts()).event, 4);
});

test('observation på okänd yta avvisas', async () => {
  const { ont } = await freshOntology();
  await assert.rejects(ont.createObservation({ spaceId: 'space_saknas', title: 'X', category: 'fukt', severity: 1 }), /finns inte/);
});
