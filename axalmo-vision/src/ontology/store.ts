import {
  SCHEMA_VERSION, SUPPORTED_IMPORT_VERSIONS, ValidationError, validate,
  type Item, type LinkableType, type ObjectType, type Observation, type OntologyEvent, type OntologyObject,
  type Property, type Relation, type Space,
} from './schema.ts';
import { privacyIssues } from './policy.ts';

/**
 * Lokal lagring i IndexedDB (ingen server). Separat databas från Vision-delen.
 * Alla skrivningar valideras (schema + integritetspolicy + referenser) och sker i en transaktion.
 *
 * Versioner: v1 = properties/spaces/observations/events. v2 = + items, relations, index observations.itemId.
 * Uppgraderingen är additiv – inga befintliga poster skrivs om.
 */

/** Typkarta: objekttyp → TypeScript-typ. */
export interface ObjectByType {
  property: Property; space: Space; item: Item; observation: Observation; relation: Relation; event: OntologyEvent;
}

export const DB_NAME = 'axalmo-intelligence';
export const DB_VERSION = 2;

export const STORES = {
  property: 'properties', space: 'spaces', item: 'items', observation: 'observations', relation: 'relations', event: 'events',
} as const;
type StoreName = (typeof STORES)[keyof typeof STORES];
const ALL_STORES: StoreName[] = Object.values(STORES);

export interface Dump {
  format: 'axalmo-intelligence';
  schemaVersion: number;
  exportedAt: string;
  properties: Property[];
  spaces: Space[];
  items?: Item[]; // saknas i v1
  observations: Observation[];
  relations?: Relation[]; // saknas i v1
  events: OntologyEvent[];
}

/** Tar bort fält som är undefined så att lagrad data och JSON-export blir identiska. */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaktionen avbröts'));
  });

/** Kumulativ uppgradering. Varje steg får bara lägga till lager/index – aldrig skriva om data. */
export function upgrade(db: IDBDatabase, tx: IDBTransaction, oldVersion: number) {
  if (oldVersion < 1) {
    db.createObjectStore(STORES.property, { keyPath: 'id' });
    const sp = db.createObjectStore(STORES.space, { keyPath: 'id' });
    sp.createIndex('propertyId', 'propertyId');
    sp.createIndex('parentSpaceId', 'parentSpaceId');
    const ob = db.createObjectStore(STORES.observation, { keyPath: 'id' });
    ob.createIndex('propertyId', 'propertyId');
    ob.createIndex('spaceId', 'spaceId');
    ob.createIndex('status', 'status');
    ob.createIndex('category', 'category');
    const ev = db.createObjectStore(STORES.event, { keyPath: 'id' });
    ev.createIndex('at', 'at');
    ev.createIndex('subjectId', 'subjectId');
    ev.createIndex('propertyId', 'propertyId');
    ev.createIndex('kind', 'kind');
  }
  if (oldVersion < 2) {
    const it = db.createObjectStore(STORES.item, { keyPath: 'id' });
    it.createIndex('propertyId', 'propertyId');
    it.createIndex('spaceId', 'spaceId');
    it.createIndex('category', 'category');
    const rel = db.createObjectStore(STORES.relation, { keyPath: 'id' });
    rel.createIndex('propertyId', 'propertyId');
    rel.createIndex('fromId', 'fromId');
    rel.createIndex('toId', 'toId');
    tx.objectStore(STORES.observation).createIndex('itemId', 'itemId');
  }
}

export async function openStore(factory: IDBFactory = globalThis.indexedDB, name = DB_NAME): Promise<OntologyStore> {
  if (!factory) throw new Error('IndexedDB saknas i den här webbläsaren.');
  const open = factory.open(name, DB_VERSION);
  let gaveUp = false;
  open.onupgradeneeded = (e) => upgrade(open.result, open.transaction!, e.oldVersion);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    open.onsuccess = () => {
      if (gaveUp) open.result.close(); // uppgraderingen blev klar efter att vi gett upp – lämna inte en öppen anslutning
      else resolve(open.result);
    };
    open.onerror = () => reject(open.error);
    open.onblocked = () => {
      gaveUp = true;
      reject(new Error('Databasen uppgraderas men används i en annan flik. Stäng andra flikar med Axalmo och ladda om.'));
    };
  });
  return new OntologyStore(db);
}

