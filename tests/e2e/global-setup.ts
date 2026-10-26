import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
import { build } from 'vite';

/** Builds the renderer fixture harness (an IIFE exposing engine internals to a test page). */
export default async function globalSetup(): Promise<void> {
  const root = join(HERE, '..', '..');
  if (!existsSync(join(root, 'dist', 'manifest.json'))) {
    throw new Error('dist/ is missing — run `npm run build` (npm run test:e2e does this).');
  }
  await build({
    configFile: false,
    root,
    publicDir: false,
    logLevel: 'warn',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: join(HERE, '.harness'),
      emptyOutDir: true,
      sourcemap: false,
      minify: false,
      lib: { entry: join(HERE, 'harness', 'entry.ts'), formats: ['iife'], name: 'SnapMeetHarness', fileName: () => 'harness.js' },
    },
  });
}
