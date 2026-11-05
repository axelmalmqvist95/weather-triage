import {
  SCHEMA_VERSION, ValidationError, validate,
  type ObjectType, type Observation, type OntologyEvent, type OntologyObject, type Property, type Space,
} from './schema.ts';

/** Typkarta: objekttyp → TypeScript-typ. */
export interface ObjectByType { property: Property; space: Space; observation: Observation; event: OntologyEvent }
import { privacyIssues } from './policy.ts';

/**
 * Lokal lagring i IndexedDB (ingen server). Separat databas från Vision-delen.
 * Alla skrivningar valideras (schema + integritetspolicy + referenser) och sker i en transaktion.
 */

export const DB_NAME = 'axalmo-intelligence';
export const DB_VERSION = 1;

export const STORES = { property: 'properties', space: 'spaces', observation: 'observations', event: 'events' } as const;
type StoreName = (typeof STORES)[keyof typeof STORES];
const ALL_STORES: StoreName[] = Object.values(STORES);

export interface Dump {
  format: 'axalmo-intelligence';
  schemaVersion: number;
  exportedAt: string;
  properties: Property[];
  spaces: Space[];
  observations: Observation[];
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

function upgrade(db: IDBDatabase, oldVersion: number) {
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
  // Framtida versioner: lägg till migreringar här (if (oldVersion < 2) { … }).
}

export async function openStore(factory: IDBFactory = globalThis.indexedDB, name = DB_NAME): Promise<OntologyStore> {
  if (!factory) throw new Error('IndexedDB saknas i den här webbläsaren.');
  const open = factory.open(name, DB_VERSION);
  open.onupgradeneeded = (e) => upgrade(open.result, e.oldVersion);
  const db = await req(open);
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

export class OntologyStore {
  private db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.db = db;
  }

  close() {
    this.db.close();
  }

  /** Validerar och skriver flera objekt atomiskt. Avbryter allt om något är ogiltigt. */
  async commit(objects: OntologyObject[], opts: { replaceAll?: boolean } = {}): Promise<void> {
    const issues: string[] = [];
    for (const o of objects) {
      for (const i of [...validate(o), ...privacyIssues(o)]) issues.push(`${o.type} ${o.id}: ${i}`);
    }
    if (issues.length) throw new ValidationError(issues);

    const tx = this.db.transaction(ALL_STORES, 'readwrite');
    const finished = done(tx);
    // Vid import: töm i samma transaktion – misslyckas något rullas allt tillbaka.
    if (opts.replaceAll) for (const s of ALL_STORES) tx.objectStore(s).clear();
    const pending = new Map(objects.map((o) => [o.id, o]));
    const exists = async (store: StoreName, id: string | undefined) => {
      if (!id) return undefined;
      const local = pending.get(id);
      if (local) return local;
      return (await req(tx.objectStore(store).get(id))) as OntologyObject | undefined;
    };

    try {
      for (const o of objects) {
        if (o.type === 'space') {
          if (!(await exists(STORES.property, o.propertyId))) issues.push(`space ${o.id}: fastigheten ${o.propertyId} finns inte`);
          if (o.parentSpaceId) {
            const parent = (await exists(STORES.space, o.parentSpaceId)) as Space | undefined;
            if (!parent) issues.push(`space ${o.id}: överordnad yta finns inte`);
            else if (parent.propertyId !== o.propertyId) issues.push(`space ${o.id}: överordnad yta tillhör annan fastighet`);
          }
        } else if (o.type === 'observation') {
          const sp = (await exists(STORES.space, o.spaceId)) as Space | undefined;
          if (!sp) issues.push(`observation ${o.id}: ytan ${o.spaceId} finns inte`);
          else if (sp.propertyId !== o.propertyId) issues.push(`observation ${o.id}: ytan tillhör annan fastighet`);
        } else if (o.type === 'event') {
          const subj = await exists(STORES[o.subjectType], o.subjectId);
          if (!subj) issues.push(`event ${o.id}: objektet ${o.subjectId} finns inte`);
          if (!(await exists(STORES.property, o.propertyId))) issues.push(`event ${o.id}: fastigheten finns inte`);
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
    const tx = this.db.transaction(STORES[type], 'readonly');
    return (await req(tx.objectStore(STORES[type]).get(id))) as ObjectByType[K] | undefined;
  }

  async all<K extends ObjectType>(type: K): Promise<ObjectByType[K][]> {
    const tx = this.db.transaction(STORES[type], 'readonly');
    return (await req(tx.objectStore(STORES[type]).getAll())) as ObjectByType[K][];
  }

  async byIndex<K extends ObjectType>(type: K, index: string, value: IDBValidKey): Promise<ObjectByType[K][]> {
    const tx = this.db.transaction(STORES[type], 'readonly');
    return (await req(tx.objectStore(STORES[type]).index(index).getAll(value))) as ObjectByType[K][];
  }

  /** Händelser sorterade nyast först (via index "at"). */
  async events(): Promise<OntologyEvent[]> {
    const tx = this.db.transaction(STORES.event, 'readonly');
    const list = (await req(tx.objectStore(STORES.event).index('at').getAll())) as OntologyEvent[];
    return list.reverse();
  }

  async counts(): Promise<Record<'property' | 'space' | 'observation' | 'event', number>> {
    const tx = this.db.transaction(ALL_STORES, 'readonly');
    const c = (s: StoreName) => req(tx.objectStore(s).count());
    const [property, space, observation, event] = await Promise.all([c(STORES.property), c(STORES.space), c(STORES.observation), c(STORES.event)]);
    return { property, space, observation, event };
  }

  async clear(): Promise<void> {
    const tx = this.db.transaction(ALL_STORES, 'readwrite');
    for (const s of ALL_STORES) tx.objectStore(s).clear();
    await done(tx);
  }

  async exportDump(now = new Date()): Promise<Dump> {
    const [properties, spaces, observations] = await Promise.all([
      this.all('property'), this.all('space'), this.all('observation'),
    ]);
    const events = (await this.events()).reverse();
    return { format: 'axalmo-intelligence', schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), properties, spaces, observations, events };
  }

  /** Ersätter all data med innehållet i en export. Validerar allt innan något skrivs. */
  async importDump(dump: Dump): Promise<void> {
    if (dump?.format !== 'axalmo-intelligence') throw new ValidationError(['okänt filformat']);
    if (dump.schemaVersion !== SCHEMA_VERSION) throw new ValidationError([`schemaversion ${dump.schemaVersion} stöds inte (förväntade ${SCHEMA_VERSION})`]);
    const objects: OntologyObject[] = [...dump.properties, ...dump.spaces, ...dump.observations, ...dump.events];
    const issues = objects.flatMap((o) => [...validate(o), ...privacyIssues(o)].map((i) => `${o.type} ${o.id}: ${i}`));
    if (issues.length) throw new ValidationError(issues);
    await this.commit(objects, { replaceAll: true });
  }
}
