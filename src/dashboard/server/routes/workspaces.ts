import { jsonResponse } from "../http-helpers.js";
import { httpHandler } from './http-handler.js';
import { buildChildEnvWithoutTmuxSync } from '../../../lib/child-env.js';
/**
 * Workspaces route module — Effect HttpRouter.Layer (PAN-428 B8)
 *
 * Workspaces + lifecycle + review HTTP routes.
 *
 * Workspace data endpoints (/api/workspaces/):
 *   GET    /api/workspace-stack-health
 *   GET    /api/workspaces/:issueId
 *   POST   /api/workspaces
 *   GET    /api/workspaces/:issueId/plan
 *   GET    /api/workspaces/:issueId/uat-context
 *   PATCH  /api/workspaces/:issueId/plan/inspection-policy
 *   GET    /api/workspaces/:issueId/clean/preview
 *   POST   /api/workspaces/:issueId/clean
 *   POST   /api/workspaces/:issueId/containerize
 *   POST   /api/workspaces/:issueId/containers/:containerName/:action
 *   POST   /api/workspaces/:issueId/memory-summary
 *   POST   /api/workspaces/:issueId/refresh-db
 *   GET    /api/workspaces/:issueId/stashes
 *   POST   /api/workspaces/:issueId/stashes/:stashRef/recover
 *   DELETE /api/workspaces/:issueId/stashes/:stashRef
 *   GET    /api/workspaces/:issueId/tldr
 *
 * Lifecycle endpoints (/api/issues/):
 *   POST   /api/issues/:issueId/start
 *   POST   /api/issues/:issueId/sync-main
 *   POST   /api/issues/:issueId/approve
 *   POST   /api/issues/:issueId/merge
 *
 * Review endpoints (/api/review/):
 *   GET    /api/review/:issueId/status
 *   POST   /api/review/:issueId/status
 *   POST   /api/review/:issueId/trigger
 *   POST   /api/review/:issueId/request
 *   POST   /api/review/:issueId/reset
 *   DELETE /api/review/:issueId/pending
 *
 * Stuck-state endpoints (/api/workspaces/):
 *   POST   /api/workspaces/:issueId/unstick
 */

