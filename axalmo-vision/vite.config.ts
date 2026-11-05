import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Genererar dist/sw.js med en precache-lista över alla byggda filer + modell/WASM.
function serviceWorker(): Plugin {
  let files: string[] = [];
  return {
    name: 'axalmo-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
    },
    closeBundle() {
      const staticFiles = [
        'manifest.webmanifest',
        'icons/icon.svg',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/apple-touch-icon.png',
        'models/pose_landmarker_lite.task',
        'models/efficientdet_lite0.tflite',
        'mediapipe/vision_wasm_internal.js',
        'mediapipe/vision_wasm_internal.wasm',
      ];
      const precache = ['./', ...files, ...staticFiles];
      const version = createHash('sha1').update(precache.join('|')).digest('hex').slice(0, 10);
      const tpl = readFileSync(resolve(__dirname, 'sw/sw.js'), 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache));
      writeFileSync(resolve(__dirname, 'dist/sw.js'), tpl);
    },
  };
}

// Valfri HTTPS i lokalt nätverk: lägg certs/cert.pem + certs/key.pem (t.ex. från mkcert).
const certDir = resolve(__dirname, 'certs');
const https = existsSync(resolve(certDir, 'cert.pem'))
  ? { cert: readFileSync(resolve(certDir, 'cert.pem')), key: readFileSync(resolve(certDir, 'key.pem')) }
  : undefined;

export default defineConfig({
  server: { https },
  preview: { https },
  base: './',
  plugins: [react(), serviceWorker()],
  build: { target: 'safari15', sourcemap: false },
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
});