/** Begär beständig lagring så att Safari inte rensar datan vid lågt utrymme/inaktivitet (om webbläsaren tillåter). */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    return (await navigator.storage?.persist?.()) ?? null;
  } catch {
    return null;
  }
}

/** Översätter en äldre export till aktuell version (v1 → v2: tomma items/relations). Validering sker efteråt. */
export function migrateDump(dump: Dump): Dump {
  if (dump?.format !== 'axalmo-intelligence') throw new ValidationError(['okänt filformat']);
  if (!(SUPPORTED_IMPORT_VERSIONS as readonly number[]).includes(dump.schemaVersion)) {
    throw new ValidationError([`schemaversion ${dump.schemaVersion} stöds inte (stöder ${SUPPORTED_IMPORT_VERSIONS.join(', ')})`]);
  }
  for (const k of ['properties', 'spaces', 'observations', 'events'] as const) {
    if (!Array.isArray(dump[k])) throw new ValidationError([`${k} saknas i filen`]);
  }
  return { ...dump, schemaVersion: SCHEMA_VERSION, items: dump.items ?? [], relations: dump.relations ?? [] };
}

/** Arbetsytan ett objekt tillhör (fastighetens eget id för property). */
const workspaceOf = (o: OntologyObject) => (o.type === 'property' ? o.id : o.propertyId);

export class OntologyStore {
  private db: IDBDatabase;
  private closedByUpgrade = false;

  constructor(db: IDBDatabase) {
    this.db = db;
    // En nyare version öppnas i en annan flik: släpp anslutningen så att uppgraderingen inte blockeras.
    db.onversionchange = () => {
      this.closedByUpgrade = true;
      db.close();
    };
  }

  close() {
    this.db.close();
  }

  private tx(stores: StoreName | StoreName[], mode: IDBTransactionMode) {
    if (this.closedByUpgrade) throw new Error('Databasen har uppgraderats i en annan flik. Ladda om sidan.');
    return this.db.transaction(stores, mode);
  }

  /** Validerar och skriver flera objekt atomiskt. Avbryter allt om något är ogiltigt. */
  async commit(objects: OntologyObject[], opts: { replaceAll?: boolean } = {}): Promise<void> {
    const issues: string[] = [];
    for (const o of objects) {
      for (const i of [...validate(o), ...privacyIssues(o)]) issues.push(`${o.type} ${o.id}: ${i}`);
    }
    if (issues.length) throw new ValidationError(issues);

    const tx = this.tx(ALL_STORES, 'readwrite');
    const finished = done(tx);
    // Vid import: töm i samma transaktion – misslyckas något rullas allt tillbaka.
    if (opts.replaceAll) for (const s of ALL_STORES) tx.objectStore(s).clear();
    const pending = new Map(objects.map((o) => [o.id, o]));
    const find = async (type: ObjectType, id: string | undefined): Promise<OntologyObject | undefined> => {
      if (!id) return undefined;
      const local = pending.get(id);
      if (local) return local.type === type ? local : undefined;
      return (await req(tx.objectStore(STORES[type]).get(id))) as OntologyObject | undefined;
    };
    /** Referens måste finnas och ligga i samma arbetsyta. */
    const sameWs = async (owner: OntologyObject, type: ObjectType, id: string | undefined, what: string) => {
      if (!id) return;
      const ref = await find(type, id);
      if (!ref) issues.push(`${owner.type} ${owner.id}: ${what} ${id} finns inte`);
      else if (workspaceOf(ref) !== workspaceOf(owner)) issues.push(`${owner.type} ${owner.id}: ${what} tillhör annan arbetsyta`);
    };

    try {
      for (const o of objects) {
        if (o.type !== 'property' && o.type !== 'event' && !(await find('property', o.propertyId))) {
          issues.push(`${o.type} ${o.id}: arbetsytan ${o.propertyId} finns inte`);
          continue;
        }
        if (o.type === 'space') {
          await sameWs(o, 'space', o.parentSpaceId, 'överordnad yta');
        } else if (o.type === 'item') {
          await sameWs(o, 'space', o.spaceId, 'platsen');
        } else if (o.type === 'observation') {
          await sameWs(o, 'space', o.spaceId, 'ytan');
          await sameWs(o, 'item', o.itemId, 'föremålet');
        } else if (o.type === 'relation') {
          await sameWs(o, o.fromType as LinkableType, o.fromId, 'från-objektet');
          await sameWs(o, o.toType as LinkableType, o.toId, 'till-objektet');
        } else if (o.type === 'event') {
          if (!(await find(o.subjectType, o.subjectId))) issues.push(`event ${o.id}: objektet ${o.subjectId} finns inte`);
          if (!(await find('property', o.propertyId))) issues.push(`event ${o.id}: arbetsytan finns inte`);
          if (await req(tx.objectStore(STORES.event).get(o.id))) issues.push(`event ${o.id}: händelseloggen är append-only`);
        }
      }
      if (issues.length) {
        tx.abort();
        await finished.catch(() => {});
        throw new ValidationError(issues);
      }
      for (const o of objects) tx.objectStore(STORES[o.type]).put(compact(o));
    } catch (e) {
      if (!(e instanceof ValidationError)) {
        try { tx.abort(); } catch { /* redan avslutad */ }
      }
      throw e;
    }
    await finished;
  }

