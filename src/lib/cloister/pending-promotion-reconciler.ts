import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Effect } from 'effect';

import { emitActivityEntrySync } from '../activity-logger.js';
import { getInternalTokenSync, INTERNAL_TOKEN_HEADER } from '../internal-token.js';
import { PENDING_PROMOTION_FILENAME, WORKSPACE_RUNTIME_DIRNAME } from '../pan-dir/types.js';
import { findSpecByIssue } from '../pan-dir/specs.js';
import { listProjects, type ProjectConfig } from '../projects.js';
import { findWorkspaceDraftPlanSync, readPlanSync } from '../xbrief/io.js';
import type { XBriefDocument } from '../xbrief/types.js';
import { recordDeadEndNeedsYou } from './dead-end-trip.js';
import { isIssueClosed } from './issue-closed.js';

const MARKER_GRACE_MS = 120_000;
const MARKERLESS_SPEC_GRACE_MS = 5 * 60_000;
const NEEDS_YOU_ATTEMPTS = 5;

type ProjectEntry = { key: string; config: Pick<ProjectConfig, 'name' | 'path'> };

export type PendingPromotionMarker = {
  version: '1';
  issueId: string;
  canonicalFilename: string;
  noPrd: boolean;
  autoSpawnRequested: boolean;
  finalizedAt: string;
  lastError: string;
  lastAttemptAt: string;
  patrolAttempts: number;
};

export interface PendingPromotionMarkerIo {
  read(path: string, issueId: string): Promise<PendingPromotionMarker | null>;
  write(path: string, marker: PendingPromotionMarker): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface PendingPromotionCandidate {
  projectKey: string;
  projectName: string;
  projectPath: string;
  workspacePath: string;
  issueId: string;
  specPath: string;
  markerPath: string;
  marker: PendingPromotionMarker | null;
  canonicalFilename: string;
  noPrd: boolean;
  autoSpawnRequested: boolean;
  finalizedAt: string;
  patrolAttempts: number;
}

export interface PendingPromotionReconcilerOptions {
  projects?: ProjectEntry[];
  clock?: () => Date;
  fetch?: typeof fetch;
  dashboardOrigin?: string;
  getInternalToken?: () => string | null;
  findPromotedSpec?: (projectPath: string, issueId: string) => Promise<unknown | null>;
  isClosed?: (issueId: string) => Promise<boolean>;
  recordNeedsYou?: typeof recordDeadEndNeedsYou;
  emitActivity?: typeof emitActivityEntrySync;
  markerIo?: PendingPromotionMarkerIo;
}

function normalizeIssueId(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z]+-\d+$/.test(value.trim())
    ? value.trim().toUpperCase()
    : null;
}

function issueIdFromWorkspaceName(name: string): string | null {
  const match = name.match(/^feature-([a-z]+-\d+)$/i);
  return match ? match[1]!.toUpperCase() : null;
}

function parseDate(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMarker(value: unknown, expectedIssueId: string): PendingPromotionMarker | null {
  if (!value || typeof value !== 'object') return null;
  const marker = value as Record<string, unknown>;
  const issueId = normalizeIssueId(marker['issueId']);
  if (marker['version'] !== '1' || issueId !== expectedIssueId) return null;
  if (typeof marker['canonicalFilename'] !== 'string' || marker['canonicalFilename'].length === 0) return null;
  if (parseDate(marker['finalizedAt']) === null) return null;

  return {
    version: '1',
    issueId,
    canonicalFilename: marker['canonicalFilename'],
    noPrd: marker['noPrd'] === true,
    autoSpawnRequested: marker['autoSpawnRequested'] === true,
    finalizedAt: marker['finalizedAt'] as string,
    lastError: typeof marker['lastError'] === 'string' ? marker['lastError'] : 'complete-planning failed',
    lastAttemptAt: typeof marker['lastAttemptAt'] === 'string' ? marker['lastAttemptAt'] : marker['finalizedAt'] as string,
    patrolAttempts: Number.isInteger(marker['patrolAttempts']) && Number(marker['patrolAttempts']) >= 0
      ? Number(marker['patrolAttempts'])
      : 0,
  };
}

async function readMarker(path: string, issueId: string): Promise<PendingPromotionMarker | null> {
  try {
    return parseMarker(JSON.parse(await readFile(path, 'utf-8')), issueId);
  } catch {
    return null;
  }
}

async function loadProjects(projects?: ProjectEntry[]): Promise<ProjectEntry[]> {
  if (projects) return projects;
  return Effect.runPromise(listProjects().pipe(Effect.catch(() => Effect.succeed([]))));
}

async function defaultFindPromotedSpec(projectPath: string, issueId: string): Promise<unknown | null> {
  return Effect.runPromise(
    findSpecByIssue(projectPath, issueId).pipe(Effect.catch(() => Effect.succeed(null))),
  );
}

function internalDashboardOrigin(): string {
  const port = Number.parseInt(process.env['API_PORT'] ?? process.env['PORT'] ?? '3011', 10);
  return process.env['OVERDECK_INTERNAL_DASHBOARD_URL'] ?? `http://127.0.0.1:${port}`;
}

function logDiagnostic(kind: string, info: Record<string, unknown> = {}): void {
  console.debug(`[pending-promotion-reconciler] ${kind}`, info);
}

function markerPathForWorkspace(workspacePath: string): string {
  return join(workspacePath, WORKSPACE_RUNTIME_DIRNAME, PENDING_PROMOTION_FILENAME);
}

function canonicalFilenameFromSpec(doc: XBriefDocument): string | null {
  const filename = doc.plan.metadata?.canonicalFilename;
  return typeof filename === 'string' && filename.length > 0 ? filename : null;
}

async function writeMarker(path: string, marker: PendingPromotionMarker): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(marker, null, 2) + '\n', 'utf-8');
  await rename(tmp, path);
}

