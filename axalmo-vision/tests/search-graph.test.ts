import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterEvents, countByKind } from '../src/ontology/search.ts';
import { buildGraph, neighbours } from '../src/ontology/graph.ts';
import { freshOntology, sampleTree } from './helpers.ts';

async function setup() {
  const { ont, store } = await freshOntology();
  const tree = await sampleTree(ont);
  const p2 = await ont.createProperty({ name: 'Annat hus', address: 'Vägen 2' });
  await ont.setObservationStatus(tree.obs.id, 'bekräftad');
  const data = {
    properties: await store.all('property'), spaces: await store.all('space'),
    observations: await store.all('observation'), events: await store.events(),
  };
  const labels = new Map<string, string>([...data.properties, ...data.spaces].map((o) => [o.id, o.name]));
  for (const o of data.observations) labels.set(o.id, o.title);
  return { ...tree, p2, data, labels };
}

test('fritext: alla ord måste matcha, skiftlägesokänsligt med å/ä/ö', async () => {
  const { data, labels } = await setup();
  assert.equal(filterEvents(data.events, { text: 'FUKT golvbrunn' }, labels).length, 2);
  assert.equal(filterEvents(data.events, { text: 'tvättstuga' }, labels).length, 2);
  assert.equal(filterEvents(data.events, { text: 'testfastighet' }, labels).length, 5, 'matchar via fastighetens namn');
  assert.equal(filterEvents(data.events, { text: 'fukt vid' }, labels).length, 2, 'statusändring matchar via observationens titel');
  assert.equal(filterEvents(data.events, { text: 'fukt finnsinte' }, labels).length, 0);
});

test('filter på typ, objekttyp, fastighet, objekt och tid', async () => {
  const { data, p, p2, obs } = await setup();
  assert.equal(filterEvents(data.events, { kinds: ['status-ändrad'] }).length, 1);
  assert.equal(filterEvents(data.events, { subjectTypes: ['space'] }).length, 2);
  assert.equal(filterEvents(data.events, { propertyId: p2.id }).length, 1);
  assert.equal(filterEvents(data.events, { propertyId: p.id }).length, 5);
  assert.equal(filterEvents(data.events, { subjectId: obs.id }).length, 2);
  const sorted = [...data.events].sort((a, b) => a.at.localeCompare(b.at));
  const mid = sorted[2].at;
  assert.equal(filterEvents(data.events, { from: mid }).length, sorted.length - 2);
  assert.equal(filterEvents(data.events, { to: mid }).length, 3);
});

test('resultat sorteras nyast först och räknas per typ', async () => {
  const { data } = await setup();
  const r = filterEvents(data.events, {});
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].at >= r[i].at);
  assert.deepEqual(countByKind(data.events), { skapad: 5, 'status-ändrad': 1 });
});

test('relationsgraf: noder, kanter och grannar', async () => {
  const { data, p, källare, tvätt, obs } = await setup();
  const g = buildGraph(data, p.id);
  assert.equal(g.nodes.length, 4);
  assert.deepEqual(
    g.edges.map((e) => e.type).sort(),
    ['del-av', 'har-observation', 'har-yta'],
  );
  assert.ok(g.edges.some((e) => e.type === 'del-av' && e.from === källare.id && e.to === tvätt.id));
  const nb = neighbours(g, tvätt.id);
  assert.deepEqual([...nb].sort(), [källare.id, obs.id, tvätt.id].sort());
  assert.equal(g.nodes.find((n) => n.id === obs.id)?.events, 2);
  assert.ok(g.bounds.width > 0 && g.bounds.height > 0);
  for (const n of g.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
});

test('graf för okänd fastighet är tom', async () => {
  const { data } = await setup();
  assert.equal(buildGraph(data, 'prop_saknas').nodes.length, 0);
});
