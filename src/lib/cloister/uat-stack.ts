/**
 * Live UAT stack lifecycle for batch generations (PAN-1737, absorbs PAN-1738).
 *
 * Each ready generation can serve a real dashboard stack from its persistent
 * worktree: the devcontainer renders via the standard FEATURE_FOLDER template,
 * so the folder name (`uat-<label>-<codename>-<mmdd>`) yields the Traefik host
 * `uat-<label>-<codename>-<mmdd>.overdeck.localhost` with zero new infra.
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
import { findProjectByPathSync } from '../projects.js';

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
  /** Every container the compose project has, running or exited. */
  composePs(composeFile: string, projectName: string): Promise<ComposeServiceState[]>;
  /** Service names the compose file declares under the active profiles. */
  composeServices(composeFile: string, projectName: string): Promise<string[]>;
  /** Tail of one service's logs, for the exit reason. */
  composeServiceLogs(composeFile: string, projectName: string, service: string): Promise<string>;
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
    composePs: async (composeFile, projectName) => {
      const { stdout } = await compose(
        ['-f', composeFile, '-p', projectName, 'ps', '--all', '--format', 'json'],
        dirname(composeFile),
      );
      return parseComposePs(stdout);
    },
    composeServices: async (composeFile, projectName) => {
      const { stdout } = await compose(['-f', composeFile, '-p', projectName, 'config', '--services'], dirname(composeFile));
      return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    },
    composeServiceLogs: async (composeFile, projectName, service) => {
      const { stdout } = await compose(
        ['-f', composeFile, '-p', projectName, 'logs', '--no-color', '--no-log-prefix', '--tail', '200', service],
        dirname(composeFile),
      );
      return stdout;
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
  return `overdeck-${uatStackFolderName(gen)}`;
}

/**
 * The frontend URL the generation's stack serves (or will serve). Prefers the
 * Host(`…`) Traefik label in the rendered compose file; falls back to the
 * FEATURE_FOLDER convention using the project's DNS domain (PAN-1696, D8, FR-10).
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
  // Resolve project config to get DNS domain (PAN-1696). Keep the fallback
  // neutral so a missing project domain cannot fabricate a branded dead link.
  const project = findProjectByPathSync(gen.projectRoot);
  const domain = project?.workspace?.dns?.domain ?? 'localhost';
  return `https://${folder}.${domain}`;
}

export type UatStackStatus = 'running' | 'degraded' | 'unknown' | 'absent';

export interface UatStackProbe {
  status: UatStackStatus;
  frontendUrl: string;
  /** Declared services that are not serving — exited, missing, or unhealthy. */
  downServices?: string[];
  /** service → last error line from its logs, best-effort (degraded only). */
  serviceErrors?: Record<string, string>;
  /** Why the probe could not tell (unknown only). */
  probeError?: string;
}

/**
 * Probe a generation's stack. Self-corrects stale stackStartedAt records.
 *
 * PAN-3166: counting running containers is not a health signal. A stack whose
 * api container died at startup still has three healthy containers, so a count
 * reports `running` and the UI offers "Open UAT frontend" for a gateway
 * timeout. The probe compares what the compose file DECLARES against what is
 * actually up, and pulls the last error line from anything that is down.
 *
 * The four outcomes are deliberately distinct, because `absent` is the only one
 * that CLEARS the stack record — and clearing it destroys the evidence:
 *
 * - **zero containers** → `absent`, and the stale record self-heals. Nothing
 *   ran, so there is nothing to explain.
 * - **containers present, something down or unhealthy** → `degraded`. The
 *   record is preserved so the exited service's logs stay reachable; this is
 *   the path that used to be misreported as `running` (api dead) and, once the
 *   containers finally all stopped, silently self-healed to `absent` — which is
 *   why the Flyway error was unreachable from the UI at all.
 * - **the probe itself failed** → `unknown`, record preserved. A failed
 *   `docker compose ps` is not proof of absence, and must never clear the row.
 */