import { exec, execFile, spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { existsSync } from 'node:fs';
import { access, chmod, mkdir, readdir, readFile, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { crc32 } from 'node:zlib';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import {
  resolveProjectFromIssueSync,
  getProjectSync,
  listProjectsSync,
  findProjectByTeamSync,
  extractTeamPrefix,
} from '../../../lib/projects.js';
import { resolveGitHubIssueSync as resolveGitHubIssueShared } from '../../../lib/tracker-utils.js';
import { getGitHubConfig } from '../services/tracker-config.js';
import { EventStoreService } from '../services/domain-services.js';
import {
  enqueuePendingFeedbackDelivery,
  markPendingFeedbackDelivered,
} from '../pending-feedback.js';
import {
  getReviewStatusSync,
  setReviewStatusSync as setReviewStatusBase,
  markWorkspaceStuck,
  setDeaconIgnored,
  setAutoMerge,
  type ReviewStatus,
} from '../../../lib/review-status.js';
import {
  getCachedConflictGateMergeability,
} from '../../../lib/cloister/conflict-gate.js';
import { restoreTrackedBeadsExport } from '../../../lib/beads-restore.js';
import {
  computeQueuePositionFromStatusSync,
  findPositionInQueueSync,
} from '../../../lib/queue-position.js';
import {
  messageAgent,
  saveAgentRuntimeState,
  getAgentRuntimeStateSync,
  transitionIssueToInReview,
  getAgentStateSync,
  spawnRun,
} from '../../../lib/agents.js';
import { getActiveSessionModelSync } from '../../../lib/cost-parsers/jsonl-parser.js';
import { getCostsForIssueSync } from '../../../lib/costs/index.js';
import { resolveIssueHeadlineCost } from '../services/issue-cost-resolver.js';
import { getCachedRunningAgents } from '../services/running-agents-cache.js';
import { readPlan, isPlanningComplete } from '../../../lib/vbrief/io.js';
import { VBRIEF_INSPECTION_POLICIES } from '../../../lib/vbrief/types.js';
import type { VBriefDocument, VBriefInspectionPolicy } from '../../../lib/vbrief/types.js';
import { findVBriefByIssue, readVBriefDocument } from '../../../lib/vbrief/vbrief-index.js';
import { criticalPath, actionableDoc } from '../../../lib/vbrief/dag.js';
import { getChangedFiles, getDiffBase, getDiffStat, type ChangedFile } from '../../../lib/cloister/review-context.js';
import { capturePane, listSessionNames, sessionExists } from '../../../lib/tmux.js';
import { syncBeadStatusToVBrief } from '../../../lib/vbrief/beads.js';
import { getUnblockedItemsSync } from '../../../lib/cloister/task-readiness.js';
import { runVerificationForIssue } from '../../../lib/cloister/verification-runner.js';
import { getTldrDaemonServiceSync } from '../../../lib/tldr-daemon.js';
import { loadWorkspaceMetadataSync, listWorkspaceMetadataSync } from '../../../lib/remote/workspace-metadata.js';
import { loadConfigSync } from '../../../lib/config.js';
import { extractPrefixSync, parseIssueIdSync } from '../../../lib/issue-id.js';
import { getContainersReferencingWorkspacePath } from '../../../lib/workspace-manager.js';
import { DEVCONTAINER_DIRNAME } from '../../../lib/workspace/devcontainer-renderer.js';
import { collectDockerContainerLifecycleSnapshot, getWorkspaceStackHealth } from '../../../lib/workspace/stack-health.js';
import { emitActivityEntrySync } from '../../../lib/activity-logger.js';
import { enrichReviewStatusFromSessions } from '../../../lib/review-status-enrichment.js';
import { createRecoveryBranchFromStash, dropStash, isSalvageableStash, listStashes } from '../../../lib/stashes.js';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME } from '../../../lib/pan-dir/types.js';
import { getWorkspacePathForIssue } from '../workspace-paths.js';
import { containerOpsRouteLayer } from './workspaces/container-ops.js';
import { workspaceDataRouteLayer } from './workspaces/workspace-data.js';
import { stashCleanRouteLayer } from './workspaces/stash-clean.js';
import { reviewPipelineRouteLayer } from './workspaces/review-pipeline.js';
import { reviewControlRouteLayer } from './workspaces/review-control.js';
import { mergeOpsRouteLayer } from './workspaces/merge-ops.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const MAX_PROBED_PORTS = 5;
const MAX_PROBED_CONTAINERS = 10;
const PROBE_CACHE_TTL_MS = 30_000;
const PROBE_CACHE_MAX_ENTRIES = MAX_PROBED_CONTAINERS * MAX_PROBED_PORTS * 20;

function safeToISOString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

interface ProbeCacheEntry {
  result: { healthy: boolean; reason?: string };
  cachedAt: number;
}

const probeCache = new Map<string, ProbeCacheEntry>();

function pruneProbeCache(
  now = Date.now(),
  runningNames?: Set<string>,
  shouldPruneContainer?: (containerName: string) => boolean,
): void {
  for (const [key, entry] of probeCache) {
    const containerName = key.split('::', 1)[0] ?? '';
    const expired = now - entry.cachedAt > PROBE_CACHE_TTL_MS;
    const absent = runningNames && shouldPruneContainer?.(containerName) === true && !runningNames.has(containerName);
    if (expired || absent) {
      probeCache.delete(key);
    }
  }

  while (probeCache.size > PROBE_CACHE_MAX_ENTRIES) {
    const oldestKey = probeCache.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    probeCache.delete(oldestKey);
  }
}

function getCachedProbe(key: string): { healthy: boolean; reason?: string } | undefined {
  const entry = probeCache.get(key);
  if (!entry) return undefined;
  const now = Date.now();
  if (now - entry.cachedAt > PROBE_CACHE_TTL_MS) {
    probeCache.delete(key);
    return undefined;
  }
  probeCache.delete(key);
  probeCache.set(key, entry);
  return entry.result;
}

function setCachedProbe(key: string, result: { healthy: boolean; reason?: string }): void {
  const now = Date.now();
  pruneProbeCache(now);
  probeCache.set(key, { result, cachedAt: now });
  pruneProbeCache(now);
}

async function readWorkspacePlanningMarkdown(
  issueId: string,
  fileName: 'INFERENCE.md',
): Promise<{ issueId: string; body: string }> {
  const parsed = parseIssueIdSync(issueId);
  const issuePrefix = parsed?.prefix ?? extractPrefixSync(issueId) ?? issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const { parsedIssueId, workspacePath } = getWorkspacePathForIssue(projectPath, issueId);

  const content = await readFile(join(workspacePath, PAN_DIRNAME, fileName), 'utf-8');
  return {
    issueId: parsedIssueId,
    body: content,
  };
}

/**
 * Read per-issue record continue view and return it as normalized JSON text,
 * or null when the record does not exist.
 */
async function readWorkspaceContinueFile(
  _projectPath: string,
  workspacePath: string,
  issueId: string,
): Promise<string | null> {
  try {
    const { readRecordContinueViewSync, getProjectConfigFromWorkspacePath, resolveProjectForIssue } =
      await import('../../../lib/pan-dir/record.js');
    const project = resolveProjectForIssue(issueId) ?? getProjectConfigFromWorkspacePath(workspacePath);
    const recordView = readRecordContinueViewSync(project, issueId);
    return recordView ? JSON.stringify(recordView, null, 2) : null;
  } catch {
    return null;
  }
}

async function deliverQueuedFeedback(
  issueId: string,
  kind: 'review-blocked' | 'review-failed' | 'test-failed',
  filePath: string,
  message: string,
): Promise<void> {
  const agentId = `agent-${issueId.toLowerCase()}`;
  await enqueuePendingFeedbackDelivery({
    issueId,
    agentId,
    kind,
    filePath,
    message,
    createdAt: new Date().toISOString(),
  });
  await messageAgent(agentId, message);
  await markPendingFeedbackDelivered(issueId, kind);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.API_PORT || process.env.PORT || '3011', 10);

// ─── Activity log (in-memory, shared with server startup) ─────────────────────

interface ActivityEntry {
  id: string;
  timestamp: string;
  command: string;
  status: 'running' | 'completed' | 'failed';
  output: string[];
}

const activityLog: ActivityEntry[] = [];

export function logActivity(entry: ActivityEntry): void {
  activityLog.unshift(entry);
  if (activityLog.length > 100) activityLog.pop();
}

export function updateActivity(id: string, updates: Partial<ActivityEntry>): void {
  const entry = activityLog.find(e => e.id === id);
  if (entry) Object.assign(entry, updates);
}

export function appendActivityOutput(id: string, line: string): void {
  const entry = activityLog.find(e => e.id === id);
  if (entry) {
    entry.output.push(line);
    if (entry.output.length > 500) entry.output.shift();
  }
}

// ─── Pending operations (in-memory) ──────────────────────────────────────────

interface PendingOperation {
  type: 'review' | 'merge' | 'approve' | 'start' | 'clean' | 'containerize' | 'refresh-db' | 'rebuild-stack';
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  error?: string;
}

const pendingOperations = new Map<string, PendingOperation>();

export function setPendingOperation(issueId: string, type: PendingOperation['type']): void {
  pendingOperations.set(issueId.toLowerCase(), {
    type,
    status: 'running',
    startedAt: new Date().toISOString(),
  });
}

export function completePendingOperation(issueId: string, error?: string | null): void {
  const op = pendingOperations.get(issueId.toLowerCase());
  if (op) {
    op.status = error ? 'failed' : 'completed';
    if (error) op.error = error;
  }
}

export function getPendingOperation(issueId: string): PendingOperation | null {
  return pendingOperations.get(issueId.toLowerCase()) ?? null;
}

export function clearPendingOperation(issueId: string): void {
  pendingOperations.delete(issueId.toLowerCase());
}

// ─── Local helpers ────────────────────────────────────────────────────────────

export function getProjectPath(linearProjectId?: string, issuePrefix?: string): string {
  if (issuePrefix) {
    const issueId = `${issuePrefix}-1`;
    const resolved = resolveProjectFromIssueSync(issueId);
    if (resolved) return resolved.projectPath;

    const config = getGitHubConfig();
    if (config) {
      for (const { owner, repo, prefix } of config.repos) {
        const repoPrefix = prefix || repo.toUpperCase().replace(/-CLI$/, '').replace(/-/g, '');
        if (repoPrefix.toUpperCase() === issuePrefix.toUpperCase()) {
          const possiblePaths = [
            join(homedir(), 'Projects', repo),
            join(homedir(), 'Projects', repo.replace(/-cli$/, '')),
            join(homedir(), 'Projects', owner, repo),
          ];
          for (const path of possiblePaths) {
            if (existsSync(path)) return path;
          }
        }
      }
    }
  }
  return join(homedir(), 'Projects');
}

export function requireTrustedMutationOrigin(request: HttpServerRequest.HttpServerRequest): HttpServerResponse.HttpServerResponse | null {
  const origin = (() => {
    const value = (request.headers as Record<string, string | string[] | undefined>)['origin'];
    return Array.isArray(value) ? value[0] : value;
  })();
  const referer = (() => {
    const value = (request.headers as Record<string, string | string[] | undefined>)['referer'];
    return Array.isArray(value) ? value[0] : value;
  })();

  const port = parseInt(process.env['API_PORT'] ?? process.env['PORT'] ?? '3011', 10);
  const dashboardUrl = process.env['DASHBOARD_URL'] ?? `http://localhost:${port}`;
  const trustedOrigins = new Set<string>([dashboardUrl]);
  // Always trust direct localhost access — the dashboard may be reached via
  // reverse proxy (e.g. https://pan.localhost) OR directly (http://localhost:3011).
  trustedOrigins.add(`http://localhost:${port}`);
  trustedOrigins.add(`http://127.0.0.1:${port}`);
  if (process.env['NODE_ENV'] === 'development') {
    trustedOrigins.add('http://localhost:3000');
    trustedOrigins.add('http://127.0.0.1:3000');
  }

  const normalize = (value?: string): string | null => {
    if (!value) return null;
    try {
      const url = new URL(value);
      return `${url.protocol}//${url.host}`;
    } catch {
      return null;
    }
  };

  const normalizedOrigin = normalize(origin);
  if (normalizedOrigin) {
    return trustedOrigins.has(normalizedOrigin)
      ? null
      : jsonResponse({ error: 'Invalid origin' }, { status: 403 });
  }

  const normalizedReferer = normalize(referer);
  if (normalizedReferer) {
    return trustedOrigins.has(normalizedReferer)
      ? null
      : jsonResponse({ error: 'Invalid referer' }, { status: 403 });
  }

  return jsonResponse({ error: 'Missing origin' }, { status: 403 });
}

export interface WorkspaceInfo {
  exists: boolean;
  isRemote: boolean;
  vmName?: string;
  remotePath?: string;
  localPath?: string;
  agentId?: string;
}

export function getWorkspaceInfoForIssue(issueId: string): WorkspaceInfo {
  try {
    const meta = loadWorkspaceMetadataSync(issueId);
    if (meta?.location === 'remote' && meta.vmName) {
      const metaRecord = meta as unknown as Record<string, unknown>;
      return {
        exists: true,
        isRemote: true,
        vmName: meta.vmName,
        remotePath: typeof metaRecord['remotePath'] === 'string' ? metaRecord['remotePath'] : undefined,
        agentId: typeof metaRecord['agentId'] === 'string' ? metaRecord['agentId'] : undefined,
      };
    }
  } catch { /* non-fatal */ }

  const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
  const issueLower = issueId.toLowerCase();
  const numericSuffix = issueLower.replace(/^[a-z]+-/, '');

  for (const { config } of listProjectsSync()) {
    if (!config.path) continue;
    for (const candidate of [`feature-${issueLower}`, `feature-${numericSuffix}`]) {
      const p = join(config.path, 'workspaces', candidate);
      if (existsSync(p)) return { exists: true, isRemote: false, localPath: p };
    }
  }

  const projectPath = getProjectPath(undefined, issuePrefix);
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
  if (existsSync(workspacePath)) return { exists: true, isRemote: false, localPath: workspacePath };

  return { exists: false, isRemote: false };
}

function isGitHubIssue(issueId: string): {
  isGitHub: boolean;
  owner?: string;
  repo?: string;
  number?: number;
} {
  const resolved = resolveGitHubIssueShared(issueId);
  if (resolved.isGitHub) {
    return { isGitHub: true, owner: resolved.owner, repo: resolved.repo, number: resolved.number };
  }
  return { isGitHub: false };
}

function attachPanOutputStreams(
  child: { stdout?: NodeJS.ReadableStream | null; stderr?: NodeJS.ReadableStream | null },
  activityId: string,
): void {
  child.stdout?.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach((line: string) => {
      appendActivityOutput(activityId, line);
    });
  });
  child.stderr?.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach((line: string) => {
      appendActivityOutput(activityId, `[stderr] ${line}`);
    });
  });
}

