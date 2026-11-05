import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const wf = readFileSync(resolve(import.meta.dirname, '../../.github/workflows/axalmo-vision-pages.yml'), 'utf8');

/** Plockar ut ett jobbs block (raderna mellan "  namn:" och nästa jobb på samma nivå). */
function job(name: string): string {
  const m = wf.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][\\w-]*:\\n|$)`));
  assert.ok(m, `jobbet ${name} saknas`);
  return m[1];
}

test('automatisk publicering triggas bara av push till main', () => {
  const on = wf.match(/\non:\n([\s\S]*?)\n\S/)?.[1] ?? '';
  assert.match(on, /push:\n\s+branches: \[main\]/);
  assert.doesNotMatch(on, /pull_request/);
  assert.doesNotMatch(on, /branches: \[[^\]]*,/, 'inga fler grenar');
});

test('både bygg- och publiceringsjobb är spärrade till main (även vid manuell start)', () => {
  for (const name of ['build', 'deploy']) {
    assert.match(job(name), /\n\s+if: github\.ref == 'refs\/heads\/main'\n/, `${name} saknar main-spärr`);
  }
});

test('samtidighetsgrupp per gren – andra grenar kan inte avbryta publicering från main', () => {
  assert.match(wf, /group: pages-\$\{\{ github\.ref \}\}/);
});
