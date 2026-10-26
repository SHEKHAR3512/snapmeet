// Fails the build if a bundled model differs from the pinned SHA-256 in assets.lock.json.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(join(root, 'scripts', 'assets.lock.json'), 'utf8'));
let ok = true;
for (const a of lock.assets) {
  let hash;
  try {
    hash = createHash('sha256').update(readFileSync(join(root, a.path))).digest('hex');
  } catch {
    console.error(`[assets] missing ${a.path} (source: ${a.source})`);
    ok = false;
    continue;
  }
  if (hash !== a.sha256) {
    console.error(`[assets] hash mismatch for ${a.path}: ${hash} != ${a.sha256}`);
    ok = false;
  }
}
if (!ok) process.exit(1);
console.log(`[assets] ${lock.assets.length} pinned assets verified`);