interface ChainPanOnSuccess {
  args: string[];
  /** Activity message emitted when the first command succeeds and the chained
   * command begins (e.g. "Stack rebuilt — starting agent"). */
  phaseLabel: string;
}

export function spawnPanCommand(
  args: string[],
  description: string,
  cwd?: string,
  options?: {
    issueId?: string;
    pendingOperation?: PendingOperation['type'];
    /** When set, this second `pan` invocation runs only if the first exits 0,
     * streaming into the same activity. Used by the rebuild-and-start route to
     * chain `pan start` after a successful `pan workspace rebuild`. */
    chainOnSuccess?: ChainPanOnSuccess;
  },
): string {
  const activityId = Date.now().toString();
  const issueId = options?.issueId;
  const pendingOp = options?.pendingOperation;
  const chain = options?.chainOnSuccess;
  const commandLine = chain ? `pan ${args.join(' ')} && pan ${chain.args.join(' ')}` : `pan ${args.join(' ')}`;

  if (issueId && pendingOp) {
    setPendingOperation(issueId, pendingOp);
    emitActivityEntrySync({
      source: 'dashboard',
      level: 'info',
      issueId: issueId.toUpperCase(),
      message: `${description} started`,
    });
  }
  logActivity({
    id: activityId,
    timestamp: new Date().toISOString(),
    command: commandLine,
    status: 'running',
    output: [],
  });

  const finalize = (code: number | null, failedCommand: string) => {
    updateActivity(activityId, { status: code === 0 ? 'completed' : 'failed' });
    if (issueId && pendingOp) {
      completePendingOperation(issueId, code === 0 ? null : `${failedCommand} exited ${code ?? 'unknown'}`);
      emitActivityEntrySync({
        source: 'dashboard',
        level: code === 0 ? 'success' : 'error',
        issueId: issueId.toUpperCase(),
        message: `${description} ${code === 0 ? 'completed' : 'failed'}`,
      });
    }
  };

  const child = spawn('pan', args, {
    cwd: cwd || process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  attachPanOutputStreams(child, activityId);

  child.on('close', (code) => {
    if (code === 0 && chain) {
      if (issueId) {
        emitActivityEntrySync({
          source: 'dashboard',
          level: 'info',
          issueId: issueId.toUpperCase(),
          message: chain.phaseLabel,
        });
      }
      appendActivityOutput(activityId, `--- ${chain.phaseLabel} ---`);
      const next = spawn('pan', chain.args, {
        cwd: cwd || process.cwd(),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      attachPanOutputStreams(next, activityId);
      next.on('close', (nextCode) => finalize(nextCode, `pan ${chain.args.join(' ')}`));
    } else {
      finalize(code, `pan ${args.join(' ')}`);
    }
  });

  return activityId;
}

export interface WorkspaceContainerStatus {
  running: boolean;
  uptime: string | null;
  status?: string;
  health?: 'healthy' | 'unhealthy' | 'starting' | 'unknown';
  ports?: number[];
  lastProbeAt?: string;
  lastFailureReason?: string;
}

export async function getContainerStatusAsync(
  issueId: string,
  projectPath?: string
): Promise<Record<string, WorkspaceContainerStatus>> {
  const result: Record<string, WorkspaceContainerStatus> = {};
  try {
    const { stdout } = await execFileAsync('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Status}}'], { encoding: 'utf-8' });
    const search = issueId.toLowerCase();
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      if (!line.toLowerCase().includes(search)) continue;
      const [name, ...statusParts] = line.split('\t');
      const statusStr = statusParts.join('\t');
      const running = statusStr.toLowerCase().startsWith('up');
      const uptimeMatch = statusStr.match(/Up (.+)/);
      result[name] = {
        running,
        uptime: running ? (uptimeMatch ? uptimeMatch[1] : null) : null,
        status: statusStr,
      };
    }

    // Batch docker inspect for all running containers to avoid serial O(n) latency
    const runningNames = Object.entries(result)
      .filter(([, info]) => info.running)
      .map(([name]) => name);
    pruneProbeCache(
      Date.now(),
      new Set(runningNames),
      (containerName) => containerName.toLowerCase().includes(search),
    );

    if (runningNames.length > 0) {
      let inspectByName = new Map<string, any>();
      try {
        const { stdout: inspectStdout } = await execFileAsync(
          'docker',
          ['inspect', ...runningNames],
          { encoding: 'utf-8', timeout: 10000 }
        );
        const inspects: Array<{
          Name?: string;
          Config?: { Labels?: Record<string, string>; ExposedPorts?: Record<string, unknown> };
          NetworkSettings?: { Ports?: Record<string, unknown> };
          State?: { Health?: { Status?: string; LastExecution?: { End?: string; ExitCode?: number }; FailingStreak?: number; ExitCode?: number } };
        }> = JSON.parse(inspectStdout);
        inspectByName = new Map(
          inspects
            .map((i): [string | undefined, typeof i] => [i.Name?.replace(/^\//, ''), i])
            .filter((entry): entry is [string, (typeof inspects)[number]] => typeof entry[0] === 'string')
        );
      } catch (err: any) {
        // Docker inspect may return partial JSON on stderr even when one container is missing.
        // Try to salvage valid results from stdout so one missing container doesn't drop all health data.
        const partial = err?.stdout;
        if (typeof partial === 'string' && partial.trim().startsWith('[')) {
          try {
            const inspects = JSON.parse(partial);
            if (Array.isArray(inspects)) {
              inspectByName = new Map(inspects.map((i: any) => [i.Name?.replace(/^\//, ''), i]));
            }
          } catch {
            // Partial JSON unreadable — fall through to empty inspectByName
          }
        }
      }

      // Cap total probed containers to prevent unbounded fan-out per request
      const namesToProbe = runningNames.slice(0, MAX_PROBED_CONTAINERS);

      await Promise.all(
        namesToProbe.map(async (name) => {
          const info = result[name];
          const inspect = inspectByName.get(name);
          const serviceHealth = extractContainerServiceHealth(inspect);
          let health: WorkspaceContainerStatus['health'] = serviceHealth.health;
          let lastFailureReason = serviceHealth.lastFailureReason;
          let lastProbeAt = serviceHealth.lastProbeAt;

          // If docker healthcheck is unknown but we have host-mapped ports, probe them
          if (health === 'unknown' && serviceHealth.bindings.length > 0) {
            // Deduplicate and cap probe targets
            const dedupedBindings = Array.from(
              new Map(
                serviceHealth.bindings.map((b) => [`${b.hostIp}:${b.hostPort}`, b])
              ).values()
            ).slice(0, MAX_PROBED_PORTS);

            const probeResults = await Promise.all(
              dedupedBindings.map(async (b) => {
                const cacheKey = `${name}::${b.hostIp}:${b.hostPort}`;
                const cached = getCachedProbe(cacheKey);
                if (cached) return cached;
                const probeResult = await probeContainerPortAsync(b.hostPort, b.hostIp);
                setCachedProbe(cacheKey, probeResult);
                return probeResult;
              })
            );
            const anyHealthy = probeResults.some((r) => r.healthy);
            health = anyHealthy ? 'healthy' : 'unhealthy';
            lastProbeAt = new Date().toISOString();
            if (!anyHealthy) {
              const firstFailure = probeResults.find((r) => !r.healthy);
              lastFailureReason = firstFailure?.reason ?? 'probe failed';
            }
          }

          result[name] = {
            ...info,
            health,
            ports: serviceHealth.ports,
            lastProbeAt,
            lastFailureReason,
          };
        })
      );
    }
  } catch { /* non-fatal */ }
  return result;
}

interface ContainerPortBinding {
  containerPort: number;
  hostIp: string;
  hostPort: number;
}

interface ContainerServiceHealth {
  health: 'healthy' | 'unhealthy' | 'starting' | 'unknown';
  ports: number[];
  bindings: ContainerPortBinding[];
  lastProbeAt?: string;
  lastFailureReason?: string;
}

function extractContainerServiceHealth(
  inspect?: {
    Config?: { Labels?: Record<string, string>; ExposedPorts?: Record<string, unknown> };
    NetworkSettings?: { Ports?: Record<string, unknown> };
    State?: { Health?: { Status?: string; LastExecution?: { End?: string; ExitCode?: number }; FailingStreak?: number; ExitCode?: number } };
  }
): ContainerServiceHealth {
  if (!inspect) return { health: 'unknown', ports: [], bindings: [] };
  const labels = inspect?.Config?.Labels ?? {};
  const healthState = inspect?.State?.Health;
  const exposedPorts = inspect?.Config?.ExposedPorts ?? {};
  const portBindings = inspect?.NetworkSettings?.Ports ?? {};

  // Parse exposed ports
  const ports = Object.keys(exposedPorts)
    .map((p) => parseInt(p.split('/')[0], 10))
    .filter((n) => !Number.isNaN(n));

  // Parse Traefik loadbalancer port labels
  const traefikPorts: number[] = [];
  for (const [key, value] of Object.entries(labels)) {
    if (key.endsWith('.loadbalancer.server.port') && value) {
      const port = parseInt(value, 10);
      if (!Number.isNaN(port)) traefikPorts.push(port);
    }
  }

  const allPorts = traefikPorts.length > 0 ? traefikPorts : ports;

  // Extract host-mapped ports from NetworkSettings.Ports
  const bindings: ContainerPortBinding[] = [];
  for (const [containerPortProto, hostBindings] of Object.entries(portBindings)) {
    if (!Array.isArray(hostBindings)) continue;
    const containerPort = parseInt(containerPortProto.split('/')[0], 10);
    if (Number.isNaN(containerPort)) continue;
    for (const hb of hostBindings) {
      if (!hb || typeof hb !== 'object') continue;
      const hostPort = parseInt((hb as any).HostPort, 10);
      if (Number.isNaN(hostPort) || hostPort < 1 || hostPort > 65535) continue;
      bindings.push({
        containerPort,
        hostIp: String((hb as any).HostIp || '127.0.0.1'),
        hostPort,
      });
    }
  }

  // If container has a Docker healthcheck, use its state
  if (healthState?.Status) {
    const status = String(healthState.Status).toLowerCase();
    const health: ContainerServiceHealth['health'] =
      status === 'healthy' ? 'healthy' :
      status === 'unhealthy' ? 'unhealthy' :
      status === 'starting' ? 'starting' : 'unknown';
    const lastProbeAt = safeToISOString(healthState?.LastExecution?.End);
    const exitCode = healthState?.LastExecution?.ExitCode;
    const failingStreak = healthState?.FailingStreak;
    const lastFailureReason = failingStreak && failingStreak > 0
      ? (typeof exitCode === 'number' && exitCode !== 0 ? `exit code ${exitCode}` : 'healthcheck failed')
      : undefined;
    return {
      health,
      ports: allPorts,
      bindings,
      lastProbeAt,
      lastFailureReason,
    };
  }

  return {
    health: 'unknown',
    ports: allPorts,
    bindings,
  };
}

async function probeContainerPortAsync(hostPort: number, hostIp = '127.0.0.1'): Promise<{ healthy: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const socket = createConnection(hostPort, hostIp);
    socket.setTimeout(5000);

    socket.on('connect', () => {
      socket.end();
      resolve({ healthy: true });
    });

    socket.on('error', (err) => {
      resolve({ healthy: false, reason: err.message.slice(0, 200) });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ healthy: false, reason: 'connection timeout' });
    });
  });
}

function getFlyAppName(vmName: string): string {
  // Resolve via workspace metadata — deriving from the vmName prefix is wrong
  // ('pan-pan-1712-ws' → 'pan-pan'). Fall back to the configured app.
  try {
    const meta = listWorkspaceMetadataSync().find((m) => m.vmName === vmName);
    if (meta?.appName) return meta.appName;
  } catch { /* fall through */ }
  try {
    return loadConfigSync().remote?.fly?.app ?? 'pan-workspaces';
  } catch {
    return 'pan-workspaces';
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function flyExecCmd(vmName: string, command: string): string {
  const appName = getFlyAppName(vmName);
  return `fly ssh console -a ${appName} -C "${command.replace(/"/g, '\\"')}"`;
}

export async function repairFlywayIfNeeded(
  issueId: string,
  pgContainer: string,
  dbName: string,
  projectConfig: any,
  workspacePath: string,
  log?: (msg: string) => void
): Promise<{ repaired: boolean; message: string }> {
  const emit = log || ((msg: string) => console.log(`[flyway-repair] ${msg}`));

  try {
    await execAsync(`docker exec "${pgContainer}" pg_isready -U postgres`, {
      encoding: 'utf-8',
      timeout: 5000,
    });
  } catch {
    return { repaired: false, message: 'Postgres container not ready, skipping Flyway check' };
  }

  let rowCount = 0;
  try {
    const { stdout } = await execAsync(
      `docker exec "${pgContainer}" psql -U postgres -d ${dbName} -t -A -c "SELECT count(*) FROM flyway_schema_history;"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    rowCount = parseInt(stdout.trim(), 10) || 0;
  } catch {
    rowCount = 0;
  }

  if (rowCount >= 10) {
    return { repaired: false, message: `Flyway schema_history has ${rowCount} entries, no repair needed` };
  }

  emit(`Flyway schema_history has only ${rowCount} entries — repairing`);

  const seedRelPath = projectConfig.workspace?.database?.seed_file;
  if (!seedRelPath) {
    return { repaired: false, message: 'No seed_file configured, cannot locate Flyway baseline' };
  }

  const seedFile = join(projectConfig.path, seedRelPath);
  const flywayFile = join(dirname(seedFile), 'zzz-flyway-workspace-baseline.sql');
  if (!existsSync(flywayFile)) {
    return { repaired: false, message: `Flyway baseline not found: ${flywayFile}` };
  }

  emit(`Loading Flyway baseline from ${flywayFile}`);
  await execAsync(
    `docker exec -i "${pgContainer}" psql -U postgres -d ${dbName} < "${flywayFile}"`,
    { encoding: 'utf-8', timeout: 60000 }
  );

  const migrationsRelPath = projectConfig.workspace?.database?.migrations?.path;
  if (migrationsRelPath) {
    const migrationsDir = join(workspacePath, migrationsRelPath);
    if (existsSync(migrationsDir)) {
      emit(`Syncing Flyway checksums from workspace migrations`);
      const migrationFiles = (await readdir(migrationsDir)).filter(f => /^V\d+__.*\.sql$/.test(f));
      const updates: string[] = [];

      for (const file of migrationFiles) {
        const version = file.match(/^V(\d+)__/)?.[1];
        if (!version) continue;
        let content = await readFile(join(migrationsDir, file));
        if (content[0] === 0xEF && content[1] === 0xBB && content[2] === 0xBF) {
          content = content.slice(3);
        }
        const lines = content.toString('utf-8').split(/\r?\n/);
        const checksum = crc32(Buffer.from(lines.join(''), 'utf-8')) | 0;
        updates.push(
          `UPDATE flyway_schema_history SET checksum = ${checksum} WHERE version = '${version}' AND checksum IS NOT NULL;`
        );
      }

      if (updates.length > 0) {
        const tmpSql = `/tmp/flyway-checksum-sync-${Date.now()}.sql`;
        await writeFile(tmpSql, updates.join('\n'));
        try {
          const { stdout } = await execAsync(
            `docker exec -i "${pgContainer}" psql -U postgres -d ${dbName} < "${tmpSql}"`,
            { encoding: 'utf-8', timeout: 30000 }
          );
          const updatedCount = (stdout.match(/UPDATE \d+/g) || [])
            .reduce((sum, m) => sum + parseInt(m.replace('UPDATE ', ''), 10), 0);
          emit(`Synced ${migrationFiles.length} migration checksums (${updatedCount} rows updated)`);
        } finally {
          try { await unlink(tmpSql); } catch {}
        }
      }
    }
  }

  try {
    const { stdout } = await execAsync(
      `docker exec "${pgContainer}" psql -U postgres -d ${dbName} -t -A -c "SELECT count(*) FROM flyway_schema_history;"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const newCount = parseInt(stdout.trim(), 10) || 0;
    emit(`Repair complete: flyway_schema_history now has ${newCount} entries (was ${rowCount})`);
    return { repaired: true, message: `Repaired Flyway schema_history: ${rowCount} → ${newCount} entries` };
  } catch (err: any) {
    return { repaired: false, message: `Repair may have failed: ${err.message}` };
  }
}

// setReviewStatus wrapper (mirrors the index.ts version; side-effects are
// intentionally omitted here — the server-side side-effects (auto-PR, auto-merge)
// live in the Express server until full migration is complete).
export function setReviewStatus(issueId: string, update: Partial<ReviewStatus>): ReviewStatus {
  return setReviewStatusBase(issueId, update);
}

// ─── Read JSON body helper ────────────────────────────────────────────────────

export const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
});

// ─── Route: POST /api/workspaces/:issueId/rebuild-stack ───────────────────────
// Bring a workspace's Docker stack back up (e.g. so the "UAT" action on the
// Awaiting-Merge page works when the stack is down). Fire-and-forget like the
// create route: spawns `pan workspace rebuild`, returns an activityId so the
// dashboard streams progress.
const postWorkspaceRebuildRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/rebuild-stack',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: 'Invalid issue ID' }, { status: 400 });
    }
    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const activityId = spawnPanCommand(
      ['workspace', 'rebuild', issueId],
      `Rebuild stack for ${issueId}`,
      projectPath,
      { issueId, pendingOperation: 'rebuild-stack' },
    );
    return jsonResponse({
      success: true,
      message: `Rebuilding stack for ${issueId}`,
      activityId,
    });
  }))
);

// ─── Route: POST /api/workspaces/:issueId/rebuild-and-start ──────────────────
// Recovery action for the `stack-unhealthy` work-agent spawn block: rebuild the
// workspace's Docker stack, then spawn the work agent once the stack is healthy.
// Fire-and-forget like the rebuild-stack route, but chains `pan start` after a
// successful `pan workspace rebuild` under a single activityId so the dashboard
// streams both phases as one operation.
const postWorkspaceRebuildAndStartRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/rebuild-and-start',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: 'Invalid issue ID' }, { status: 400 });
    }
    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const activityId = spawnPanCommand(
      ['workspace', 'rebuild', issueId],
      `Rebuild & start for ${issueId}`,
      projectPath,
      {
        issueId,
        pendingOperation: 'rebuild-stack',
        chainOnSuccess: {
          args: ['start', issueId],
          phaseLabel: `Stack rebuilt — starting agent for ${issueId.toUpperCase()}`,
        },
      },
    );
    return jsonResponse({
      success: true,
      message: `Rebuilding stack and starting agent for ${issueId}`,
      activityId,
    });
  }))
);

