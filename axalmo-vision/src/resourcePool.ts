/**
 * Håller tunga resurser (t.ex. MediaPipe-modeller) mellan vybyten.
 * - park(): schemalägger frigörning efter idleMs (snabbt tillbaka = ingen ominitialisering)
 * - resume(): avbryter en schemalagd frigörning
 * - releaseAll(): stänger allt direkt
 * Skriven utan React/DOM-beroenden så att den kan testas i Node.
 */
export interface Closable {
  close(): void;
}

interface Slot {
  value: Closable;
  meta: unknown;
}

export interface PoolTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const defaultTimers: PoolTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class ResourcePool {
  readonly idleMs: number;
  private slots = new Map<string, Slot>();
  private timer: unknown = null;
  private timers: PoolTimers;
  /** Antal stängda resurser – för diagnostik och tester. */
  closed = 0;

  constructor(idleMs: number, timers: PoolTimers = defaultTimers) {
    this.idleMs = idleMs;
    this.timers = timers;
  }

  get<T extends Closable>(key: string): T | null {
    return (this.slots.get(key)?.value as T | undefined) ?? null;
  }

  meta<M>(key: string): M | undefined {
    return this.slots.get(key)?.meta as M | undefined;
  }

  get parked() {
    return this.timer !== null;
  }

  /** Lägger in en resurs. En tidigare, annan resurs under samma nyckel stängs. */
  set(key: string, value: Closable, meta?: unknown) {
    const prev = this.slots.get(key);
    if (prev && prev.value !== value) this.close(prev.value);
    this.slots.set(key, { value, meta });
  }

  setMeta(key: string, meta: unknown) {
    const s = this.slots.get(key);
    if (s) s.meta = meta;
  }

  /** Stänger och tar bort en resurs. */
  delete(key: string) {
    const s = this.slots.get(key);
    if (!s) return;
    this.slots.delete(key);
    this.close(s.value);
  }

  resume() {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
  }

  park() {
    this.resume();
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.releaseAll();
    }, this.idleMs);
  }

  releaseAll() {
    this.resume();
    const values = [...this.slots.values()];
    this.slots.clear();
    for (const s of values) this.close(s.value);
  }

  private close(v: Closable) {
    try {
      v.close();
    } catch (e) {
      console.warn('[pool] close misslyckades', e);
    }
    this.closed++;
  }
}
