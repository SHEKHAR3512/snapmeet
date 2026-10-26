// Usage: npm run catalog:validate -- path/to/pack.json [more.json]
// Validates data-only effect packs with the same schema the extension uses.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: npm run catalog:validate -- <pack.json> [...]');
  process.exit(2);
}
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// Inside the project so the bundle can resolve its dependencies from node_modules.
const out = join(root, 'node_modules', '.cache', 'snapmeet-cli');
await build({
  configFile: false,
  root,
  logLevel: 'error',
  publicDir: false,
  build: { outDir: out, emptyOutDir: true, minify: false, ssr: join(root, 'src/catalog/cli.ts'), rollupOptions: { output: { entryFileNames: 'cli.mjs', format: 'es' } } },
});
const { runValidation } = await import(pathToFileURL(join(out, 'cli.mjs')).href);
let code = 0;
for (const f of files) code |= runValidation(f, readFileSync(f, 'utf8'), version);
process.exit(code);