// ─── Route: GET /api/workspaces/:issueId/plan ─────────────────────────────────

const getWorkspaceStateMdRoute = HttpRouter.add(
  'GET',
  '/api/workspaces/:issueId/state-md',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const parsed = parseIssueIdSync(issueId);
    const issuePrefix = parsed?.prefix ?? extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const { parsedIssueId, workspacePath } = getWorkspacePathForIssue(projectPath, issueId);

    const continueBody = yield* Effect.promise(() => readWorkspaceContinueFile(projectPath, workspacePath, issueId));
    if (continueBody) {
      return jsonResponse({ issueId: parsedIssueId, body: continueBody });
    }

    return jsonResponse({ error: 'Planning state not found for this workspace' }, { status: 404 });
  }))
);

const getWorkspaceInferenceMdRoute = HttpRouter.add(
  'GET',
  '/api/workspaces/:issueId/inference-md',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    return yield* Effect.promise(() =>
      readWorkspacePlanningMarkdown(issueId, 'INFERENCE.md')
        .then((result) => jsonResponse(result))
        .catch((err: unknown) => {
          if (
            typeof err === 'object'
            && err !== null
            && ('code' in err || 'message' in err)
            && ((err as { code?: unknown }).code === 'ENOENT'
              || String((err as { message?: unknown }).message ?? '').includes('Invalid issue ID'))
          ) {
            return jsonResponse({ error: 'INFERENCE.md not found for this workspace' }, { status: 404 });
          }
          console.error('[workspaces] Failed to read INFERENCE.md:', err);
          return jsonResponse({ error: 'Internal server error' }, { status: 500 });
        })
    );
  }))
);

