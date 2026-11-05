import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResourcePool, type PoolTimers } from '../src/resourcePool.ts';

/** Manuell klocka för timers. */
function fakeTimers() {
  const pending = new Map<number, () => void>();
  let id = 0;
  const timers: PoolTimers = {
    set: (fn) => {
      pending.set(++id, fn);
      return id;
    },
    clear: (h) => void pending.delete(h as number),
  };
  const fire = () => {
    const fns = [...pending.values()];
    pending.clear();
    fns.forEach((f) => f());
  };
  return { timers, fire, pending };
}

const model = () => {
  const m = { closed: 0, close() { m.closed++; } };
  return m;
};

test('parkerade modeller återanvänds om man kommer tillbaka inom tiden (ingen ominitiering)', () => {
  const { timers, pending } = fakeTimers();
  const pool = new ResourcePool(60_000, timers);
  const det = model();
  pool.set('detector', det, 'CPU');
  pool.park();
  assert.equal(pending.size, 1);
  pool.resume();
  assert.equal(pending.size, 0);
  assert.equal(pool.get('detector'), det);
  assert.equal(pool.meta('detector'), 'CPU');
  assert.equal(det.closed, 0);
});

test('parkerade modeller stängs exakt en gång när tiden gått ut', () => {
  const { timers, fire } = fakeTimers();
  const pool = new ResourcePool(60_000, timers);
  const det = model(), pose = model();
  pool.set('detector', det);
  pool.set('pose', pose, { numPoses: 2 });
  pool.park();
  fire();
  assert.equal(det.closed, 1);
  assert.equal(pose.closed, 1);
  assert.equal(pool.get('detector'), null);
  assert.equal(pool.parked, false);
  pool.releaseAll();
  assert.equal(det.closed, 1, 'ingen dubbelstängning');
});

test('upprepade vybyten skapar bara en väntande frigörning', () => {
  const { timers, pending } = fakeTimers();
  const pool = new ResourcePool(1000, timers);
  pool.set('detector', model());
  for (let i = 0; i < 10; i++) {
    pool.park();
    pool.resume();
    pool.park();
  }
  assert.equal(pending.size, 1);
});

test('ny modell under samma nyckel stänger den gamla; samma instans stängs inte', () => {
  const pool = new ResourcePool(1000, fakeTimers().timers);
  const a = model(), b = model();
  pool.set('pose', a);
  pool.set('pose', a, { numPoses: 3 });
  assert.equal(a.closed, 0);
  assert.deepEqual(pool.meta('pose'), { numPoses: 3 });
  pool.set('pose', b);
  assert.equal(a.closed, 1);
  assert.equal(pool.get('pose'), b);
});

test('delete stänger direkt och setMeta påverkar inte saknade nycklar', () => {
  const pool = new ResourcePool(1000, fakeTimers().timers);
  const a = model();
  pool.set('detector', a);
  pool.delete('detector');
  pool.delete('detector');
  assert.equal(a.closed, 1);
  pool.setMeta('detector', 'GPU');
  assert.equal(pool.meta('detector'), undefined);
  assert.equal(pool.closed, 1);
});

test('fel i close() stoppar inte frigörning av övriga modeller', () => {
  const pool = new ResourcePool(1000, fakeTimers().timers);
  const bad = { close() { throw new Error('boom'); } };
  const good = model();
  const warn = console.warn;
  console.warn = () => {};
  try {
    pool.set('a', bad);
    pool.set('b', good);
    pool.releaseAll();
  } finally {
    console.warn = warn;
  }
  assert.equal(good.closed, 1);
  assert.equal(pool.get('a'), null);
});
