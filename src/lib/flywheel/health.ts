/**
 * The Flywheel health strip and shipped-today timeline (PAN-5283 WI-8).
 *
 * Server-only (D7): the status route calls `deriveFlywheelHealth()` and
 * merges its answer into `GET /api/flywheel/status` as the optional `health`
 * and `shipped` fields; `pan flywheel status` never computes them. Every fact
 * is derived on read — the newest completed main CI run, the running build
 * against it, the gate queue, the next train batch, release tags and today's
 * first-parent PR merges — and nothing is stored. Two in-memory memos keep the
 * 5 s page poll cheap (D6, NFR-5): the whole result per project root for 30 s,
 * and the forge read for 60 s. Any sub-read that fails nulls its own field
 * only. Git runs through promisified `execFile`, never a sync child (NFR-3).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { FlywheelHealth, FlywheelShippedEvent, FlywheelShippedMerge } from '@overdeck/contracts';

import type { QualityGateQueueSnapshot } from '../cloister/quality-gate-admission.js';
import { getBuildInfo } from '../deploy/build-info.js';
import type { RestartStatus } from '../restart-status.js';

const execFileAsync = promisify(execFile);

/** Whole-result memo per project root (D6). */
export const FLYWHEEL_HEALTH_MEMO_MS = 30_000;
/** Forge (main CI) memo per repo and branch (D6, NFR-5). */
export const FLYWHEEL_MAIN_CI_MEMO_MS = 60_000;

export interface FlywheelNextBatch {
  name: string;
  status: string;
  members: readonly string[];
  createdAt: string;
}

export interface FlywheelHealthDeps {
  /** `git -C <projectRoot> <args>`; resolves stdout, rejects on a non-zero exit. */
  git?: (args: readonly string[]) => Promise<string>;
  ghApi?: (path: string) => Promise<unknown>;
  githubRepo?: () => string | null | Promise<string | null>;
  defaultBranch?: () => string | Promise<string>;
  buildCommit?: () => string | null;
  readGateQueue?: () => Promise<QualityGateQueueSnapshot>;
  nextBatch?: () => FlywheelNextBatch | null | Promise<FlywheelNextBatch | null>;
  batchingPausedUntil?: () => string | null | Promise<string | null>;
  restartEvents?: () => readonly RestartStatus[] | Promise<readonly RestartStatus[]>;
  trackerTitle?: (issueId: string) => string | null | Promise<string | null>;
  now?: () => number;
}

export interface FlywheelHealthResult {
  health: FlywheelHealth;
  shipped: { merges: FlywheelShippedMerge[]; events: FlywheelShippedEvent[] };
}

// ─── memos (derived caches, not status: NFR-1) ───────────────────────────────

const healthMemo = new Map<string, { at: number; value: Promise<FlywheelHealthResult> }>();
const mainCiMemo = new Map<string, { at: number; value: Promise<FlywheelHealth['mainCi']> }>();

/** Test seam: forget every memoized read. */
export function resetFlywheelHealthMemo(): void {
  healthMemo.clear();
  mainCiMemo.clear();
}

// ─── lazy defaults ───────────────────────────────────────────────────────────

function defaultGit(projectRoot: string): (args: readonly string[]) => Promise<string> {
  return async (args) => (await execFileAsync('git', ['-C', projectRoot, ...args], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 15_000,
  })).stdout;
}

async function defaultGhApi(path: string): Promise<unknown> {
  const { projectCiGhApi } = await import('../ci/project-ci-github.js');
  return projectCiGhApi(path);
}

async function projectConfig(projectRoot: string) {
  const { findProjectByPath } = await import('../projects.js');
  return findProjectByPath(projectRoot);
}

function defaultBuildCommit(): string | null {
  return getBuildInfo().buildCommit;
}

async function defaultReadGateQueue(): Promise<QualityGateQueueSnapshot> {
  const { readQualityGateQueue } = await import('../cloister/quality-gate-admission.js');
  return readQualityGateQueue();
}

/** Same name test as `isWindowBatch` in the server's merge-train batching. */
const WINDOW_BATCH_RE = /^uat\/[a-z0-9]+-train-/i;