// ─── Route: POST /api/issues/:issueId/start ───────────────────────────────

const postWorkspaceStartRoute = HttpRouter.add(
  'POST',
  '/api/issues/:issueId/start',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issueId.toLowerCase();
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);

    if (!existsSync(workspacePath)) {
      return jsonResponse({ error: 'Workspace does not exist' }, { status: 400 });
    }

    const workspaceBeadsDir = join(workspacePath, '.beads');
    if (!existsSync(workspaceBeadsDir)) {
      const projectRootBeadsDir = join(projectPath, '.beads');
      if (existsSync(projectRootBeadsDir)) {
        try {
          yield* Effect.promise(() => execAsync(`cp -r "${projectRootBeadsDir}" "${workspaceBeadsDir}"`, {
            encoding: 'utf-8',
          }));
          console.log(
            `[workspace/start] Copied beads from project root to workspace for ${issueId}`
          );
        } catch (e) {
          console.warn(`[workspace/start] Could not copy beads: ${e}`);
        }
      }
    }

    // Check for ./dev script
    const devScript = join(workspacePath, 'dev');
    const devScriptInContainer = join(workspacePath, '.devcontainer', 'dev');

    if (!existsSync(devScript)) {
      if (existsSync(devScriptInContainer)) {
        try {
          yield* Effect.promise(() => symlink('.devcontainer/dev', devScript));
          yield* Effect.promise(() => chmod(devScriptInContainer, 0o755));
          console.log(`[workspace/start] Repaired: created ./dev symlink for ${issueId}`);
        } catch (repairErr) {
          return jsonResponse(
            {
              error: `Workspace has no ./dev script and repair failed: ${repairErr}`,
            },
            { status: 400 }
          );
        }
      } else {
        return jsonResponse(
          { error: 'Workspace has no ./dev script (checked root and .devcontainer/)' },
          { status: 400 }
        );
      }
    }

    // Repair .env if needed
    const envFilePath = join(workspacePath, '.env');
    const teamPrefix = extractTeamPrefix(issueId);
    const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;

    if (projectConfig?.workspace?.ports && projectConfig?.workspace?.env?.template) {
      const featureFolder = `feature-${issueLower}`;
      let needsRepair = !existsSync(envFilePath);

      if (!needsRepair && existsSync(envFilePath)) {
        const existingEnv = yield* Effect.promise(() => readFile(envFilePath, 'utf-8'));
        for (const portName of Object.keys(projectConfig.workspace.ports)) {
          const portVar = `${portName.toUpperCase()}_PORT`;
          if (!existingEnv.includes(portVar)) {
            needsRepair = true;
            break;
          }
        }
      }

      if (needsRepair) {
        try {
          const placeholders: Record<string, string> = { FEATURE_FOLDER: featureFolder };
          for (const [portName, portConfig] of Object.entries(
            projectConfig.workspace.ports
          )) {
            const portFile = join(projectPath, `.${portName}-ports`);
            const range = (portConfig as any).range as [number, number];
            let content = '';
            if (existsSync(portFile)) content = yield* Effect.promise(() => readFile(portFile, 'utf-8'));
            const lines = content.split('\n').filter(Boolean);
            let port: number | null = null;
            for (const line of lines) {
              const [folder, p] = line.split(':');
              if (folder === featureFolder) {
                port = parseInt(p, 10);
                break;
              }
            }
            if (!port) {
              const usedPorts = new Set(lines.map(l => parseInt(l.split(':')[1], 10)));
              for (let p = range[0]; p <= range[1]; p++) {
                if (!usedPorts.has(p)) {
                  port = p;
                  yield* Effect.promise(() => writeFile(
                    portFile,
                    content +
                      (content.endsWith('\n') || !content ? '' : '\n') +
                      `${featureFolder}:${port}\n`
                  ));
                  break;
                }
              }
            }
            if (port) placeholders[`${portName.toUpperCase()}_PORT`] = String(port);
          }
          let envContent = projectConfig.workspace.env.template;
          for (const [key, value] of Object.entries(placeholders)) {
            envContent = envContent.replace(
              new RegExp(`\\{\\{${key}\\}\\}`, 'g'),
              value
            );
          }
          yield* Effect.promise(() => writeFile(envFilePath, envContent));
          console.log(
            `[workspace/start] Repaired: created .env with port assignments for ${issueId}`
          );
        } catch (envErr) {
          console.warn(
            `[workspace/start] Could not repair .env for ${issueId}: ${envErr}`
          );
        }
      }
    }

    // Check Docker is running
    try {
      yield* Effect.promise(() => execAsync('docker info >/dev/null 2>&1', { encoding: 'utf-8' }));
    } catch {
      return jsonResponse(
        { error: 'Docker is not running. Start Docker Desktop first.' },
        { status: 400 }
      );
    }

    // Pre-start Flyway repair if applicable
    if (projectConfig?.workspace?.database?.migrations?.type === 'flyway') {
      try {
        const composePaths = [
          join(workspacePath, '.devcontainer/docker-compose.devcontainer.yml'),
          join(workspacePath, 'docker-compose.yml'),
        ];
        let compFile: string | undefined;
        for (const cp of composePaths) {
          if (existsSync(cp)) { compFile = cp; break; }
        }
        if (compFile) {
          const { stdout: pnOut } = yield* Effect.promise(() => execAsync(
            `docker compose -f "${compFile}" config --format json 2>/dev/null | jq -r '.name // empty'`,
            { encoding: 'utf-8' }
          ));
          const composeName = pnOut.trim();
          if (composeName) {
            const pgContainer = `${composeName}-postgres-1`;
            const result = yield* Effect.promise(() => repairFlywayIfNeeded(
              issueId,
              pgContainer,
              'myn',
              projectConfig,
              workspacePath
            ));
            if (result.repaired) {
              console.log(`[workspace/start] Pre-start Flyway repair: ${result.message}`);
            }
          }
        }
      } catch (preCheckErr: any) {
        console.log(
          `[workspace/start] Pre-start Flyway check skipped: ${preCheckErr.message}`
        );
      }
    }

    const activityId = Date.now().toString();
    logActivity({
      id: activityId,
      timestamp: new Date().toISOString(),
      command: `./dev all (${issueId})`,
      status: 'running',
      output: [],
    });

    const uid = process.getuid?.() ?? 1000;
    const gid = process.getgid?.() ?? 1000;

    const child = spawn('./dev', ['all'], {
      cwd: workspacePath,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildChildEnvWithoutTmuxSync(process.env, { UID: String(uid), GID: String(gid), DOCKER_USER: `${uid}:${gid}` }),
    });

    child.stdout?.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => {
        appendActivityOutput(activityId, line);
      });
    });
    child.stderr?.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line: string) => {
        appendActivityOutput(activityId, `[stderr] ${line}`);
      });
    });

    child.on('close', (code) => {
      appendActivityOutput(
        activityId,
        `[${new Date().toISOString()}] ./dev all exited with code ${code}`
      );

      if (code !== 0 && projectConfig?.workspace?.database?.migrations?.type === 'flyway') {
        (async () => {
          try {
            const composePaths = [
              join(workspacePath, '.devcontainer/docker-compose.devcontainer.yml'),
              join(workspacePath, 'docker-compose.yml'),
            ];
            let composeFile: string | undefined;
            for (const cp of composePaths) {
              if (existsSync(cp)) { composeFile = cp; break; }
            }
            if (!composeFile) return;

            const { stdout: pnOut } = await execAsync(
              `docker compose -f "${composeFile}" config --format json 2>/dev/null | jq -r '.name // empty'`,
              { encoding: 'utf-8' }
            );
            const composeName = pnOut.trim();
            if (!composeName) return;

            const apiContainer = `${composeName}-api-1`;
            const pgContainer = `${composeName}-postgres-1`;

            const { stdout: apiStatus } = await execAsync(
              `docker ps -a --filter "name=^${apiContainer}$" --format "{{.Status}}" 2>/dev/null`,
              { encoding: 'utf-8' }
            );
            if (!apiStatus.trim().startsWith('Exited')) return;

            const { stdout: logs } = await execAsync(
              `docker logs --tail 50 "${apiContainer}" 2>&1 || true`,
              { encoding: 'utf-8', timeout: 10000 }
            );
            if (!logs.toLowerCase().includes('flyway')) return;

            appendActivityOutput(activityId, '');
            appendActivityOutput(
              activityId,
              '=== Detected Flyway failure — attempting auto-repair ==='
            );

            const result = await repairFlywayIfNeeded(
              issueId,
              pgContainer,
              'myn',
              projectConfig,
              workspacePath,
              (msg) => appendActivityOutput(activityId, `[flyway-repair] ${msg}`)
            );

            if (result.repaired) {
              appendActivityOutput(activityId, `[flyway-repair] Restarting API container...`);
              await execAsync(`docker start "${apiContainer}"`, {
                encoding: 'utf-8',
                timeout: 30000,
              });
              appendActivityOutput(
                activityId,
                `[flyway-repair] API container restarted successfully`
              );
              updateActivity(activityId, { status: 'completed' });
              return;
            }
          } catch (repairErr: any) {
            appendActivityOutput(
              activityId,
              `[flyway-repair] Auto-repair failed: ${repairErr.message}`
            );
          }
          updateActivity(activityId, { status: 'failed' });
        })();
      } else {
        updateActivity(activityId, { status: code === 0 ? 'completed' : 'failed' });
      }
    });

    child.on('error', (err) => {
      appendActivityOutput(activityId, `[error] ${err.message}`);
      updateActivity(activityId, { status: 'failed' });
    });

    return jsonResponse({
      success: true,
      message: `Starting containers for ${issueId}`,
      activityId,
    });
  }))
);

