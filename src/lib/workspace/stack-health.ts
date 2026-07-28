import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import { emitActivityEntrySync } from '../activity-logger.js';
import {
  getCachedDockerContainerLifecycleObservedAt,
  getCachedDockerContainerLifecycleSnapshot,
  recordDockerContainerLifecycleSnapshot,
  type DockerContainerLifecycle,
} from '../docker-stats.js';
import { parseIssueIdSync } from '../issue-id.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';

const execFileAsync = promisify(execFile);

export const DEFAULT_STUCK_CREATED_THRESHOLD_MS = 120_000;

export type { DockerContainerLifecycle } from '../docker-stats.js';

function declaredComposeProjectName(content: string, featureFolder: string): string | null {
  const templatedMatch = content.match(/COMPOSE_PROJECT_NAME="([^$"]*)\$\{FEATURE_FOLDER\}"/);
  if (templatedMatch) return `${templatedMatch[1]}${featureFolder}`;
  const literalMatch = content.match(/COMPOSE_PROJECT_NAME="([^"]+)"/);
  return literalMatch?.[1] ?? null;
}

// Duplicated from rebuild-stack.ts's COMPOSE_FILES intentionally: this module
// cannot import from rebuild-stack.ts (it imports composeProjectNameForWorkspace
// from here), and health checks need the same candidate list without a cycle.
const COMPOSE_FILE_CANDIDATES = [
  'docker-compose.devcontainer.yml',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];

function findDevcontainerComposeFile(workspacePath: string): string | null {
  const devcontainerDir = join(workspacePath, '.devcontainer');
  for (const file of COMPOSE_FILE_CANDIDATES) {
    const fullPath = join(devcontainerDir, file);
    if (existsSync(fullPath)) return fullPath;
  }
  return null;
}

/** Parse a top-level (unindented) compose `name:` key, e.g. `name: myn-feature-min-901`. */
function declaredComposeFileProjectName(content: string, featureFolder: string): string | null {
  const match = content.match(/^name:\s*['"]?([^'"\n]+?)['"]?\s*$/m);
  if (!match) return null;
  const raw = match[1].trim();
  return raw.includes('${FEATURE_FOLDER}') ? raw.replace('${FEATURE_FOLDER}', featureFolder) : raw;
}

function assertDeclaredNameMatchesFeatureFolder(
  sourcePath: string,
  declaredKey: string,
  declared: string,
  featureFolder: string,
): void {
  if (!declared.endsWith(featureFolder)) {
    throw new Error(
      `Refusing workspace rebuild: ${sourcePath} declares ${declaredKey}=${declared}, expected a name ending in ${featureFolder}`,
    );
  }
}

/**
 * Resolve the compose project name declared by the workspace's dev script or
 * devcontainer compose file, without applying the `overdeck-` fallback.
 * Returns `{ name: null, composeFilePath }` when neither source declares one —
 * `composeFilePath` is non-null when a compose file exists so callers can
 * report where they looked.
 */
function resolveDeclaredComposeProjectName(
  workspacePath: string,
  featureFolder: string,
): { name: string | null; composeFilePath: string | null } {
  for (const devPath of [join(workspacePath, '.devcontainer', 'dev'), join(workspacePath, 'dev')]) {
    if (!existsSync(devPath)) continue;
    try {
      const declared = declaredComposeProjectName(readFileSync(devPath, 'utf-8'), featureFolder);
      if (!declared) continue;
      assertDeclaredNameMatchesFeatureFolder(devPath, 'COMPOSE_PROJECT_NAME', declared, featureFolder);
      return { name: declared, composeFilePath: null };
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('Refusing workspace rebuild:')) throw err;
    }
  }

  const composeFilePath = findDevcontainerComposeFile(workspacePath);
  if (!composeFilePath) return { name: null, composeFilePath: null };

  const declared = declaredComposeFileProjectName(readFileSync(composeFilePath, 'utf-8'), featureFolder);
  if (!declared) return { name: null, composeFilePath };
  assertDeclaredNameMatchesFeatureFolder(composeFilePath, 'name', declared, featureFolder);
  return { name: declared, composeFilePath };
}