const defaultMarkerIo: PendingPromotionMarkerIo = {
  read: readMarker,
  write: writeMarker,
  remove: (path) => rm(path, { force: true }),
};

export async function findPendingPromotionCandidates(
  options: PendingPromotionReconcilerOptions = {},
): Promise<PendingPromotionCandidate[]> {
  const projects = await loadProjects(options.projects);
  const now = (options.clock ?? (() => new Date()))().getTime();
  const findPromotedSpec = options.findPromotedSpec ?? defaultFindPromotedSpec;
  const markerIo = options.markerIo ?? defaultMarkerIo;
  const candidates: PendingPromotionCandidate[] = [];

  for (const { key, config } of projects) {
    const workspacesDir = join(config.path, 'workspaces');
    const workspaces = await readdir(workspacesDir, { withFileTypes: true }).catch(() => []);
    for (const workspace of workspaces) {
      if (!workspace.isDirectory() || workspace.name.endsWith('-strike')) continue;
      const issueId = issueIdFromWorkspaceName(workspace.name);
      if (!issueId) continue;

      const workspacePath = join(workspacesDir, workspace.name);
      const markerPath = markerPathForWorkspace(workspacePath);
      const marker = await markerIo.read(markerPath, issueId);
      const specPath = findWorkspaceDraftPlanSync(workspacePath);
      if (!specPath) continue;

      let spec: XBriefDocument;
      try {
        spec = readPlanSync(specPath);
      } catch {
        logDiagnostic('candidate-skipped', { issueId, reason: 'spec-unreadable' });
        continue;
      }
      if (spec.plan.status !== 'proposed' || normalizeIssueId(spec.plan.id) !== issueId) continue;

      if (marker) {
        candidates.push({
          projectKey: key,
          projectName: config.name,
          projectPath: config.path,
          workspacePath,
          issueId,
          specPath,
          markerPath,
          marker,
          canonicalFilename: marker.canonicalFilename,
          noPrd: marker.noPrd,
          autoSpawnRequested: marker.autoSpawnRequested,
          finalizedAt: marker.finalizedAt,
          patrolAttempts: marker.patrolAttempts,
        });
        continue;
      }

      if (spec.plan.metadata?.promotionIntent === 'manual') continue;
      const specInfo = await stat(specPath).catch(() => null);
      if (!specInfo || now - specInfo.mtimeMs < MARKERLESS_SPEC_GRACE_MS) continue;
      if (await findPromotedSpec(config.path, issueId)) continue;
      const canonicalFilename = canonicalFilenameFromSpec(spec);
      if (!canonicalFilename) {
        logDiagnostic('candidate-skipped', { issueId, reason: 'canonical-filename-missing' });
        continue;
      }

      candidates.push({
        projectKey: key,
        projectName: config.name,
        projectPath: config.path,
        workspacePath,
        issueId,
        specPath,
        markerPath,
        marker: null,
        canonicalFilename,
        noPrd: false,
        autoSpawnRequested: false,
        finalizedAt: specInfo.mtime.toISOString(),
        patrolAttempts: 0,
      });
    }
  }

  return candidates;
}