// ─── Route: GET /api/review/:issueId/status ───────────────────────

const getWorkspaceReviewStatusRoute = HttpRouter.add(
  'GET',
  '/api/review/:issueId/status',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const status = getReviewStatusSync(issueId);
    const base: ReviewStatus = status || {
      issueId,
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
      readyForMerge: false,
      updatedAt: new Date().toISOString(),
    };

    let { queuePosition, activeSpecialist } = computeQueuePositionFromStatusSync(status);

    // Discover active parallel review sessions for this issue
    let reviewCoordinatorSessionName: string | undefined;
    let reviewSessionNames: string[] | undefined;
    let reviewSubStatuses: Record<string, 'running' | 'done'> | undefined;
    try {
      const allSessions = yield* listSessionNames();
      const enriched = enrichReviewStatusFromSessions(issueId, base, allSessions);
      reviewCoordinatorSessionName = enriched.reviewCoordinatorSessionName;
      reviewSessionNames = enriched.reviewSessionNames;
      reviewSubStatuses = enriched.reviewSubStatuses;
    } catch { /* non-fatal: tmux may not be available */ }

    // Only the merge queue is persistent — check it when no active phase is detected
    if (queuePosition === null) {
      try {
        const resolved = resolveProjectFromIssueSync(issueId);
        if (resolved) {
          const { getQueueForProject } = yield* Effect.promise(() =>
            import('../../../lib/overdeck/merge.js')
          );
          const mergeQueue = getQueueForProject(resolved.projectKey);
          const mergePos = findPositionInQueueSync(issueId, mergeQueue.map(e => ({
            id: String(e.id),
            type: 'task' as const,
            priority: 'normal' as const,
            source: 'merge-queue',
            payload: { issueId: e.issueId },
            createdAt: e.queuedAt,
          })));
          if (mergePos > 0) {
            queuePosition = mergePos;
            activeSpecialist = 'merge';
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[review-status] Merge queue lookup failed for ${issueId} (non-fatal): ${msg}`);
      }
    }

    return jsonResponse({ ...base, queuePosition, activeSpecialist, reviewCoordinatorSessionName, reviewSessionNames, reviewSubStatuses });
  }))
);

// ─── Route: POST /api/review/:issueId/status ──────────────────────

const postWorkspaceReviewStatusRoute = HttpRouter.add(
  'POST',
  '/api/review/:issueId/status',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;
    const { reviewStatus, testStatus, mergeStatus, reviewNotes, testNotes, verificationStatus, readyForMerge } = body as {
      reviewStatus?: string;
      testStatus?: string;
      mergeStatus?: string;
      reviewNotes?: string;
      testNotes?: string;
      verificationStatus?: string;
      readyForMerge?: boolean;
    };

    // Snapshot reviewedAtCommit BEFORE the first setReviewStatus call so canSkipTests
    // fires correctly in that same call — setting it afterward is too late (the
    // async test-agent dispatch is already scheduled).
    const update: Partial<ReviewStatus> = {};
    if (reviewStatus === 'passed') {
      const workspaceInfo = getWorkspaceInfoForIssue(issueId);
      if (workspaceInfo.exists && workspaceInfo.localPath) {
        const localPath = workspaceInfo.localPath;
        const { getWorkspaceGitInfo } = yield* Effect.promise(() => import('../../../lib/git-utils.js'));
        try {
          const gitInfo = yield* getWorkspaceGitInfo(localPath);
          if (gitInfo.HEAD) {
            update.reviewedAtCommit = gitInfo.HEAD;
          }
        } catch { /* non-fatal */ }
      }
    }
    if (reviewStatus) update.reviewStatus = reviewStatus as any;
    if (testStatus) update.testStatus = testStatus as any;
    if (mergeStatus) update.mergeStatus = mergeStatus as any;
    if (reviewNotes) update.reviewNotes = reviewNotes;
    if (testNotes) update.testNotes = testNotes;
    if (verificationStatus) update.verificationStatus = verificationStatus as any;
    if (readyForMerge !== undefined) update.readyForMerge = readyForMerge;

    const status = setReviewStatus(issueId, update);

    const { getTmuxSessionName } =
      yield* Effect.promise(() => import('../../../lib/cloister/specialists.js'));

    const resolvedProject = resolveProjectFromIssueSync(issueId);
    const projectKey = resolvedProject?.projectKey;

    if (reviewStatus && ['passed', 'blocked', 'failed'].includes(reviewStatus)) {
      const tmuxSession = getTmuxSessionName('review-agent', projectKey);
      saveAgentRuntimeState(tmuxSession, {
        state: 'idle',
        currentIssue: undefined,
        lastActivity: new Date().toISOString(),
      });
      console.log(`[review-status] Set review-agent (${tmuxSession}) to idle`);

      if (['blocked', 'failed'].includes(reviewStatus) && reviewNotes) {
        const agentId = `agent-${issueId.toLowerCase()}`;
        const feedbackBody = `CODE REVIEW ${reviewStatus.toUpperCase()} for ${issueId}:\n\n${reviewNotes}\n\n## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill\n\n1. Read each blocking issue carefully\n2. Fix the code for EVERY issue listed\n3. Run tests locally to verify your fixes\n4. Commit every change\n5. Invoke the /rebase-and-submit skill for ${issueId} — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)\n\nDo NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.`;
        try {
          const { writeFeedbackFile } = yield* Effect.promise(() => import(
            '../../../lib/cloister/feedback-writer.js'
          ));
          const wsInfo = getWorkspaceInfoForIssue(issueId);
          const fileResult = yield* Effect.promise(() => writeFeedbackFile({
            issueId,
            workspacePath: wsInfo.localPath,
            specialist: 'review-agent',
            outcome: reviewStatus === 'blocked' ? 'changes-requested' : 'failed',
            summary: `Review ${reviewStatus.toUpperCase()}: ${(reviewNotes || '').slice(0, 80)}`,
            markdownBody: feedbackBody,
          }));
          if (!fileResult.success) {
            console.error(
              `[review-status] Failed to write feedback file for ${issueId}: ${fileResult.error}`
            );
          } else {
            const msg = `SPECIALIST FEEDBACK: review-agent reported ${reviewStatus.toUpperCase()} for ${issueId}.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, then fix ALL issues. Do NOT stop at the prompt — keep working until every blocking issue is resolved and you have invoked /rebase-and-submit.`;
            const deliveryKind = reviewStatus === 'blocked' ? 'review-blocked' : 'review-failed';
            yield* Effect.promise(() => deliverQueuedFeedback(issueId, deliveryKind, fileResult.filePath!, msg));
            console.log(
              `[review-status] Auto-sent feedback to ${agentId} (file: ${fileResult.relativePath})`
            );
          }
        } catch (err) {
          console.error(`[review-status] Failed to send feedback to ${agentId}:`, err);
        }
      }

      if (reviewStatus === 'passed') {
        yield* Effect.promise(() => Effect.runPromise(eventStore.append({
          type: 'pipeline.review-completed',
          timestamp: new Date().toISOString(),
          payload: { issueId, passed: true },
        })));
        console.log(`[review-status] ${issueId} review approved; reactive Cloister will dispatch the test role`);
      } else if (['blocked', 'failed'].includes(reviewStatus)) {
        yield* Effect.promise(() => Effect.runPromise(eventStore.append({
          type: 'pipeline.review-completed',
          timestamp: new Date().toISOString(),
          payload: { issueId, passed: false },
        })));
      }
    }

    if (testStatus && ['passed', 'failed', 'skipped'].includes(testStatus)) {
      const tmuxSession = getTmuxSessionName('test-agent', projectKey);
      saveAgentRuntimeState(tmuxSession, {
        state: 'idle',
        currentIssue: undefined,
        lastActivity: new Date().toISOString(),
      });
      console.log(`[review-status] Set test-agent (${tmuxSession}) to idle`);

      if (testStatus === 'failed') {
        yield* Effect.promise(() => Effect.runPromise(eventStore.append({
          type: 'pipeline.test-completed',
          timestamp: new Date().toISOString(),
          payload: { issueId, passed: false },
        })));
      }

      if (testStatus === 'failed' && testNotes) {
        const agentId = `agent-${issueId.toLowerCase()}`;
        const feedbackBody = `TESTS FAILED for ${issueId}:\n\n${testNotes}\n\n## REQUIRED: Fix ALL test failures, then invoke the /rebase-and-submit skill\n\n1. Read each test failure carefully\n2. Fix the code causing EVERY failure\n3. Run the test suite locally to verify your fixes pass\n4. Commit every change\n5. Invoke the /rebase-and-submit skill for ${issueId} — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)\n\nDo NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.`;
        try {
          const { writeFeedbackFile } = yield* Effect.promise(() => import(
            '../../../lib/cloister/feedback-writer.js'
          ));
          const wsInfo = getWorkspaceInfoForIssue(issueId);
          const fileResult = yield* Effect.promise(() => writeFeedbackFile({
            issueId,
            workspacePath: wsInfo.localPath,
            specialist: 'test-agent',
            outcome: 'failed',
            summary: `Tests FAILED: ${(testNotes || '').slice(0, 80)}`,
            markdownBody: feedbackBody,
          }));
          if (!fileResult.success) {
            console.error(
              `[review-status] Failed to write test feedback file for ${issueId}: ${fileResult.error}`
            );
          } else {
            const msg = `SPECIALIST FEEDBACK: test-agent reported FAILED for ${issueId}.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, then fix the failing tests and re-submit. Do NOT stop at the prompt — keep working until all tests pass and you have invoked /rebase-and-submit.`;
            yield* Effect.promise(() => deliverQueuedFeedback(issueId, 'test-failed', fileResult.filePath!, msg));
            console.log(
              `[review-status] Auto-sent test failure to ${agentId} (file: ${fileResult.relativePath})`
            );
          }
        } catch (err) {
          console.error(`[review-status] Failed to send test feedback to ${agentId}:`, err);
        }
      }

      if (testStatus === 'passed') {
        // Mark ready for merge when tests pass. Post-rebase verification in
        // triggerMerge() is the real quality gate — don't block on stale pre-merge verification.
        setReviewStatus(issueId, { readyForMerge: true });
        console.log(`[review-status] ${issueId} marked ready for merge after test=passed`);

        // Post overdeck/tests=success so the CI test job self-skips on this
        // commit. Mirrors what verification-runner does at the pre-review gate.
        yield* Effect.promise(async () => {
          try {
            const { resolveProjectFromIssueSync, getProjectSync } = await import('../../../lib/projects.js');
            const project = resolveProjectFromIssueSync(issueId);
            const projectCfg = project ? getProjectSync(project.projectKey) : null;
            const repo = projectCfg?.github_repo;
            if (!repo || !repo.includes('/')) return;
            const [owner, name] = repo.split('/');
            const wsInfo = getWorkspaceInfoForIssue(issueId);
            if (!wsInfo?.localPath) return;
            const { postOverdeckTestsStatus } = await import('../../../lib/github-app.js');
            await postOverdeckTestsStatus(wsInfo.localPath, owner!, name!, 'success', 'Test specialist passed');
          } catch (err: any) {
            console.warn(`[review-status] Failed to post overdeck/tests for ${issueId}: ${err.message}`);
          }
        });

        yield* Effect.promise(() => Effect.runPromise(eventStore.append({
          type: 'pipeline.test-completed',
          timestamp: new Date().toISOString(),
          payload: { issueId, passed: true },
        })));
        try {
          const agentId = `agent-${issueId.toLowerCase()}`;
          yield* Effect.promise(() => messageAgent(
            agentId,
            `ALL CHECKS PASSED for ${issueId}. Review: passed. Tests: passed. Your work is complete — ready for merge. You may stop working on this issue.`
          ));
          console.log(`[review-status] Notified ${agentId} that all checks passed`);
        } catch (err) {
          console.log(
            `[review-status] Could not notify work agent for ${issueId} (may not be running): ${(err as Error).message}`
          );
        }
      }
    }

    return jsonResponse(status);
  }))
);

