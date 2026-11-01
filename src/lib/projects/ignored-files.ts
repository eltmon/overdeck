/**
 * A project's git-ignored files that may cross to another machine (PAN-4651
 * FR-4, D-4651-14): `.env`-style files a fresh clone lacks.
 *
 * `listIgnoredFiles` runs `git ls-files --others --ignored --exclude-standard
 * --directory` at the project root (async `execFile`, 10 s) and keeps regular
 * files (never directories or symlinks) of at most 1 MiB, at most three
 * directories deep, outside `node_modules/`, `.git/`, `.overdeck/`, `.pan/`,
 * `dist/` and `build/`, at most 200 of them. `.env`, `.envrc` and `.dev.vars`
 * are preselected.
 *
 * Every read and write goes through `resolveProjectFile`, which refuses an
 * absolute path, a `..` segment, a symlink, and anything whose real path
 * leaves the project root. Writes never overwrite: an existing file is
 * reported `skipped`.
 */
import { execFile as nodeExecFile } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';

export const MAX_PROJECT_FILE_BYTES = 1024 * 1024;
export const MAX_IGNORED_FILES = 200;
const MAX_DEPTH = 3;
const EXCLUDED_SEGMENTS: ReadonlySet<string> = new Set(['node_modules', '.git', '.overdeck', '.pan', 'dist', 'build']);
const PRESELECTED: ReadonlySet<string> = new Set(['.env', '.envrc', '.dev.vars']);

export interface IgnoredFile {
  path: string;
  bytes: number;
  preselected: boolean;
}

export type GitInRoot = (args: readonly string[], cwd: string, timeoutMs: number) => Promise<string>;

export const gitInRoot: GitInRoot = (args, cwd, timeoutMs) =>
  new Promise((resolve, reject) => {
    nodeExecFile('git', [...args], { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout));
    });
  });

export class ProjectFileError extends Error {
  constructor(readonly code: 'bad-path' | 'not-found' | 'too-large', message: string) {
    super(message);
    this.name = 'ProjectFileError';
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function checkRelative(path: string): string[] {
  if (!path || isAbsolute(path) || path.includes('\0')) throw new ProjectFileError('bad-path', `${JSON.stringify(path)} is not a path inside the project`);
  const segments = path.split(/[\\/]+/).filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0 || segments.includes('..')) throw new ProjectFileError('bad-path', `${JSON.stringify(path)} is not a path inside the project`);
  return segments;
}

/**
 * The absolute path of a file inside the project root. Refuses absolute paths,
 * `..`, symlinks (the file or any directory on the way) and real paths outside
 * the root. `mustExist: false` allows a missing file (for a write).
 */
export async function resolveProjectFile(root: string, path: string, options: { mustExist: boolean }): Promise<string> {
  const segments = checkRelative(path);
  const realRoot = await realpath(root);
  let current = realRoot;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const stat = await lstat(current).catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? null : Promise.reject(error)));
    if (!stat) {
      if (options.mustExist) throw new ProjectFileError('not-found', `${path} does not exist in the project`);
      return join(realRoot, ...segments);
    }
    if (stat.isSymbolicLink()) throw new ProjectFileError('bad-path', `${path} goes through a symlink`);
    const last = index === segments.length - 1;
    if (last && !stat.isFile()) throw new ProjectFileError('bad-path', `${path} is not a regular file`);
  }
  if (!isInside(realRoot, await realpath(current))) throw new ProjectFileError('bad-path', `${path} is outside the project`);
  return current;
}

/** The git-ignored files of a project root that may be copied, sorted by path. */
export async function listIgnoredFiles(root: string, git: GitInRoot = gitInRoot): Promise<IgnoredFile[]> {
  const output = await git(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'], root, 10_000);
  const files: IgnoredFile[] = [];
  for (const line of output.split('\n')) {
    const path = line.trim();
    if (!path || path.endsWith('/')) continue;
    const segments = path.split('/');
    if (segments.length - 1 > MAX_DEPTH || segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) continue;
    const stat = await lstat(join(root, path)).catch(() => null);
    if (!stat || !stat.isFile() || stat.size > MAX_PROJECT_FILE_BYTES) continue;
    files.push({ path, bytes: stat.size, preselected: PRESELECTED.has(basename(path)) });
    if (files.length >= MAX_IGNORED_FILES) break;
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** One project file's bytes, through the path checks; refuses files over 1 MiB. */
export async function readProjectFile(root: string, path: string): Promise<Buffer> {
  const absolute = await resolveProjectFile(root, path, { mustExist: true });
  const stat = await lstat(absolute);
  if (stat.size > MAX_PROJECT_FILE_BYTES) throw new ProjectFileError('too-large', `${path} is larger than 1 MiB`);
  return readFile(absolute);
}

/** Write a copied file (0600) without overwriting; `skipped` when it already exists. */
export async function writeProjectFileExclusive(root: string, path: string, contents: Buffer): Promise<'written' | 'skipped'> {
  if (contents.length > MAX_PROJECT_FILE_BYTES) throw new ProjectFileError('too-large', `${path} is larger than 1 MiB`);
  const absolute = await resolveProjectFile(root, path, { mustExist: false });
  await mkdir(dirname(absolute), { recursive: true });
  // The parent may have been created just now; re-check that nothing on the way is a symlink.
  await resolveProjectFile(root, path, { mustExist: false });
  try {
    await writeFile(absolute, contents, { flag: 'wx', mode: 0o600 });
    return 'written';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'skipped';
    throw error;
  }
}

/** `git remote get-url origin` without `user:password@`; else `https://<gitOrigin>.git`. */
export async function projectCloneUrl(root: string, gitOrigin: string | null, git: GitInRoot = gitInRoot): Promise<string | null> {
  const raw = (await git(['remote', 'get-url', 'origin'], root, 10_000).catch(() => '')).trim();
  if (raw) return stripUserinfo(raw);
  return gitOrigin ? `https://${gitOrigin}.git` : null;
}

export function stripUserinfo(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1');
}
