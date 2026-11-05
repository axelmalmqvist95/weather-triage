// Kopierar MediaPipe WASM-filer och laddar ner pose-modellen (en gång) till public/.
// Körs automatiskt före dev/build. Allt serveras sedan från egen domän – ingen CDN vid körning.
import { copyFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const wasmSrc = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = resolve(root, 'public/mediapipe');
const modelDir = resolve(root, 'public/models');
const MODELS = ['lite', 'full'].map((v) => ({
  url: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${v}/float16/1/pose_landmarker_${v}.task`,
  path: resolve(modelDir, `pose_landmarker_${v}.task`),
}));
MODELS.push({
  url: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite',
  path: resolve(modelDir, 'efficientdet_lite0.tflite'),
});

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

for (const m of MODELS) {
  if (existsSync(m.path) && statSync(m.path).size > 1_000_000) continue;
  console.log(`[assets] Laddar ner ${m.url.split('/').pop()} …`);
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`Kunde inte ladda ner modellen: HTTP ${res.status}`);
  writeFileSync(m.path, Buffer.from(await res.arrayBuffer()));
}
console.log('[assets] MediaPipe-filer klara.');