// ─── Route: POST /api/review/:issueId/reset ───────────────────────

/** HTTP-contract result from the reset-review endpoint. Exported for unit testing. */

// ─── Route: POST /api/workspaces/:issueId/unstick ────────────────────────
//
// Clears the persistent stuck flag set by markWorkspaceStuck() so Deacon
// resumes normal patrol for this workspace. Does NOT restart the agent —
// the user should do that separately via the start-agent UI once they have
// resolved the divergence (e.g. by syncing main and re-approving).

/** HTTP-contract result from the unstick endpoint. Exported for unit testing. */

// ─── Route: POST /api/workspaces/:issueId/deacon-ignore ──────────────────

/**
 * Operator toggle: tell Deacon to stop patrolling this issue. Body:
 *   { ignored: boolean, reason?: string }
 *
 * Idempotent — calling with ignored=true repeatedly refreshes the timestamp
 * but otherwise no-ops. Separate from stuck/unstick: stuck is a system-set
 * failure marker, deaconIgnored is an explicit human "hands off".
 */

// ─── Route: POST /api/workspaces/:issueId/auto-merge ─────────────────────

/**
 * PAN-1691: operator toggle for the per-issue auto-merge routing key. Body:
 *   { autoMerge: boolean | null }
 * `true` = auto-merge (fast lane), `false` = hold for UAT (manual lane),
 * `null` = clear back to the project default. Emits status_changed via the
 * setAutoMerge wrapper so open dashboards reflect the toggle live.
 */