async function defaultNextBatch(projectRoot: string): Promise<FlywheelNextBatch | null> {
  const { listUatGenerations } = await import('../overdeck/merge-sync.js');
  const gen = listUatGenerations({ projectRoot, statuses: ['assembling', 'ready'], limit: 20 })
    .find((candidate) => WINDOW_BATCH_RE.test(candidate.name));
  return gen
    ? { name: gen.name, status: gen.status, members: gen.members.map((member) => member.issueId.toUpperCase()), createdAt: gen.createdAt }
    : null;
}

async function defaultBatchingPausedUntil(projectRoot: string): Promise<string | null> {
  const { projectBatchCiPausedUntil } = await import('../cloister/merge-route.js');
  return projectBatchCiPausedUntil(projectRoot);
}

async function defaultRestartEvents(): Promise<readonly RestartStatus[]> {
  const { readRestartEvents } = await import('../restart-status.js');
  return readRestartEvents();
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function attempt<T>(read: () => T | Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

/** Local midnight of `nowMs` on the server host (H5). */
export function localMidnightIso(nowMs: number): string {
  const midnight = new Date(nowMs);
  midnight.setHours(0, 0, 0, 0);
  return midnight.toISOString();
}

const PR_MERGE_RE = /\(#(\d+)\)\s*$/;
const ISSUE_ID_RE = /\b[A-Z]+-\d+\b/;
const SEP = '\x1f';

interface WorkflowRunsResponse {
  workflow_runs?: Array<{ conclusion?: string | null; head_sha?: string; html_url?: string; updated_at?: string }>;
}

async function readMainCi(
  repo: string,
  branch: string,
  ghApi: (path: string) => Promise<unknown>,
  nowMs: number,
): Promise<FlywheelHealth['mainCi']> {
  const key = `${repo}#${branch}`;
  const cached = mainCiMemo.get(key);
  if (cached && nowMs - cached.at < FLYWHEEL_MAIN_CI_MEMO_MS) return cached.value;
  const value = (async () => {
    const response = await ghApi(
      `repos/${repo}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(branch)}&event=push&status=completed&per_page=1`,
    ) as WorkflowRunsResponse;
    const run = response.workflow_runs?.[0];
    if (!run?.head_sha) return null;
    return {
      conclusion: run.conclusion ?? 'unknown',
      sha: run.head_sha,
      url: run.html_url ?? null,
      at: run.updated_at ?? new Date(nowMs).toISOString(),
    };
  })().catch(() => null);
  mainCiMemo.set(key, { at: nowMs, value });
  return value;
}

// ─── the deriver ─────────────────────────────────────────────────────────────

/**
 * Health strip and shipped-today facts for the project (D7, D8, D12, D13).
 * Memoized 30 s per project root; concurrent callers share one read.
 */
export async function deriveFlywheelHealth(options: {
  projectRoot: string;
  deps?: FlywheelHealthDeps;
}): Promise<FlywheelHealthResult> {
  const deps = options.deps ?? {};
  const nowMs = (deps.now ?? Date.now)();
  const cached = healthMemo.get(options.projectRoot);
  if (cached && nowMs - cached.at < FLYWHEEL_HEALTH_MEMO_MS) return cached.value;
  const value = computeHealth(options.projectRoot, deps, nowMs);
  healthMemo.set(options.projectRoot, { at: nowMs, value });
  // A rejected read must not be served for 30 s.
  value.catch(() => healthMemo.delete(options.projectRoot));
  return value;
}

async function computeHealth(projectRoot: string, deps: FlywheelHealthDeps, nowMs: number): Promise<FlywheelHealthResult> {
  const git = deps.git ?? defaultGit(projectRoot);
  const [repo, branch] = await Promise.all([
    attempt(async () => deps.githubRepo ? deps.githubRepo() : (await projectConfig(projectRoot))?.github_repo ?? null, null),
    attempt(async () => deps.defaultBranch ? deps.defaultBranch() : (await projectConfig(projectRoot))?.workspace?.default_branch ?? 'main', 'main'),
  ]);
  const buildCommit = (deps.buildCommit ?? defaultBuildCommit)();
  const midnight = localMidnightIso(nowMs);
  const midnightMs = Date.parse(midnight);
  const mainRef = `origin/${branch}`;

  const [mainCi, deployApplies, gateQueue, nextBatch, batchingPausedUntil, restartEvents, tags, logOut] = await Promise.all([
    repo ? readMainCi(repo, branch, deps.ghApi ?? defaultGhApi, nowMs) : Promise.resolve(null),
    // D13: deploy facts apply only when the running build is a commit of this repo.
    buildCommit ? git(['cat-file', '-e', `${buildCommit}^{commit}`]).then(() => true, () => false) : Promise.resolve(false),
    attempt<QualityGateQueueSnapshot | null>(() => (deps.readGateQueue ?? defaultReadGateQueue)(), null),
    attempt(() => (deps.nextBatch ?? (() => defaultNextBatch(projectRoot)))(), null),
    attempt(() => (deps.batchingPausedUntil ?? (() => defaultBatchingPausedUntil(projectRoot)))(), null),
    attempt<readonly RestartStatus[]>(() => (deps.restartEvents ?? defaultRestartEvents)(), []),
    attempt(() => git(['for-each-ref', '--sort=-creatordate', '--count=20', '--format=%(refname:short)%1f%(creatordate:iso-strict)', 'refs/tags/v*']), ''),
    attempt<string | null>(() => git(['log', mainRef, '--first-parent', `--since=${midnight}`, `--format=%H${SEP}%cI${SEP}%s`]), null),
  ]);

  const notDeployed = deployApplies && buildCommit
    ? await attempt<Set<string> | null>(
        async () => new Set((await git(['rev-list', `${buildCommit}..${mainRef}`])).split('\n').map((line) => line.trim()).filter(Boolean)),
        null,
      )
    : null;
  const behindVerdict = deployApplies && buildCommit && mainCi?.sha
    ? await attempt<number | null>(async () => {
        const count = Number.parseInt((await git(['rev-list', '--count', `${buildCommit}..${mainCi.sha}`])).trim(), 10);
        return Number.isFinite(count) ? count : null;
      }, null)
    : null;

  const releaseUrl = (tag: string) => (repo ? `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}` : null);
  const releases = tags.split('\n').map((line) => line.split(SEP)).filter((parts) => parts[0] && parts[1])
    .map(([tag, at]) => ({ tag: tag!, at: at!, url: releaseUrl(tag!) }));

  const merges: FlywheelShippedMerge[] = [];
  for (const line of (logOut ?? '').split('\n')) {
    const [sha, at, subject] = line.split(SEP);
    if (!sha || !at || !subject) continue;
    const pr = PR_MERGE_RE.exec(subject);
    if (!pr?.[1]) continue;
    const prNumber = Number(pr[1]);
    const issueId = ISSUE_ID_RE.exec(subject)?.[0] ?? null;
    merges.push({
      sha,
      at,
      subject,
      prNumber,
      prUrl: repo ? `https://github.com/${repo}/pull/${prNumber}` : null,
      issueId,
      title: issueId && deps.trackerTitle ? await attempt(() => deps.trackerTitle!(issueId), null) : null,
      deployed: notDeployed ? !notDeployed.has(sha) : null,
    });
  }

  const since = (iso: string) => {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) && ms >= midnightMs;
  };
  const events: FlywheelShippedEvent[] = [
    ...merges.map((merge): FlywheelShippedEvent => ({ kind: 'merge', at: merge.at, merge })),
    ...(deployApplies
      ? restartEvents
          .filter((event) => event.trigger === 'pan reload' && event.success && event.phase !== 'stopping' && since(event.ts))
          .map((event): FlywheelShippedEvent => ({
            kind: 'deploy',
            at: event.ts,
            trigger: event.trigger,
            issueId: event.issueId ?? null,
            initiator: event.initiator ?? null,
          }))
      : []),
    ...releases.filter((release) => since(release.at))
      .map((release): FlywheelShippedEvent => ({ kind: 'release', at: release.at, tag: release.tag, url: release.url })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return {
    health: {
      mainCi,
      deployed: deployApplies && buildCommit ? { buildCommit, behindVerdict } : null,
      gateQueue: gateQueue
        ? {
            running: gateQueue.owners.length,
            queued: gateQueue.waiters.length,
            slots: gateQueue.slots,
            oldestWaitSince: gateQueue.waiters[0] ? new Date(gateQueue.waiters[0].createdAt).toISOString() : null,
          }
        : { running: 0, queued: 0, slots: 0, oldestWaitSince: null },
      nextBatch: nextBatch ? { ...nextBatch, members: [...nextBatch.members] } : null,
      batchingPausedUntil,
      lastRelease: releases[0] ?? null,
    },
    shipped: { merges, events },
  };
}