/**
 * Derive the canonical `COMPOSE_PROJECT_NAME` for a workspace. Throws when the
 * workspace declares a name that does not end in the feature folder — a
 * mismatch means `docker compose down` would target the wrong stack.
 * (Lives here rather than in rebuild-stack so health checks can scope
 * container matching without an import cycle.)
 *
 * Silently falls back to `overdeck-feature-<issue>` when no dev script or
 * compose file declares a name. Use `requireComposeProjectNameForWorkspace`
 * at bring-up time, where a workspace with a compose file but no resolvable
 * name is a bug to surface, not a condition to paper over with a guess.
 */
export function composeProjectNameForWorkspace(workspacePath: string, issueId: string): string {
  const featureFolder = `feature-${issueId.toLowerCase()}`;
  const fallback = `overdeck-${featureFolder}`;
  return resolveDeclaredComposeProjectName(workspacePath, featureFolder).name ?? fallback;
}

/**
 * Strict counterpart to `composeProjectNameForWorkspace`. When a devcontainer
 * compose file exists but neither it nor any dev script declares a name,
 * throws instead of silently returning the `overdeck-` fallback — that
 * silent guess is what let a second stack spring up beside a workspace's real
 * `myn-feature-*` stack (PAN-3049). Non-docker workspaces (no compose file at
 * all) still resolve to the `overdeck-` fallback, matching the lenient variant.
 */
export function requireComposeProjectNameForWorkspace(workspacePath: string, issueId: string): string {
  const featureFolder = `feature-${issueId.toLowerCase()}`;
  const resolved = resolveDeclaredComposeProjectName(workspacePath, featureFolder);
  if (resolved.name) return resolved.name;
  if (!resolved.composeFilePath) return `overdeck-${featureFolder}`;
  throw new Error(
    `Cannot resolve compose project name for workspace ${workspacePath}: ${resolved.composeFilePath} declares no top-level 'name:' and neither ${join(workspacePath, '.devcontainer', 'dev')} nor ${join(workspacePath, 'dev')} declares COMPOSE_PROJECT_NAME`,
  );
}

/**
 * Best-effort canonical compose project for a workspace — null when the
 * workspace (or its dev file) is missing or declares a conflicting name, in
 * which case callers fall back to name-token matching.
 */
export function tryComposeProjectNameForWorkspace(workspacePath: string | null | undefined, issueId: string): string | null {
  if (!workspacePath || !existsSync(workspacePath)) return null;
  try {
    return composeProjectNameForWorkspace(workspacePath, issueId);
  } catch {
    return null;
  }
}

export interface WorkspaceStackHealth {
  healthy: boolean;
  reasons: string[];
  lastObserved: string;
  /**
   * False when the workspace has no rendered .devcontainer, i.e. the stack was
   * never provisioned. Zero containers is then vacuously "healthy" for
   * pipeline gating, but UIs must not present it as a live healthy stack
   * (MIN-892 showed "UAT stack healthy" + UAT links that 404'd).
   * Only set on the docker-workspace path; undefined for non-docker projects.
   */
  stackExpected?: boolean;
}

export interface WorkspaceStackProject {
  path?: string;
  workspace?: { workspaces_dir?: string; docker?: { compose_template?: string } };
}

export interface WorkspaceStackHealthOptions {
  projectConfig?: WorkspaceStackProject | null;
  containers?: DockerContainerLifecycle[];
  now?: Date;
  stuckCreatedThresholdMs?: number;
  emitTransitionActivity?: boolean;
  workspacePath?: string;
  stackExpected?: boolean;
}

interface DockerPsJson {
  ID?: string;
  Names?: string;
  Name?: string;
  Status?: string;
  State?: string;
  CreatedAt?: string;
  Labels?: string;
}

/** Extract `com.docker.compose.project` from docker ps's comma-joined Labels. */
function parseComposeProjectLabel(labels: string | undefined): string | undefined {
  if (!labels) return undefined;
  return /(?:^|,)com\.docker\.compose\.project=([^,]+)/.exec(labels)?.[1];
}

const lastHealthByIssue = new Map<string, boolean>();

function normalizeIssue(issueId: string): string {
  // PAN-1872: tolerate an undefined issueId defensively so callers that forward
  // an optional value do not crash with `Cannot read properties of undefined
  // (reading 'toLowerCase')`.
  if (!issueId) return '';
  return parseIssueIdSync(issueId)?.normalized ?? issueId.toLowerCase();
}

function resolveStackProject(issueId: string): WorkspaceStackProject | null {
  const resolved = resolveProjectFromIssueSync(issueId);
  return resolved ? getProjectSync(resolved.projectKey) : null;
}