// ─── Route: POST /api/workspaces/:issueId/refresh-token ───────────────────────

const postWorkspaceRefreshTokenRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/refresh-token',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const issueLower = issueId.toLowerCase();
    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);

    const { refreshWorkspaceToken, isGitHubAppConfigured } = yield* Effect.promise(() => import('../../../lib/github-app.js'));
    if (!isGitHubAppConfigured()) {
      return jsonResponse({ success: false, error: 'GitHub App not configured' }, { status: 400 });
    }

    yield* Effect.promise(() => refreshWorkspaceToken(workspacePath));
    return jsonResponse({ success: true, message: `Token refreshed for ${issueId}` });
  })),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const workspacesRouteLayer = Layer.mergeAll(
  workspaceDataRouteLayer,
  postWorkspaceRebuildRoute,
  postWorkspaceRebuildAndStartRoute,
  getWorkspaceStateMdRoute,
  getWorkspaceInferenceMdRoute,
  stashCleanRouteLayer,
  containerOpsRouteLayer,
  postWorkspaceStartRoute,
  getWorkspaceReviewStatusRoute,
  postWorkspaceReviewStatusRoute,
  reviewPipelineRouteLayer,
  reviewControlRouteLayer,
  mergeOpsRouteLayer,
  postWorkspaceRefreshTokenRoute,
);

export default workspacesRouteLayer;
