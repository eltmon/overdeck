/**
 * SageOx placement at launch (PAN-4852 WI-11): copy a project's binding from
 * the binding store into `<root>/.sageox/` and hide it from `git status`, so
 * an issue can use SageOx without the project committing `.sageox/`.
 *
 * Four `.sageox/` states (AD-15):
 * - **tracked**: git tracks `.sageox/config.json`. Overdeck never writes there.
 * - **placed**: `.sageox/.overdeck-placed` exists. Overdeck owns the files the
 *   marker lists.
 * - **hand-made**: an untracked `.sageox/` without a marker that holds a
 *   `config.json` (or is a symlink). Overdeck uses it and never changes it.
 * - **absent**: no `.sageox/`, or a real untracked `.sageox/` with neither a
 *   marker nor a `config.json` — what switch-off leaves behind (`ox`'s
 *   `logs/`, `cache/`, …). Overdeck places the binding when one exists, so
 *   switching SageOx off and on again restores it.
 *
 * Placement order (AD-16): hide first, then copy, then write the marker, so a
 * half-placed `.sageox/` never shows in `git status`. Copies are atomic (temp
 * file + rename) and skip files whose bytes already match.
 *
 * Switch-off (AD-17, WI-12): when SageOx resolves off, the launch removes the
 * marker-listed files git does not track, then the marker. It keeps the hide
 * and everything `ox` wrote at run time (`logs/`, `cache/`, `sessions/`, …).
 *
 * The marker lives in the worktree and is untrusted: every path it names is
 * resolved inside `<root>/.sageox/` before Overdeck deletes it.
 *
 * Async only: every git call goes through execFile.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { setExcludeBlock } from '../git/worktree-exclude.js';
import { bindingDir, readBinding } from './binding.js';

const execFileAsync = promisify(execFile);

export const PLACEMENT_MARKER = '.overdeck-placed';

export type SageoxDirState = 'tracked' | 'placed' | 'hand-made' | 'absent';

const SAGEOX_DIR = '.sageox';
const HIDE_PATTERNS = ['/.sageox/'] as const;

interface PlacementMarker {
  version: 1;
  projectKey: string;
  files: string[];
  placedAt: string;
}

/** True when git tracks `.sageox/<file>` in `root`. */
async function isTracked(root: string, file: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['ls-files', '--error-unmatch', '--', `${SAGEOX_DIR}/${file}`], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

async function exists(check: Promise<{ isDirectory(): boolean; isFile(): boolean }>, kind: 'dir' | 'file'): Promise<boolean> {
  try {
    const stats = await check;
    return kind === 'dir' ? stats.isDirectory() : stats.isFile();
  } catch {
    return false;
  }
}

/**
 * `<root>/.sageox/<file>`, or null when `file` is empty, absolute, the marker,
 * or resolves outside `<root>/.sageox/`.
 */
function insideSageox(root: string, file: string): string | null {
  if (typeof file !== 'string' || file.length === 0 || isAbsolute(file)) return null;
  const base = resolve(root, SAGEOX_DIR);
  const target = resolve(base, file);
  const rel = relative(base, target);
  if (rel === '' || rel === PLACEMENT_MARKER || rel.startsWith('..') || isAbsolute(rel)) return null;
  return target;
}

export async function sageoxDirState(root: string): Promise<SageoxDirState> {
  if (await isTracked(root, 'config.json')) return 'tracked';
  const dir = join(root, SAGEOX_DIR);
  // The marker counts only inside a real directory; a symlinked `.sageox/`
  // is the operator's, so it is hand-made and never written through.
  const realDir = await exists(lstat(dir), 'dir');
  if (realDir && (await exists(lstat(join(dir, PLACEMENT_MARKER)), 'file'))) return 'placed';
  // No marker and no config.json: only runtime leftovers, nothing hand-made to protect.
  if (realDir && !(await exists(lstat(join(dir, 'config.json')), 'file'))) return 'absent';
  if (await exists(stat(dir), 'dir')) return 'hand-made';
  return 'absent';
}

/**
 * True when `target`'s real parent folder is still inside `<root>/.sageox/`.
 * A symlinked folder inside `.sageox/` could point anywhere, so a delete
 * through it is refused.
 */
async function realParentInsideSageox(root: string, target: string): Promise<boolean> {
  const [realBase, realParent] = await Promise.all([
    realpath(resolve(root, SAGEOX_DIR)).catch(() => null),
    realpath(dirname(target)).catch(() => null),
  ]);
  if (!realBase || !realParent) return false;
  const rel = relative(realBase, realParent);
  return !rel.startsWith('..') && !isAbsolute(rel);
}

/** The marker's project key and file list; an empty list when it is missing or invalid. */
async function readMarker(root: string): Promise<{ projectKey: string | null; files: string[] }> {
  try {
    const parsed = JSON.parse(await readFile(join(root, SAGEOX_DIR, PLACEMENT_MARKER), 'utf8')) as Partial<PlacementMarker>;
    const files = Array.isArray(parsed.files) ? parsed.files.filter((file): file is string => typeof file === 'string') : [];
    return { projectKey: typeof parsed.projectKey === 'string' ? parsed.projectKey : null, files };
  } catch {
    return { projectKey: null, files: [] };
  }
}

async function sameBytes(a: string, b: string): Promise<boolean> {
  try {
    const [left, right] = await Promise.all([readFile(a), readFile(b)]);
    return left.equals(right);
  } catch {
    return false;
  }
}

/** Write `file` through a temp file in the same directory, then rename it into place. */
async function writeAtomic(file: string, write: (temp: string) => Promise<void>): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.overdeck-tmp-${randomBytes(4).toString('hex')}`;
  try {
    await write(temp);
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

/**
 * Make sure `<root>/.sageox/` holds the project's SageOx binding (AD-15, AD-16).
 * A tracked or hand-made `.sageox/` is used as it is. Otherwise the binding is
 * hidden, copied and recorded in the marker; on success the state is `placed`.
 * Only a missing binding is a soft failure; other errors throw, and the launch
 * step turns them into one warning.
 */
export async function ensureSageoxPlaced(
  root: string,
  projectKey: string,
): Promise<{ ok: true; state: SageoxDirState } | { ok: false; warning: string }> {
  const state = await sageoxDirState(root);
  if (state === 'tracked' || state === 'hand-made') return { ok: true, state };

  const binding = await readBinding(projectKey);
  if (!binding) {
    return {
      ok: false,
      warning: `SageOx not applied: project ${projectKey} has no SageOx link; run pan skills pack sageox link --project ${projectKey}`,
    };
  }

  const source = bindingDir(projectKey);
  const files: string[] = [];
  const targets: Array<{ file: string; target: string }> = [];
  for (const file of binding.files) {
    const target = insideSageox(root, file);
    if (!target) throw new Error(`SageOx binding for ${projectKey} names an unsafe path: ${JSON.stringify(file)}`);
    files.push(file);
    targets.push({ file, target });
  }

  await setExcludeBlock(root, 'sageox', HIDE_PATTERNS);

  for (const { file, target } of targets) {
    const from = join(source, file);
    if (await sameBytes(from, target)) continue;
    await writeAtomic(target, temp => copyFile(from, temp));
  }

  const previous = state === 'placed' ? await readMarker(root) : null;
  if (previous) {
    // Compare resolved paths, so `./config.json` in a hand-edited marker still matches.
    const keep = new Set(targets.map(entry => entry.target));
    for (const file of previous.files) {
      const target = insideSageox(root, file);
      if (!target || keep.has(target)) continue;
      if (!(await realParentInsideSageox(root, target))) continue;
      const rel = relative(resolve(root, SAGEOX_DIR), target).split('\\').join('/');
      if (await isTracked(root, rel)) continue;
      // Only files: a marker entry naming a directory deletes nothing.
      const stats = await lstat(target).catch(() => null);
      if (stats && !stats.isDirectory()) await rm(target, { force: true });
    }
    const unchanged =
      previous.projectKey === projectKey &&
      previous.files.length === files.length &&
      previous.files.every((file, index) => file === files[index]);
    if (unchanged) return { ok: true, state: 'placed' };
  }

  const marker: PlacementMarker = { version: 1, projectKey, files, placedAt: new Date().toISOString() };
  await writeAtomic(join(root, SAGEOX_DIR, PLACEMENT_MARKER), temp => writeFile(temp, `${JSON.stringify(marker, null, 2)}\n`, 'utf8'));
  return { ok: true, state: 'placed' };
}

/**
 * Remove a placed SageOx binding from `root` (AD-17). Without a marker this
 * returns at once and runs no git command, so launches that never used SageOx
 * pay one `lstat`. Otherwise it deletes each marker-listed file that resolves
 * inside `<root>/.sageox/` and that git does not track, then the marker. The
 * exclude block and every other file stay.
 */
export async function removeSageoxPlacement(root: string): Promise<{ removed: string[] }> {
  const dir = join(root, SAGEOX_DIR);
  const markerPath = join(dir, PLACEMENT_MARKER);
  // Same rule as sageoxDirState: a symlinked `.sageox/` is never placed, so nothing to remove.
  if (!(await exists(lstat(dir), 'dir')) || !(await exists(lstat(markerPath), 'file'))) return { removed: [] };

  const { files } = await readMarker(root);
  const base = resolve(root, SAGEOX_DIR);
  const removed: string[] = [];
  for (const file of files) {
    const target = insideSageox(root, file);
    if (!target || !(await realParentInsideSageox(root, target))) continue;
    const rel = relative(base, target).split('\\').join('/');
    if (await isTracked(root, rel)) continue;
    // Only files: a marker entry naming a directory deletes nothing.
    const stats = await lstat(target).catch(() => null);
    if (!stats || stats.isDirectory()) continue;
    await rm(target, { force: true });
    removed.push(rel);
  }
  if (!(await isTracked(root, PLACEMENT_MARKER))) await rm(markerPath, { force: true });
  return { removed };
}