function parseResponseBody(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function responseError(status: number, body: Record<string, unknown>, text: string): string {
  if (typeof body['error'] === 'string') return body['error'];
  if (typeof body['message'] === 'string') return body['message'];
  return text.slice(0, 200) || `complete-planning returned HTTP ${status}`;
}

function responseStillPending(status: number, body: Record<string, unknown>): boolean {
  return status === 202 || body['inFlight'] === true || typeof body['skipped'] === 'string';
}

export async function reconcilePendingPromotions(
  options: PendingPromotionReconcilerOptions = {},
): Promise<string[]> {
  const now = (options.clock ?? (() => new Date()))();
  const nowMs = now.getTime();
  const fetchImpl = options.fetch ?? fetch;
  const dashboardOrigin = options.dashboardOrigin ?? internalDashboardOrigin();
  const internalToken = (options.getInternalToken ?? getInternalTokenSync)();
  const findPromotedSpec = options.findPromotedSpec ?? defaultFindPromotedSpec;
  const isClosed = options.isClosed ?? ((issueId: string) => isIssueClosed(issueId));
  const recordNeedsYou = options.recordNeedsYou ?? recordDeadEndNeedsYou;
  const emitActivity = options.emitActivity ?? emitActivityEntrySync;
  const markerIo = options.markerIo ?? defaultMarkerIo;
  const candidates = await findPendingPromotionCandidates({ ...options, clock: () => now, findPromotedSpec, markerIo });
  const actions: string[] = [];

  for (const candidate of candidates) {
    if (await isClosed(candidate.issueId)) {
      logDiagnostic('candidate-skipped', { issueId: candidate.issueId, reason: 'closed' });
      continue;
    }

    if (await findPromotedSpec(candidate.projectPath, candidate.issueId)) {
      await markerIo.remove(candidate.markerPath);
      actions.push(`Cleared resolved pending-promotion marker for ${candidate.issueId}`);
      continue;
    }

    const finalizedAtMs = parseDate(candidate.finalizedAt);
    if (finalizedAtMs === null || nowMs - finalizedAtMs < MARKER_GRACE_MS) {
      logDiagnostic('candidate-skipped', { issueId: candidate.issueId, reason: 'grace-window' });
      continue;
    }

    let response: Response | null = null;
    let body: Record<string, unknown> = {};
    let error: string | null = null;
    try {
      response = await fetchImpl(
        new URL(`/api/issues/${encodeURIComponent(candidate.issueId)}/complete-planning`, dashboardOrigin),
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: dashboardOrigin,
            ...(internalToken ? { [INTERNAL_TOKEN_HEADER]: internalToken } : {}),
          },
          body: JSON.stringify({
            noPrd: candidate.noPrd,
            startedBy: 'pending-promotion-reconciler',
          }),
        },
      );
      const text = await response.text();
      body = parseResponseBody(text);
      if (responseStillPending(response.status, body)) {
        logDiagnostic('promotion-deferred', { issueId: candidate.issueId, status: response.status, body });
        continue;
      }
      if (response.status !== 200 || !response.ok || body['success'] === false || body['ok'] === false) {
        error = responseError(response.status, body, text);
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }

    if (!error && response?.status === 200) {
      await markerIo.remove(candidate.markerPath);
      const action = `Recovered pending planning promotion for ${candidate.issueId}`;
      actions.push(action);
      emitActivity({
        source: 'cloister',
        level: 'success',
        issueId: candidate.issueId,
        message: `${candidate.issueId} planning promotion recovered automatically`,
        details: JSON.stringify({
          issueId: candidate.issueId,
          workspacePath: candidate.workspacePath,
          reconciler: 'pending-promotion',
          timestamp: now.toISOString(),
        }),
      });
      continue;
    }

    const nextAttempts = candidate.patrolAttempts + 1;
    const lastError = error ?? 'complete-planning did not converge';
    await markerIo.write(candidate.markerPath, {
      version: '1',
      issueId: candidate.issueId,
      canonicalFilename: candidate.canonicalFilename,
      noPrd: candidate.noPrd,
      autoSpawnRequested: candidate.autoSpawnRequested,
      finalizedAt: candidate.finalizedAt,
      lastError,
      lastAttemptAt: now.toISOString(),
      patrolAttempts: nextAttempts,
    });
    logDiagnostic('promotion-failed', { issueId: candidate.issueId, patrolAttempts: nextAttempts, error: lastError });
    actions.push(`Pending planning promotion for ${candidate.issueId} failed attempt ${nextAttempts}: ${lastError}`);

    if (nextAttempts >= NEEDS_YOU_ATTEMPTS) {
      await recordNeedsYou(
        candidate.issueId,
        'pending-promotion',
        candidate.finalizedAt,
        `Planning promotion for ${candidate.issueId} has failed ${nextAttempts} patrol attempts. The finalized plan remains unpromoted. Run \`pan plan done ${candidate.issueId}\` to retry manually, then inspect the complete-planning error if it still fails.`,
      );
    }
  }

  return actions;
}
