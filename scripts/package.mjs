// Packages dist/ into release/snapmeet-<version>.zip (distribution files only).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (!existsSync(join(dist, 'manifest.json'))) throw new Error('Run npm run build first');

const files = [];
const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(relative(dist, join(d, f)))));
walk(dist);
const forbidden = files.filter((f) => /\.map$|\.env|node_modules|\.y4m$|\.webm$|\.pem$/.test(f));
if (forbidden.length) throw new Error(`Refusing to package: ${forbidden.join(', ')}`);

mkdirSync(join(root, 'release'), { recursive: true });
const zip = join(root, 'release', `snapmeet-${version}.zip`);
rmSync(zip, { force: true });
try {
  execFileSync('zip', ['-q', '-r', '-X', zip, '.'], { cwd: dist });
} catch {
  // Fallback for Windows where zip is not installed
  execFileSync('tar.exe', ['-a', '-c', '-f', zip, '*'], { cwd: dist });
}
console.log(`[package] ${relative(root, zip)} (${files.length} files, ${(statSync(zip).size / 1e6).toFixed(1)} MB)`);

