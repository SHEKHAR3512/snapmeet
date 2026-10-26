import { validatePackText } from './schema';

/** Validates pack JSON text; returns a process exit code and prints a report. */
export function runValidation(name: string, text: string, extensionVersion: string): number {
  const r = validatePackText(text, extensionVersion);
  if (!r.ok) {
    console.error(`✗ ${name}`);
    for (const e of r.errors) console.error(`  - ${e}`);
    return 1;
  }
  console.log(`✓ ${name}: "${r.pack.title}" ${r.pack.packVersion}, ${r.pack.effects.length} effect(s)`);
  for (const w of r.warnings) console.log(`  ! ${w}`);
  return 0;
}
