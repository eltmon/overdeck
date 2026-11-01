/**
 * gstack browser runtime (PAN-4730 WI-O3): run the fork's pack-browser step
 * (`bash setup --pack-browser <render> --pack-browser-cache <cache>`,
 * eltmon/gstack docs/pack-mode.md) from a trusted extraction into a ready
 * render, list what it downloads for the consent preview, and tell whether a
 * render's browser runtime is ready.
 *
 * Imports only `node:*` and `./gstack.js`, like `render.ts`, and does not
 * import `render.ts`: `sources.ts` imports both and owns the per-id paths.
 * Only CLI write paths build; catalog and launch only call isBrowserReady.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { GSTACK_BROWSER_MARKER, GSTACK_PACK_BROWSER_VERSION, GSTACK_PACK_MODE_FILE } from './gstack.js';

const execFileAsync = promisify(execFile);
const BUILD_TIMEOUT_MS = 30 * 60_000;
const BUN_PROBE_TIMEOUT_MS = 10_000;
const STDERR_TAIL_LINES = 20;

export class BrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserError';
  }
}

async function readJsonField(path: string, field: string): Promise<unknown> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)[field] : undefined;
  } catch {
    return undefined;
  }
}

/** The browser runtime is ready when its marker (written last by the step) parses with `packBrowser: 1`. */
export async function isBrowserReady(renderDir: string): Promise<boolean> {
  return (await readJsonField(join(renderDir, GSTACK_BROWSER_MARKER), 'packBrowser')) === GSTACK_PACK_BROWSER_VERSION;
}

/** Fails before consent when the commit has no browser step or the host has no bun. */
export async function assertBrowserBuildable(extractDir: string, commit: string): Promise<void> {
  if ((await readJsonField(join(extractDir, GSTACK_PACK_MODE_FILE), 'packBrowser')) !== GSTACK_PACK_BROWSER_VERSION) {
    throw new BrowserError(
      `pack gstack: ${commit.slice(0, 7)} has no browser step (${GSTACK_PACK_MODE_FILE} packBrowser); update to an eltmon/gstack commit with it`,
    );
  }
  try {
    await execFileAsync('bun', ['--version'], { timeout: BUN_PROBE_TIMEOUT_MS });
  } catch {
    throw new BrowserError('pack gstack needs bun on PATH (https://bun.sh)');
  }
}

/** The exact command the build runs, with `cwd` = the extraction. */
export function browserCommand(renderDir: string, cacheDir: string): string[] {
  return ['bash', 'setup', '--pack-browser', renderDir, '--pack-browser-cache', cacheDir];
}

/** The consent preview's download lines: every production dependency as `name@spec`, then the lockfile and Chromium lines. */
export async function browserDownloads(extractDir: string): Promise<string[]> {
  const deps = await readJsonField(join(extractDir, 'package.json'), 'dependencies');
  if (!deps || typeof deps !== 'object') return ['unknown: package.json not readable'];
  const entries = Object.entries(deps as Record<string, unknown>)
    .map(([name, spec]) => [name, String(spec)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  const playwright = entries.find(([name]) => name === 'playwright')?.[1] ?? 'unknown';
  return [
    ...entries.map(([name, spec]) => `${name}@${spec}`),
    '+ their locked dependencies from bun.lock (registry.npmjs.org)',
    `Chromium, Chromium headless shell and ffmpeg for playwright ${playwright} (Playwright CDN, ~115 MiB download)`,
  ];
}

function stderrTail(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  const text = typeof stderr === 'string' && stderr.trim() ? stderr : error instanceof Error ? error.message : String(error);
  return text.trimEnd().split('\n').slice(-STDERR_TAIL_LINES).join('\n');
}

/** Build the browser runtime into the ready render `renderDir`; the fork step removes its own partial output on failure. */
export async function buildBrowserRuntime(opts: {
  extractDir: string;
  commit: string;
  renderDir: string;
  cacheDir: string;
}): Promise<void> {
  await assertBrowserBuildable(opts.extractDir, opts.commit);
  await mkdir(opts.cacheDir, { recursive: true });
  const [command, ...args] = browserCommand(opts.renderDir, opts.cacheDir);
  try {
    await execFileAsync(command!, args, {
      cwd: opts.extractDir,
      timeout: BUILD_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    throw new BrowserError(`pack gstack: browser build failed: ${stderrTail(error)}`);
  }
  if (!(await isBrowserReady(opts.renderDir))) {
    throw new BrowserError(`pack gstack: browser build wrote no ${GSTACK_BROWSER_MARKER}`);
  }
}
