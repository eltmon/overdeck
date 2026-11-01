/**
 * gstack pack render (PAN-4727 WI-O3): run the fork's pack mode
 * (`bash setup --pack-root <render> --pack-state-root <state>`, eltmon/gstack
 * docs/pack-mode.md) from a trusted extraction, and tell whether a render is
 * ready.
 *
 * Imports only `node:*` and `./gstack.js`: `sources.ts` imports this module
 * and owns the per-id paths, so this one takes explicit directories and throws
 * its own RenderError. Only CLI write paths render; catalog and launch only
 * call isRenderReady.
 */
import { execFile } from 'node:child_process';
import { lstat, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { GSTACK_PACK_MODE_FILE, GSTACK_PACK_MODE_VERSION, GSTACK_RENDER_MARKER } from './gstack.js';

const execFileAsync = promisify(execFile);
const RENDER_TIMEOUT_MS = 10 * 60_000;
const BUN_PROBE_TIMEOUT_MS = 10_000;
const STDERR_TAIL_LINES = 20;

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderError';
  }
}

async function readPackModeVersion(path: string): Promise<unknown> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)['packMode'] : undefined;
  } catch {
    return undefined;
  }
}

/** A render is ready when its marker (written last by pack mode) parses with `packMode: 1`. */
export async function isRenderReady(renderDir: string): Promise<boolean> {
  return (await readPackModeVersion(join(renderDir, GSTACK_RENDER_MARKER))) === GSTACK_PACK_MODE_VERSION;
}

/** Fails before consent when the commit has no pack mode or the host has no bun. */
export async function assertRenderable(extractDir: string, commit: string): Promise<void> {
  if ((await readPackModeVersion(join(extractDir, GSTACK_PACK_MODE_FILE))) !== GSTACK_PACK_MODE_VERSION) {
    throw new RenderError(
      `pack gstack: ${commit.slice(0, 7)} has no pack mode (${GSTACK_PACK_MODE_FILE}); use https://github.com/eltmon/gstack at a commit with pack mode`,
    );
  }
  try {
    await execFileAsync('bun', ['--version'], { timeout: BUN_PROBE_TIMEOUT_MS });
  } catch {
    throw new RenderError('pack gstack needs bun on PATH (https://bun.sh)');
  }
}

/** The exact command the render runs, with `cwd` = the extraction. */
export function renderCommand(renderDir: string, stateDir: string): string[] {
  return ['bash', 'setup', '--pack-root', renderDir, '--pack-state-root', stateDir];
}

function stderrTail(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  const text = typeof stderr === 'string' && stderr.trim() ? stderr : error instanceof Error ? error.message : String(error);
  return text.trimEnd().split('\n').slice(-STDERR_TAIL_LINES).join('\n');
}

/** Render the extraction into `renderDir` (replacing it); on any failure `renderDir` is removed. */
export async function renderRuntimePack(opts: {
  extractDir: string;
  commit: string;
  renderDir: string;
  stateDir: string;
}): Promise<void> {
  await assertRenderable(opts.extractDir, opts.commit);
  await rm(opts.renderDir, { recursive: true, force: true });
  await mkdir(opts.stateDir, { recursive: true });
  await mkdir(dirname(opts.renderDir), { recursive: true });
  const [command, ...args] = renderCommand(opts.renderDir, opts.stateDir);
  try {
    await execFileAsync(command!, args, {
      cwd: opts.extractDir,
      timeout: RENDER_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    await rm(opts.renderDir, { recursive: true, force: true });
    throw new RenderError(`pack gstack: render failed: ${stderrTail(error)}`);
  }
  if (!(await isRenderReady(opts.renderDir))) {
    await rm(opts.renderDir, { recursive: true, force: true });
    throw new RenderError(`pack gstack: render wrote no ${GSTACK_RENDER_MARKER}`);
  }
}

async function childNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** True when any of `paths` exists with an mtime after `cutoff`. */
async function newerThan(paths: string[], cutoff: number): Promise<boolean> {
  for (const path of paths) {
    try {
      if ((await lstat(path)).mtimeMs > cutoff) return true;
    } catch {
      // Absent.
    }
  }
  return false;
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * PAN-4727 D10: under `packsHome` (one dir per pack id, plus `mounts`), remove
 * `<id>/render/<commit>` dirs that are not the trusted commit, not in `keep`
 * (renders a linked mount still calls into), and older than `maxAgeMs`; building
 * or reusing a mount touches its render, so a render ages like its mount. Also
 * remove `render/`, `state/` and `browser/` (PAN-4730: bun cache and Chromium,
 * about 1 GB) of ids that are not registered (left by an interrupted remove)
 * once all are older than `maxAgeMs`, so an `add` that is still rendering keeps
 * them. A removed `browser/` is counted in `removedStates`.
 *
 * `registered` maps every registered id to its trusted commit, or null when the
 * entry is malformed (then nothing of that id is touched). When
 * `registryReadable` is false nothing counts as an orphan: gc never deletes
 * state it cannot prove unregistered.
 */
export async function gcPackRenders(opts: {
  packsHome: string;
  registered: ReadonlyMap<string, string | null>;
  registryReadable: boolean;
  maxAgeMs: number;
  keep?: ReadonlySet<string>;
  now?: number;
}): Promise<{ removedRenders: string[]; removedStates: string[] }> {
  const now = opts.now ?? Date.now();
  const removedRenders: string[] = [];
  const removedStates: string[] = [];
  for (const id of await childNames(opts.packsHome)) {
    if (id === 'mounts') continue;
    const renderRoot = join(opts.packsHome, id, 'render');
    const stateDir = join(opts.packsHome, id, 'state');
    const browserDir = join(opts.packsHome, id, 'browser');
    if (!opts.registered.has(id)) {
      if (!opts.registryReadable) continue;
      if (await newerThan([renderRoot, stateDir, browserDir], now - opts.maxAgeMs)) continue;
      if (await isDir(renderRoot)) {
        await rm(renderRoot, { recursive: true, force: true });
        removedRenders.push(renderRoot);
      }
      for (const dir of [stateDir, browserDir]) {
        if (!(await isDir(dir))) continue;
        await rm(dir, { recursive: true, force: true });
        removedStates.push(dir);
      }
      continue;
    }
    const trusted = opts.registered.get(id);
    if (trusted === null || trusted === undefined) continue;
    for (const commit of await childNames(renderRoot)) {
      if (commit === trusted) continue;
      const dir = join(renderRoot, commit);
      if (opts.keep?.has(dir)) continue;
      let mtimeMs: number;
      try {
        mtimeMs = (await lstat(dir)).mtimeMs;
      } catch {
        continue;
      }
      if (now - mtimeMs <= opts.maxAgeMs) continue;
      await rm(dir, { recursive: true, force: true });
      removedRenders.push(dir);
    }
  }
  return { removedRenders, removedStates };
}