export async function probeUatStack(gen: UatGeneration, deps: Partial<UatStackDeps> = {}): Promise<UatStackProbe> {
  const d = { ...defaultDeps(), ...deps };
  const frontendUrl = await uatFrontendUrl(gen, d);
  const composeFile = d.findComposeFile(gen.worktreePath);
  if (!composeFile || !gen.stackStartedAt) return { status: 'absent', frontendUrl };

  const project = composeProjectName(gen);
  let containers: ComposeServiceState[];
  try {
    containers = await d.composePs(composeFile, project);
  } catch (err) {
    const probeError = err instanceof Error ? (err.message.split('\n')[0] ?? 'compose ps failed') : String(err);
    d.log?.(`[uat-stack] ${gen.name}: probe failed (${probeError}) — leaving the stack record intact`);
    return { status: 'unknown', frontendUrl, probeError };
  }

  if (containers.length === 0) {
    // Nothing was ever created for this project — the record is stale, heal it.
    try { d.store.setStack(gen.name, null); } catch { /* row may be gone */ }
    return { status: 'absent', frontendUrl };
  }

  let declared: string[];
  try {
    declared = await d.composeServices(composeFile, project);
  } catch (err) {
    const probeError = err instanceof Error ? (err.message.split('\n')[0] ?? 'compose config failed') : String(err);
    d.log?.(`[uat-stack] ${gen.name}: could not read declared services (${probeError})`);
    return { status: 'unknown', frontendUrl, probeError };
  }

  const down = downServices(declared, containers);
  if (down.length === 0) return { status: 'running', frontendUrl };

  const serviceErrors: Record<string, string> = {};
  for (const service of down) {
    const logs = await d.composeServiceLogs(composeFile, project, service).catch(() => '');
    const line = lastErrorLine(logs);
    if (line) serviceErrors[service] = line;
  }
  d.log?.(`[uat-stack] ${gen.name}: degraded — ${down.join(', ')} not serving`);
  return {
    status: 'degraded',
    frontendUrl,
    downServices: down,
    ...(Object.keys(serviceErrors).length > 0 ? { serviceErrors } : {}),
  };
}

/** One compose service's container state, as `docker compose ps --all` reports it. */
export interface ComposeServiceState {
  service: string;
  running: boolean;
  /** Human status, e.g. `Exited (0) 7 minutes ago`. */
  status: string;
  exitCode: number | null;
  /** Compose healthcheck verdict when the service declares one. */
  health?: string;
}

interface ComposePsJson {
  Service?: string;
  State?: string;
  Status?: string;
  ExitCode?: number;
  Health?: string;
}

/**
 * `docker compose ps --format json` emits either one JSON array or one object
 * per line, depending on the Compose version — parse both.
 */
export function parseComposePs(stdout: string): ComposeServiceState[] {
  const rows: ComposePsJson[] = [];
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try { rows.push(...(JSON.parse(trimmed) as ComposePsJson[])); } catch { /* fall through to per-line */ }
  }
  if (rows.length === 0) {
    for (const line of trimmed.split('\n')) {
      if (!line.trim().startsWith('{')) continue;
      try { rows.push(JSON.parse(line) as ComposePsJson); } catch { /* skip malformed row */ }
    }
  }
  return rows
    .filter((row): row is ComposePsJson & { Service: string } => Boolean(row.Service))
    .map((row) => ({
      service: row.Service,
      running: (row.State ?? '').toLowerCase() === 'running',
      status: row.Status ?? row.State ?? '',
      exitCode: typeof row.ExitCode === 'number' ? row.ExitCode : null,
      // Compose reports Health only for services declaring a healthcheck; some
      // versions fold it into Status as `Up 2 minutes (unhealthy)` instead.
      ...(row.Health
        ? { health: row.Health.toLowerCase() }
        : /\(unhealthy\)/i.test(row.Status ?? '')
          ? { health: 'unhealthy' }
          : {}),
    }));
}

/**
 * Init containers exit by design — the same convention the workspace stack
 * health check uses (`src/lib/workspace/stack-health.ts`). Everything else the
 * compose file declares is expected to stay up.
 */
function isOneShotService(service: string): boolean {
  return /(^|[-_])(?:init|init-perms|test-unit)($|[-_])/.test(service.toLowerCase());
}

/**
 * Declared services that are not serving — the honest reading of "is this
 * stack usable?". Three ways to fail:
 *
 * - no container at all, or one that is not running;
 * - running, but Compose reports its healthcheck `unhealthy` (a crash-looping
 *   or wedged api is as unusable as a dead one);
 * - a one-shot that exited non-zero — a failed init means whatever depended on
 *   it never came up either. A one-shot exiting cleanly is by design.
 */
export function downServices(
  declared: readonly string[],
  containers: readonly ComposeServiceState[],
): string[] {
  const byService = new Map(containers.map((c) => [c.service, c]));
  const down: string[] = [];
  for (const service of declared) {
    const container = byService.get(service);
    if (isOneShotService(service)) {
      if (container && !container.running && (container.exitCode ?? 0) !== 0) down.push(service);
      continue;
    }
    if (!container || !container.running || container.health === 'unhealthy') down.push(service);
  }
  return down;
}

const ERROR_LINE = /(caused by:|exception|error|fatal|panic:|\bfailed\b)/i;

/** The most informative line from a dead service's log tail. */
export function lastErrorLine(logs: string): string | null {
  const lines = logs.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;
  // `Caused by:` is the root cause in a JVM stack trace and is what a Flyway
  // version collision surfaces as — prefer it over the generic wrapper above it.
  const caused = [...lines].reverse().find((l) => /caused by:/i.test(l));
  const errorish = caused ?? [...lines].reverse().find((l) => ERROR_LINE.test(l));
  const line = errorish ?? lines[lines.length - 1]!;
  return line.trim().slice(0, 300);
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
