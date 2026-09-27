import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { OVERDECK_HOME, SYNC_SOURCES, isDevMode } from './paths.js';
import { listProjectsSync } from './projects.js';
import { resolveProjectContextFile } from './context-layers/layers.js';
import { summarizeSyncInputChanges } from './sync-change-summary.js';

/**
 * Persisted manifest for the startup sync skip-when-unchanged gate.
 *
 * v2 (PAN-4265) records a digest per input so the dashboard can say what
 * changed, and a `globalHash` that ignores the cwd-scoped inputs so a
 * `pan sync` run from any directory satisfies the dashboard. A v1 manifest has
 * only `hash` and `generatedAt`.
 */
export interface SyncManifest {
  version?: 2;
  hash: string;
  globalHash?: string;
  generatedAt: string;
  inputs?: Record<string, string>;
}

export interface SyncInputStatus {
  needed: boolean;
  reason: string;
  attemptKey: string;
  summary: string;
  changedKeys: string[];
}

function manifestPath(): string {
  return join(OVERDECK_HOME, '.sync-manifest.json');
}

/** The cwd-scoped inputs the dashboard's global comparison ignores. */
function isCwdKey(key: string): boolean {
  return key === 'cwd' || key.startsWith('cwd-skills/');
}

/**
 * Collect a digest for every input that can change the output of `pan sync`,
 * keyed by a stable input key (see the key grammar in PAN-4265 FR-1). A
 * missing sync input throws so the caller's conservative fallback is always a
 * full sync.
 */
function collectSyncInputs(): Record<string, string> {
  const inputs: Record<string, string> = {};

  for (const [key, sourcePath] of Object.entries(SYNC_SOURCES)) {
    if (!existsSync(sourcePath)) {
      throw new Error(`missing sync input: ${key} at ${sourcePath}`);
    }
  }
  addDirectoryDigests(inputs, 'sync-sources', SYNC_SOURCES.root);

  const globalMd = join(OVERDECK_HOME, 'context', 'global.md');
  if (!existsSync(globalMd)) {
    throw new Error('missing global context layer');
  }
  inputs['global-context'] = digestFile(globalMd);

  for (const { key, config } of listProjectsSync()) {
    const projectMd = resolveProjectContextFile(config.path);
    if (existsSync(projectMd)) {
      inputs[`project-context/${key}`] = digestFile(projectMd);
    }

    const projectSkills = join(config.path, '.pan', 'skills');
    if (existsSync(projectSkills)) {
      addDirectoryDigests(inputs, `project-skills/${key}`, projectSkills);
    }
  }

  // mirrorProjectSkillsSync depends on the cwd and its top-level skills/ tree.
  inputs['cwd'] = digestString(process.cwd());
  const cwdSkillsRoot = resolveTopLevelSkillsRoot(process.cwd());
  if (cwdSkillsRoot) {
    addDirectoryDigests(inputs, 'cwd-skills', join(cwdSkillsRoot, 'skills'));
  }

  // Dev mode affects which skills are copied from sync-sources/dev-skills.
  inputs['dev-mode'] = digestString(String(isDevMode()));

  return inputs;
}

/** sha256 over the sorted `key\0digest\n` lines of the inputs that pass `filter`. */
function digestInputs(inputs: Record<string, string>, filter: (key: string) => boolean = () => true): string {
  const hash = createHash('sha256');
  for (const key of Object.keys(inputs).filter(filter).sort()) {
    hash.update(`${key}\0${inputs[key]}\n`);
  }
  return hash.digest('hex');
}

function resolveTopLevelSkillsRoot(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, 'skills');
    if (containsSkillDefinitions(candidate)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function containsSkillDefinitions(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (existsSync(join(dir, entry.name, 'SKILL.md')) || existsSync(join(dir, entry.name, 'skill.md'))) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function addDirectoryDigests(inputs: Record<string, string>, prefix: string, dir: string): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    const key = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      addDirectoryDigests(inputs, key, entryPath);
    } else if (entry.isFile()) {
      inputs[key] = digestFile(entryPath);
    }
  }
}

function digestFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function digestString(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function readManifest(): SyncManifest | null {
  const path = manifestPath();
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as SyncManifest;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Decide whether the startup sync has work to do. Returns `{ needed: false }`
 * only when the persisted manifest at ~/.overdeck/.sync-manifest.json matches
 * the current input hash over every input, cwd included. Any uncertainty
 * (missing input, unreadable manifest, hash computation error) falls back to
 * `{ needed: true }`.
 */
export function isStartupSyncNeeded(): { needed: boolean; reason: string } {
  try {
    const currentHash = digestInputs(collectSyncInputs());
    if (readManifest()?.hash === currentHash) {
      return { needed: false, reason: 'inputs unchanged' };
    }
    return { needed: true, reason: 'inputs changed or no manifest' };
  } catch (err: unknown) {
    return { needed: true, reason: `hash computation failed: ${errorMessage(err)}` };
  }
}

/**
 * The dashboard's view of sync status (PAN-4265): compares only the global
 * inputs (everything except the cwd-scoped keys), so a `pan sync` run from any
 * directory satisfies it, and says what changed since the last recorded sync.
 * `attemptKey` identifies the current input set so an auto-sync never retries
 * the same inputs twice.
 */
export function readSyncInputStatus(): SyncInputStatus {
  let current: Record<string, string>;
  try {
    current = collectSyncInputs();
  } catch (err: unknown) {
    const message = errorMessage(err);
    return {
      needed: true,
      reason: `hash computation failed: ${message}`,
      attemptKey: `error:${message}`,
      summary: `Could not read sync inputs: ${message}`,
      changedKeys: [],
    };
  }

  const globalHash = digestInputs(current, (key) => !isCwdKey(key));
  let manifest: SyncManifest | null;
  try {
    manifest = readManifest();
  } catch {
    // An unreadable manifest reads like a v1 one: changed, no per-file record.
    manifest = { hash: '', generatedAt: '' };
  }

  if (manifest?.globalHash === globalHash) {
    return { needed: false, reason: 'inputs unchanged', attemptKey: globalHash, summary: '', changedKeys: [] };
  }

  const previous = manifest === null ? null : manifest.inputs && manifest.globalHash ? manifest.inputs : 'no-record';
  const { summary, changedKeys } = summarizeSyncInputChanges(previous, current);
  return { needed: true, reason: 'inputs changed or no manifest', attemptKey: globalHash, summary, changedKeys };
}

/**
 * Write the current sync inputs to ~/.overdeck/.sync-manifest.json as a v2
 * manifest. Call after a full sync so the next startup skip gate can succeed.
 */
export function writeSyncManifest(): void {
  const inputs = collectSyncInputs();
  const manifest: SyncManifest = {
    version: 2,
    hash: digestInputs(inputs),
    globalHash: digestInputs(inputs, (key) => !isCwdKey(key)),
    generatedAt: new Date().toISOString(),
    inputs,
  };
  writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}