  async get<K extends ObjectType>(type: K, id: string): Promise<ObjectByType[K] | undefined> {
    const tx = this.tx(STORES[type], 'readonly');
    return (await req(tx.objectStore(STORES[type]).get(id))) as ObjectByType[K] | undefined;
  }

  async all<K extends ObjectType>(type: K): Promise<ObjectByType[K][]> {
    const tx = this.tx(STORES[type], 'readonly');
    return (await req(tx.objectStore(STORES[type]).getAll())) as ObjectByType[K][];
  }

  async byIndex<K extends ObjectType>(type: K, index: string, value: IDBValidKey): Promise<ObjectByType[K][]> {
    const tx = this.tx(STORES[type], 'readonly');
    return (await req(tx.objectStore(STORES[type]).index(index).getAll(value))) as ObjectByType[K][];
  }

  /** Händelser sorterade nyast först (via index "at"). */
  async events(): Promise<OntologyEvent[]> {
    const tx = this.tx(STORES.event, 'readonly');
    const list = (await req(tx.objectStore(STORES.event).index('at').getAll())) as OntologyEvent[];
    return list.reverse();
  }

  async counts(): Promise<Record<ObjectType, number>> {
    const tx = this.tx(ALL_STORES, 'readonly');
    const c = (s: StoreName) => req(tx.objectStore(s).count());
    const keys = Object.keys(STORES) as ObjectType[];
    const vals = await Promise.all(keys.map((k) => c(STORES[k])));
    return Object.fromEntries(keys.map((k, i) => [k, vals[i]])) as Record<ObjectType, number>;
  }

  async clear(): Promise<void> {
    const tx = this.tx(ALL_STORES, 'readwrite');
    for (const s of ALL_STORES) tx.objectStore(s).clear();
    await done(tx);
  }

  async exportDump(now = new Date()): Promise<Dump> {
    const [properties, spaces, items, observations, relations] = await Promise.all([
      this.all('property'), this.all('space'), this.all('item'), this.all('observation'), this.all('relation'),
    ]);
    const events = (await this.events()).reverse();
    return {
      format: 'axalmo-intelligence', schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(),
      properties, spaces, items, observations, relations, events,
    };
  }

  /** Ersätter all data med innehållet i en export (v1 eller v2). Validerar allt innan något skrivs. */
  async importDump(input: Dump): Promise<void> {
    const dump = migrateDump(input);
    const objects: OntologyObject[] = [
      ...dump.properties, ...dump.spaces, ...(dump.items ?? []), ...dump.observations, ...(dump.relations ?? []), ...dump.events,
    ];
    const issues = objects.flatMap((o) => [...validate(o), ...privacyIssues(o)].map((i) => `${o.type} ${o.id}: ${i}`));
    if (issues.length) throw new ValidationError(issues);
    await this.commit(objects, { replaceAll: true });
  }
}