function hasDockerWorkspace(projectConfig: WorkspaceStackProject | null | undefined): boolean {
  return Boolean(projectConfig?.workspace?.docker?.compose_template);
}

export function defaultWorkspacePath(issueId: string, projectConfig: WorkspaceStackProject | null | undefined): string | null {
  if (!projectConfig?.path) return null;
  return join(
    projectConfig.path,
    projectConfig.workspace?.workspaces_dir ?? 'workspaces',
    `feature-${normalizeIssue(issueId)}`,
  );
}

function isWorkspaceStackExpected(
  issueId: string,
  projectConfig: WorkspaceStackProject | null | undefined,
  workspacePath?: string,
): boolean {
  const resolvedWorkspacePath = workspacePath ?? defaultWorkspacePath(issueId, projectConfig);
  if (!resolvedWorkspacePath) return true;
  return existsSync(join(resolvedWorkspacePath, '.devcontainer'));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasNameToken(name: string, token: string): boolean {
  return new RegExp(`(^|[-_])${escapeRegExp(token)}($|[-_])`).test(name);
}

export function inferIssueIdFromStackContainerName(name: string): string | null {
  const lower = name.toLowerCase();
  const standard = lower.match(/(?:^|[-_])feature-([a-z]+-\d+)(?=$|[-_])/) ?? lower.match(/(?:^|[-_])([a-z]+-\d+)(?=$|[-_])/);
  if (standard?.[1]) return standard[1].toUpperCase();

  const rally = lower.match(/(?:^|[-_])feature-((?:f|us|de|ta|tc)\d+)(?=$|[-_])/) ?? lower.match(/(?:^|[-_])((?:f|us|de|ta|tc)\d+)(?=$|[-_])/);
  return rally?.[1]?.toUpperCase() ?? null;
}

function isStackContainer(container: DockerContainerLifecycle, issueId: string, composeProjectName?: string | null): boolean {
  // When the workspace's canonical compose project is known AND the container
  // carries a compose-project label, the label decides. This keeps stale
  // containers from a previous project naming (e.g. overdeck-feature-min-865-*
  // corpses next to a live myn-feature-min-865 stack) from poisoning health.
  if (composeProjectName && container.composeProject) {
    return container.composeProject === composeProjectName;
  }
  return hasIssueToken(container.name, issueId);
}

/** Name-token match: does this container name belong to the issue's stack? */
export function hasIssueToken(containerName: string, issueId: string): boolean {
  const normalized = normalizeIssue(issueId);
  const name = containerName.toLowerCase();
  return hasNameToken(name, `feature-${normalized}`) || hasNameToken(name, normalized);
}


function isSuccessfulOneShotContainer(name: string): boolean {
  return /(^|[-_])(?:init|test-unit)($|[-_])/.test(name.toLowerCase());
}

function parseExitCode(status: string): number | null {
  const match = status.match(/exited \((\d+)\)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function isCreated(container: DockerContainerLifecycle): boolean {
  return container.state?.toLowerCase() === 'created' || /^created\b/i.test(container.status);
}

function isExited(container: DockerContainerLifecycle): boolean {
  return container.state?.toLowerCase() === 'exited' || /^exited\b/i.test(container.status);
}

function createdAgeMs(container: DockerContainerLifecycle, now: Date): number | null {
  if (!container.createdAt) return null;
  const created = new Date(container.createdAt).getTime();
  if (Number.isNaN(created)) return null;
  return now.getTime() - created;
}

export function evaluateWorkspaceStackHealth(
  issueId: string,
  projectConfig: WorkspaceStackProject | null | undefined,
  containers: DockerContainerLifecycle[],
  options: { now?: Date; stuckCreatedThresholdMs?: number; stackExpected?: boolean; composeProjectName?: string | null } = {},
): WorkspaceStackHealth {
  const now = options.now ?? new Date();
  const lastObserved = now.toISOString();
  if (!hasDockerWorkspace(projectConfig)) {
    return { healthy: true, reasons: [], lastObserved };
  }

  const thresholdMs = options.stuckCreatedThresholdMs ?? DEFAULT_STUCK_CREATED_THRESHOLD_MS;
  const stackContainers = containers.filter((container) => isStackContainer(container, issueId, options.composeProjectName));
  const stackExpected = options.stackExpected !== false;
  const reasons: string[] = [];

  if (stackContainers.length === 0 && stackExpected) {
    reasons.push(`No Docker containers found for workspace stack ${normalizeIssue(issueId)}`);
  }

  for (const container of stackContainers) {
    const exitCode = parseExitCode(container.status);
    if (isExited(container)) {
      if (isSuccessfulOneShotContainer(container.name)) {
        if (exitCode !== null && exitCode !== 0) {
          reasons.push(`${container.name} init exited non-zero (${exitCode})`);
        }
      } else {
        const exit = exitCode === null ? 'unknown' : String(exitCode);
        reasons.push(`${container.name} service exited (${exit})`);
      }
      continue;
    }

    if (isCreated(container)) {
      const ageMs = createdAgeMs(container, now);
      if (ageMs === null || ageMs >= thresholdMs) {
        const age = ageMs === null ? 'unknown age' : `${Math.floor(ageMs / 1000)}s`;
        reasons.push(`${container.name} stuck Created for ${age}`);
      }
    }
  }

  return { healthy: reasons.length === 0, reasons, lastObserved, stackExpected };
}

export const collectDockerContainerLifecycleSnapshot = (): Effect.Effect<DockerContainerLifecycle[]> =>
  Effect.tryPromise({
    try: () =>
      execFileAsync('docker', ['ps', '-a', '--format', '{{json .}}'], {
        encoding: 'utf-8',
        timeout: 5_000,
      }),
    catch: (err) => err,
  }).pipe(
    Effect.map(({ stdout }) => {
      const containers: DockerContainerLifecycle[] = [];
      for (const line of stdout.trim().split('\n')) {
        if (!line.trim()) continue;
        try {
          const raw = JSON.parse(line) as DockerPsJson;
          const name = raw.Names ?? raw.Name;
          if (!raw.ID || !name) continue;
          containers.push({
            id: raw.ID,
            name,
            status: raw.Status ?? '',
            state: raw.State,
            createdAt: raw.CreatedAt,
            composeProject: parseComposeProjectLabel(raw.Labels),
          });
        } catch {
          // Ignore malformed docker rows.
        }
      }
      return containers;
    }),
    Effect.orElseSucceed(() => [] as DockerContainerLifecycle[]),
  );

export const getWorkspaceStackHealth = (
  issueId: string,
  options: WorkspaceStackHealthOptions = {},
): Effect.Effect<WorkspaceStackHealth> =>
  Effect.gen(function* () {
    const projectConfig = options.projectConfig ?? resolveStackProject(issueId);
    if (!hasDockerWorkspace(projectConfig)) {
      return { healthy: true, reasons: [], lastObserved: (options.now ?? new Date()).toISOString() };
    }

    let observedAt: string | null = null;
    let containers = options.containers;

    if (!containers) {
      observedAt = getCachedDockerContainerLifecycleObservedAt();
      containers = observedAt ? getCachedDockerContainerLifecycleSnapshot() : undefined;
    }

    if (!containers) {
      const observed = options.now ?? new Date();
      containers = yield* collectDockerContainerLifecycleSnapshot();
      observedAt = observed.toISOString();
      recordDockerContainerLifecycleSnapshot(containers, observedAt);
    }

    const workspacePath = options.workspacePath ?? defaultWorkspacePath(issueId, projectConfig);
    const health = evaluateWorkspaceStackHealth(issueId, projectConfig, containers, {
      now: options.now,
      stuckCreatedThresholdMs: options.stuckCreatedThresholdMs,
      stackExpected: options.stackExpected ?? isWorkspaceStackExpected(issueId, projectConfig, options.workspacePath),
      composeProjectName: tryComposeProjectNameForWorkspace(workspacePath, issueId),
    });
    const observedHealth = observedAt && !options.now
      ? { ...health, lastObserved: observedAt }
      : health;

    if (options.emitTransitionActivity) {
      recordWorkspaceStackHealthTransition(issueId, observedHealth);
    }

    return observedHealth;
  });

export function recordWorkspaceStackHealthTransition(issueId: string, health: WorkspaceStackHealth): boolean {
  const key = normalizeIssue(issueId);
  const previous = lastHealthByIssue.get(key);
  lastHealthByIssue.set(key, health.healthy);

  if (previous !== true || health.healthy) return false;

  emitActivityEntrySync({
    source: 'cloister',
    level: 'error',
    issueId: issueId.toUpperCase(),
    message: `workspace-stack-unhealthy: ${issueId.toUpperCase()}`,
    details: health.reasons.join('; '),
  });
  return true;
}

export function resetWorkspaceStackHealthTransitionsForTests(): void {
  lastHealthByIssue.clear();
}
