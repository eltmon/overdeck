/**
 * Live UAT stack lifecycle for batch generations (PAN-1737, absorbs PAN-1738).
 *
 * Each ready generation can serve a real dashboard stack from its persistent
 * worktree: the devcontainer renders via the standard FEATURE_FOLDER template,
 * so the folder name (`uat-<label>-<codename>-<mmdd>`) yields the Traefik host
 * `uat-<label>-<codename>-<mmdd>.pan.localhost` with zero new infra.
 *
 * HARD INVARIANT — max 2 UAT stacks run concurrently. Docker's default
 * address pool fits ~31 bridge networks; accumulating UAT stacks would
 * eventually block ALL workspace creation ("all predefined address pools
 * have been fully subnetted"). Starting a third stack tears down the oldest
 * first, and invalidation/promotion always tear the generation's stack down.
 *
 * All process exec is async (server-reachable code — never execSync).
 */
import { existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { readFile } from 'node:fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ensureDevcontainerSync } from '../workspace/ensure-devcontainer.js';
import {
  listUatGenerationsWithStacksSync,
  setUatGenerationStackStartedAtSync,
  type UatGeneration,
} from '../overdeck/merge-sync.js';

const execFileAsync = promisify(execFile);

export const MAX_UAT_STACKS = 2;

const COMPOSE_FILES = [
  'docker-compose.devcontainer.yml',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];

const stackMutationLocks = new Map<string, Promise<void>>();

async function withStackMutationLock<T>(projectRoot: string, fn: () => Promise<T>): Promise<T> {
  const previous = stackMutationLocks.get(projectRoot) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => current);
  stackMutationLocks.set(projectRoot, tail);
  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (stackMutationLocks.get(projectRoot) === tail) stackMutationLocks.delete(projectRoot);
  }
}

export interface UatStackDeps {
  /** Render `.devcontainer/` if missing; issueId only resolves project config. */
  ensureDevcontainer(workspacePath: string, issueId: string): { ok: boolean; error?: string };
  composeUp(composeFile: string, projectName: string): Promise<void>;
  composeDown(composeFile: string, projectName: string): Promise<void>;
  /** Number of running containers for the compose project. */
  composePsCount(composeFile: string, projectName: string): Promise<number>;
  findComposeFile(workspacePath: string): string | null;
  readComposeFile(composeFile: string): Promise<string>;
  store: {
    setStack(name: string, startedAt: string | null): void;
    listWithStacks(): UatGeneration[];
  };
  log?: (msg: string) => void;
}

function defaultDeps(): UatStackDeps {
  const compose = (args: string[], cwd: string) =>
    execFileAsync('docker', ['compose', ...args], {
      cwd,
      encoding: 'utf-8',
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });

  return {
    ensureDevcontainer: (workspacePath, issueId) => {
      const result = ensureDevcontainerSync({ workspacePath, issueId });
      return result.step.success
        ? { ok: true }
        : { ok: false, error: result.step.error ?? 'devcontainer render failed' };
    },
    composeUp: async (composeFile, projectName) => {
      await compose(['-f', composeFile, '-p', projectName, 'up', '-d', '--build'], dirname(composeFile));
    },
    composeDown: async (composeFile, projectName) => {
      await compose(['-f', composeFile, '-p', projectName, 'down', '-v', '--remove-orphans'], dirname(composeFile));
    },
    composePsCount: async (composeFile, projectName) => {
      const { stdout } = await compose(['-f', composeFile, '-p', projectName, 'ps', '-q'], dirname(composeFile));
      return stdout.split('\n').filter((l) => l.trim().length > 0).length;
    },
    findComposeFile: (workspacePath) => {
      const devcontainerDir = join(workspacePath, '.devcontainer');
      for (const file of COMPOSE_FILES) {
        const fullPath = join(devcontainerDir, file);
        if (existsSync(fullPath)) return fullPath;
      }
      return null;
    },
    readComposeFile: (composeFile) => readFile(composeFile, 'utf-8'),
    store: {
      setStack: (name, startedAt) => setUatGenerationStackStartedAtSync(name, startedAt),
      listWithStacks: () => listUatGenerationsWithStacksSync(),
    },
  };
}

export function uatStackFolderName(gen: UatGeneration): string {
  return basename(gen.worktreePath);
}

function composeProjectName(gen: UatGeneration): string {
  return `panopticon-${uatStackFolderName(gen)}`;
}

/**
 * The frontend URL the generation's stack serves (or will serve). Prefers the
 * Host(`…`) Traefik label in the rendered compose file; falls back to the
 * FEATURE_FOLDER convention.
 */
