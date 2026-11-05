import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeLoadError, importWithRetry, isChunkLoadError } from '../src/lazyRetry.ts';

const noSleep = () => Promise.resolve();

test('känner igen chunk-fel från Safari, Chrome, Firefox och Vite', () => {
  assert.ok(isChunkLoadError(new TypeError('Importing a module script failed.')));
  assert.ok(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/a.js')));
  assert.ok(isChunkLoadError(new TypeError('error loading dynamically imported module')));
  assert.ok(isChunkLoadError(new Error('Unable to preload CSS for /assets/x.css')));
  assert.ok(!isChunkLoadError(new Error('Cannot read properties of undefined')));
});

test('importWithRetry lyckas efter tillfälliga chunk-fel', async () => {
  let calls = 0;
  const v = await importWithRetry(async () => {
    calls++;
    if (calls < 3) throw new TypeError('Importing a module script failed.');
    return { default: 'ok' };
  }, { retries: 2, sleep: noSleep });
  assert.deepEqual(v, { default: 'ok' });
  assert.equal(calls, 3);
});

test('importWithRetry ger upp efter max antal försök', async () => {
  let calls = 0;
  await assert.rejects(
    importWithRetry(async () => {
      calls++;
      throw new TypeError('Failed to fetch dynamically imported module');
    }, { retries: 2, sleep: noSleep }),
    /Failed to fetch/,
  );
  assert.equal(calls, 3);
});

test('andra fel än chunk-fel försöks inte igen', async () => {
  let calls = 0;
  await assert.rejects(importWithRetry(async () => { calls++; throw new Error('kodfel'); }, { sleep: noSleep }), /kodfel/);
  assert.equal(calls, 1);
});

test('ett nytt försök efter misslyckande anropar importen på nytt (ingen cachad avvisning)', async () => {
  let fail = true;
  let calls = 0;
  const factory = async () => {
    calls++;
    if (fail) throw new TypeError('Importing a module script failed.');
    return 'vy';
  };
  await assert.rejects(importWithRetry(factory, { retries: 0, sleep: noSleep }));
  fail = false;
  assert.equal(await importWithRetry(factory, { retries: 0, sleep: noSleep }), 'vy');
  assert.equal(calls, 2);
});

test('begripliga felmeddelanden', () => {
  const chunk = describeLoadError(new TypeError('Importing a module script failed.'));
  assert.match(chunk.title, /kunde inte laddas/);
  assert.equal(chunk.retry, 'reload', 'webbläsaren cachar misslyckad import – kräver omladdning');
  const other = describeLoadError(new Error('Något gick fel i grafen'));
  assert.equal(other.retry, 'remount');
  assert.match(other.detail, /grafen/);
});
