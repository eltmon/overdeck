/**
 * `pan skills pack browser` helpers (PAN-4730): the browser-runtime rows of a
 * pack consent preview, and the live browse-daemon report that `remove` and
 * `browser off` print.
 *
 * Leaf module: `skills.ts` owns the verbs and loads this module lazily; this
 * module imports nothing from `skills.ts`, so no import cycle forms.
 */
import type { PackPreview } from '../../lib/skill-packs/sources.js';

const INDENT = ' '.repeat(16);

/** The browser rows: the exact command, every download and every write, one per line, never truncated. */
export function printBrowserPreview(browser: NonNullable<PackPreview['browser']>): void {
  const rows: Array<[string, string]> = [
    ['Runs', browser.command.join(' ')],
    ['Downloads', `${browser.downloads.length} lines, every package and file the build fetches:`],
  ];
  for (const [label, value] of rows) console.log(`  ${label.padEnd(12)} ${value}`);
  for (const line of browser.downloads) console.log(`${INDENT}${line}`);
  console.log(`  ${'Writes'.padEnd(12)} ${browser.writes.length} paths:`);
  for (const path of browser.writes) console.log(`${INDENT}${path}`);
  console.log(`  ${'Size'.padEnd(12)} about 1 GB on disk`);
}

/** PAN-4730 D14: one line per live browse daemon in a registered project; never signals one. */
export async function daemonLines(): Promise<string[]> {
  return [];
}
