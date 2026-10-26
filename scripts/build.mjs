// Builds the unpacked extension into dist/.
//  - extension pages (popup, options, playground) as a normal Vite multi-page build;
//  - content scripts as self-contained IIFE bundles (content scripts cannot be ES modules);
//  - the service worker as an ES module;
//  - manifest.json with the package version.
// The output has no dev-server dependency and loads no remote code.
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const r = (p) => join(root, p);
const dist = r('dist');
const pkg = JSON.parse(readFileSync(r('package.json'), 'utf8'));
const target = 'chrome116';
const define = { 'process.env.NODE_ENV': JSON.stringify('production') };

if (!existsSync(r('public/wasm/vision_wasm_internal.wasm'))) {
  console.error('public/wasm is missing. Run `npm install` (postinstall copies the MediaPipe runtime).');
  process.exit(1);
}
rmSync(dist, { recursive: true, force: true });

await build({
  configFile: false,
  root: r('src/pages'),
  base: './',
  publicDir: r('public'),
  plugins: [react()],
  define,
  logLevel: 'warn',
  build: {
    outDir: dist,
    emptyOutDir: false,
    target,
    sourcemap: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        popup: r('src/pages/popup.html'),
        options: r('src/pages/options.html'),
        playground: r('src/pages/playground.html'),
      },
    },
  },
});

const scripts = [
  { entry: 'src/bridge/main-bootstrap.ts', file: 'main-bootstrap.js', format: 'iife' },
  { entry: 'src/content/controller.ts', file: 'content.js', format: 'iife' },
  { entry: 'src/vision/vision-entry.ts', file: 'vision.js', format: 'iife' },
  { entry: 'src/vision/worker-entry.ts', file: 'vision-worker.js', format: 'iife' },
  { entry: 'src/extension/service-worker.ts', file: 'service-worker.js', format: 'es' },
];
for (const s of scripts) {
  await build({
    configFile: false,
    root,
    publicDir: false,
    plugins: [react()],
    define,
    logLevel: 'warn',
    build: {
      outDir: dist,
      emptyOutDir: false,
      target,
      sourcemap: false,
      copyPublicDir: false,
      lib: {
        entry: r(s.entry),
        formats: [s.format],
        name: 'SnapMeet',
        fileName: () => s.file,
      },
    },
  });
}

const manifest = readFileSync(r('src/extension/manifest.json'), 'utf8').replace('__VERSION__', pkg.version);
writeFileSync(join(dist, 'manifest.json'), manifest);
console.log(`[build] SnapMeet ${pkg.version} → dist/`);
