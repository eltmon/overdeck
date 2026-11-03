/**
 * SageOx binding store (PAN-4852 WI-10): the `.sageox/` files `ox init`
 * created for a project, kept at `<packdir>/bindings/<projectKey>/` so a
 * launch can place them in a worktree without the project committing them.
 * Files are stored under their `.sageox/`-relative names. A binding is valid
 * only with `config.json` and at most 50 files (AD-11).
 *
 * The link state (AD-26) combines the store with the committed flag: a project
 * whose `projects.yaml` entry says `sageox_binding: committed`, or whose
 * default branch tracks `.sageox/config.json`, is `committed`.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, posix, relative } from 'node:path';
import { promisify } from 'node:util';
import { defaultBranchForRepo } from '../project-repos.js';
import { listProjectsAsync } from '../projects.js';
import { packCacheDir } from '../skill-packs/sources.js';
import type { ProjectWithSageox } from './config.js';

const execFileAsync = promisify(execFile);

const PROJECT_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_BINDING_FILES = 50;
const CONFIG_FILE = 'config.json';

export type SageoxLinkState = 'committed' | 'held' | 'none';

export function bindingDir(projectKey: string): string {
  if (!PROJECT_KEY_PATTERN.test(projectKey) || projectKey === '.' || projectKey === '..') {
    throw new Error(`invalid project key for a SageOx binding: ${JSON.stringify(projectKey)}`);
  }
  return join(packCacheDir('sageox'), 'bindings', projectKey);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** The binding's files as sorted `.sageox/`-relative paths; null unless `config.json` exists. */
export async function readBinding(projectKey: string): Promise<{ files: string[] } | null> {
  const dir = bindingDir(projectKey);
  if (!(await isFile(join(dir, CONFIG_FILE)))) return null;
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter(entry => entry.isFile())
    .map(entry => relative(dir, join(entry.parentPath, entry.name)).split(/[\\/]/).join('/'))
    .sort();
  return { files };
}

function normalizeBindingFile(file: string): string {
  const normalized = posix.normalize(file);
  const segments = normalized.split('/');
  if (
    file.length === 0 ||
    posix.isAbsolute(file) ||
    file.includes('\\') ||
    segments.some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`invalid SageOx binding file path: ${JSON.stringify(file)}`);
  }
  return normalized;
}

/**
 * Replaces the project's binding with `files` copied from `sourceSageoxDir`.
 * Copies into a sibling temp directory first, then swaps it in, so a reader
 * never sees a half-written binding.
 */
export async function writeBinding(projectKey: string, sourceSageoxDir: string, files: readonly string[]): Promise<void> {
  const dir = bindingDir(projectKey);
  const unique = [...new Set(files.map(normalizeBindingFile))];
  if (!unique.includes(CONFIG_FILE)) {
    throw new Error(`SageOx binding for ${projectKey} has no ${CONFIG_FILE}`);
  }
  if (unique.length > MAX_BINDING_FILES) {
    throw new Error(`SageOx binding for ${projectKey} has ${unique.length} files; the limit is ${MAX_BINDING_FILES}`);
  }

  await mkdir(dirname(dir), { recursive: true });
  const tmp = `${dir}.tmp-${randomBytes(4).toString('hex')}`;
  const aside = `${dir}.old-${randomBytes(4).toString('hex')}`;
  try {
    for (const file of unique) {
      const target = join(tmp, file);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(sourceSageoxDir, file), target);
    }
    let movedAside = false;
    try {
      await rename(dir, aside);
      movedAside = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      await rename(tmp, dir);
    } catch (error) {
      if (movedAside) await rename(aside, dir);
      throw error;
    }
    if (movedAside) await rm(aside, { recursive: true, force: true });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function refHasSageoxConfig(projectRoot: string, ref: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['cat-file', '-e', `${ref}:.sageox/${CONFIG_FILE}`], { cwd: projectRoot });
    return true;
  } catch {
    return false;
  }
}

/** True when `origin/<default>` (else the local `<default>`) tracks `.sageox/config.json`. */
export async function defaultBranchTracksSageox(projectRoot: string, defaultBranch: string): Promise<boolean> {
  if (!defaultBranch || defaultBranch.startsWith('-')) return false;
  return (
    (await refHasSageoxConfig(projectRoot, `origin/${defaultBranch}`)) ||
    (await refHasSageoxConfig(projectRoot, defaultBranch))
  );
}

export async function readSageoxLinkState(projectKey: string): Promise<SageoxLinkState> {
  const project = (await listProjectsAsync()).find(entry => entry.key === projectKey)?.config as
    | ProjectWithSageox
    | undefined;
  if (project) {
    if (project.sageox_binding === 'committed') return 'committed';
    if (project.path && (await defaultBranchTracksSageox(project.path, defaultBranchForRepo(project, project.path)))) {
      return 'committed';
    }
  }
  return (await readBinding(projectKey)) ? 'held' : 'none';
}
