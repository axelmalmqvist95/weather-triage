import { IDBFactory } from 'fake-indexeddb';
import { openStore } from '../src/ontology/store.ts';
import { Ontology } from '../src/ontology/actions.ts';

/** Ny, isolerad IndexedDB per test. */
export async function freshStore(factory = new IDBFactory()) {
  const store = await openStore(factory, 'test-db');
  return { store, factory };
}

/** Ontologi med styrd klocka (start 2026-01-01, +1 min per anrop). */
export async function freshOntology() {
  const { store, factory } = await freshStore();
  const ont = new Ontology(store);
  let t = Date.parse('2026-01-01T08:00:00.000Z');
  ont.now = () => new Date((t += 60_000));
  return { ont, store, factory };
}

export async function sampleTree(ont: Ontology) {
  const p = await ont.createProperty({ name: 'Testfastighet', address: 'Exempelgatan 1' });
  const källare = await ont.createSpace({ propertyId: p.id, name: 'Källare', kind: 'källare' });
  const tvätt = await ont.createSpace({ propertyId: p.id, name: 'Tvättstuga', kind: 'tvättstuga', parentSpaceId: källare.id });
  const obs = await ont.createObservation({ spaceId: tvätt.id, title: 'Fukt vid golvbrunn', category: 'fukt', severity: 3 });
  return { p, källare, tvätt, obs };
}
