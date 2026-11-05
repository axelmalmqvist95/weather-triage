// Kopierar MediaPipe WASM-filer och laddar ner pose-modellen (en gång) till public/.
// Körs automatiskt före dev/build. Allt serveras sedan från egen domän – ingen CDN vid körning.
import { copyFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const wasmSrc = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = resolve(root, 'public/mediapipe');
const modelDir = resolve(root, 'public/models');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const modelPath = resolve(modelDir, 'pose_landmarker_lite.task');

mkdirSync(wasmDst, { recursive: true });
mkdirSync(modelDir, { recursive: true });

for (const f of [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]) {
  const dst = resolve(wasmDst, f);
  const src = resolve(wasmSrc, f);
  if (!existsSync(dst) || statSync(dst).size !== statSync(src).size) copyFileSync(src, dst);
}

if (!existsSync(modelPath) || statSync(modelPath).size < 1_000_000) {
  console.log('[assets] Laddar ner pose_landmarker_lite.task …');
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Kunde inte ladda ner modellen: HTTP ${res.status}`);
  writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
}
console.log('[assets] MediaPipe-filer klara.');