export async function uatFrontendUrl(gen: UatGeneration, deps: Partial<UatStackDeps> = {}): Promise<string> {
  const d = { ...defaultDeps(), ...deps };
  const folder = uatStackFolderName(gen);
  const composeFile = d.findComposeFile(gen.worktreePath);
  if (composeFile) {
    try {
      const content = await d.readComposeFile(composeFile);
      const hostMatch = content.match(new RegExp('Host\\(`(' + folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.[^`]+)`\\)'));
      if (hostMatch?.[1]) return `https://${hostMatch[1]}`;
    } catch { /* fall through to convention */ }
  }
  return `https://${folder}.pan.localhost`;
}

export type UatStackStatus = 'running' | 'absent';

export interface UatStackProbe {
  status: UatStackStatus;
  frontendUrl: string;
}

/** Probe a generation's stack. Self-corrects stale stackStartedAt records. */
export async function probeUatStack(gen: UatGeneration, deps: Partial<UatStackDeps> = {}): Promise<UatStackProbe> {
  const d = { ...defaultDeps(), ...deps };
  const frontendUrl = await uatFrontendUrl(gen, d);
  const composeFile = d.findComposeFile(gen.worktreePath);
  if (!composeFile || !gen.stackStartedAt) return { status: 'absent', frontendUrl };
  const count = await d.composePsCount(composeFile, composeProjectName(gen)).catch(() => 0);
  if (count === 0) {
    // Record says running but nothing is — heal the record.
    try { d.store.setStack(gen.name, null); } catch { /* row may be gone */ }
    return { status: 'absent', frontendUrl };
  }
  return { status: 'running', frontendUrl };
}

export interface EnsureUatStackResult {
  success: boolean;
  error?: string;
  frontendUrl?: string;
  /** Generations whose stacks were torn down to respect MAX_UAT_STACKS. */
  evicted: string[];
}

/**
 * Bring up the live stack for a generation (idempotent — compose up on a
 * running project is a no-op). Enforces MAX_UAT_STACKS by tearing down the
 * oldest running UAT stack(s) first.
 */
export async function ensureUatStack(gen: UatGeneration, deps: Partial<UatStackDeps> = {}): Promise<EnsureUatStackResult> {
  return withStackMutationLock(gen.projectRoot, async () => {
    const d = { ...defaultDeps(), ...deps };
    const log = d.log ?? (() => {});
    const evicted: string[] = [];

    const member = gen.members[0];
    if (!member) return { success: false, error: 'generation has no members', evicted };

    // Cap enforcement happens inside the lock and re-reads the live stack set so
    // concurrent start requests cannot both observe the same stale pre-start set.
    const others = d.store.listWithStacks().filter((g) => g.name !== gen.name);
    while (others.length > 0 && others.length >= MAX_UAT_STACKS) {
      const oldest = others.shift()!;
      log(`[uat-stack] cap ${MAX_UAT_STACKS} reached — tearing down oldest stack ${oldest.name}`);
      try {
        await teardownUatStackUnlocked(oldest, d);
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? (err.message.split('\n')[0] ?? 'stack teardown failed') : String(err),
          evicted,
        };
      }
      evicted.push(oldest.name);
    }

    const rendered = d.ensureDevcontainer(gen.worktreePath, member.issueId);
    if (!rendered.ok) return { success: false, error: rendered.error ?? 'devcontainer render failed', evicted };

    const composeFile = d.findComposeFile(gen.worktreePath);
    if (!composeFile) {
      return { success: false, error: `no compose file under ${gen.worktreePath}/.devcontainer`, evicted };
    }

    try {
      await d.composeUp(composeFile, composeProjectName(gen));
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? (err.message.split('\n')[0] ?? 'compose up failed') : String(err),
        evicted,
      };
    }

    d.store.setStack(gen.name, new Date().toISOString());
    const frontendUrl = await uatFrontendUrl(gen, d);
    log(`[uat-stack] ${gen.name}: stack up at ${frontendUrl}`);
    return { success: true, frontendUrl, evicted };
  });
}

async function teardownUatStackUnlocked(gen: UatGeneration, d: UatStackDeps): Promise<void> {
  const composeFile = d.findComposeFile(gen.worktreePath);
  if (composeFile) {
    try {
      await d.composeDown(composeFile, composeProjectName(gen));
    } catch (err) {
      d.log?.(`[uat-stack] ${gen.name}: compose down failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
      throw err;
    }
  }
  try { d.store.setStack(gen.name, null); } catch { /* row may be gone */ }
}

/**
 * Tear the generation's stack down (idempotent) and clear its stack record.
 * MUST be called on invalidation, promotion, and generation cleanup —
 * orphaned uat networks eventually block all workspace creation.
 */
export async function teardownUatStack(gen: UatGeneration, deps: Partial<UatStackDeps> = {}): Promise<void> {
  await withStackMutationLock(gen.projectRoot, async () => {
    const d = { ...defaultDeps(), ...deps };
    await teardownUatStackUnlocked(gen, d);
  });
}
