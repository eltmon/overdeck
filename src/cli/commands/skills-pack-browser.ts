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

/** The browser rows: the exact command, the download lines (direct dependencies, then summaries) and every write, one per line, never truncated. */
export function printBrowserPreview(browser: NonNullable<PackPreview['browser']>): void {
  const rows: Array<[string, string]> = [
    ['Runs', browser.command.join(' ')],
    ['Downloads', 'direct npm dependencies, then summaries of their locked dependencies and the Playwright browsers:'],
  ];
  for (const [label, value] of rows) console.log(`  ${label.padEnd(12)} ${value}`);
  for (const line of browser.downloads) console.log(`${INDENT}${line}`);
  console.log(`  ${'Writes'.padEnd(12)} ${browser.writes.length} paths:`);
  for (const path of browser.writes) console.log(`${INDENT}${path}`);
  console.log(`  ${'Size'.padEnd(12)} about 1 GB on disk`);
}

/** Signal 0 only checks that the pid exists and is ours; it never stops anything. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * PAN-4730 D14: one line per live browse daemon in a registered project, read
 * from the `pid` gstack's browse writes to `<project>/.gstack/browse.json`. It
 * reports and never signals: the daemon also exits after 30 idle minutes. The
 * stop hint is SIGINT because a headless daemon ignores a plain `kill`.
 */
export async function daemonLines(): Promise<string[]> {
  const [{ listProjectsAsync }, { readFile }, { join }] = await Promise.all([
    import('../../lib/projects.js'),
    import('node:fs/promises'),
    import('node:path'),
  ]);
  const lines: string[] = [];
  for (const { config } of await listProjectsAsync()) {
    if (!config.path) continue;
    let pid: unknown;
    try {
      pid = (JSON.parse(await readFile(join(config.path, '.gstack', 'browse.json'), 'utf8')) as { pid?: unknown } | null)?.pid;
    } catch {
      continue;
    }
    // pid 0 and negative pids name process groups; never probe those.
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 1 || !isAlive(pid)) continue;
    // Headless browse ignores SIGTERM (gstack browse/src/server.ts); SIGINT is its Ctrl+C shutdown.
    lines.push(`Browse daemon still running in ${config.path}: pid ${pid} — stop with: kill -INT ${pid}`);
  }
  return lines;
}
