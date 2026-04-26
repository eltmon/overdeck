import { jsonResponse } from "../http-helpers.js";
/**
 * Command Deck route module — Effect HttpRouter.Layer (PAN-428 B13)
 *
 * Implements all /api/command-deck/* endpoints from the Express server:
 *   GET  /api/command-deck/activity/:issueId
 *   GET  /api/command-deck/planning/:issueId
 *   POST /api/command-deck/planning/:issueId/status-review
 *   POST /api/command-deck/planning/:issueId/upload
 *   POST /api/command-deck/planning/:issueId/sync-discussions
 *   POST /api/command-deck/planning/:issueId/init
 *   GET  /api/command-deck/projects
 */

import { exec, execFile } from 'node:child_process';
import {
  access,
  readFile,
  readdir,
  stat,
  mkdir,
  writeFile,
  unlink,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { EventStoreService } from '../services/domain-services.js';

import { getAgentRuntimeStateAsync } from '../../../lib/agents.js';
import { syncCache, getCostsForIssue } from '../../../lib/costs/index.js';
import { capturePaneAsync, listSessionNamesAsync } from '../../../lib/tmux.js';
import { withConcurrencyLimit } from '../../../lib/concurrency.js';
import { SessionNodePresence } from '@panopticon/contracts';
import { findPrdAtStatus, type PrdLocation } from '../../../lib/prd-locations.js';
import { resolveProjectFromIssue, listProjects } from '../../../lib/projects.js';
import { extractPrefix, parseIssueId } from '../../../lib/issue-id.js';
import { getTmuxSessionName } from '../../../lib/cloister/specialists.js';
import { loadSettingsApi } from '../../../lib/settings-api.js';
import { getAgentCommand } from '../../../lib/settings.js';
import { getReviewStatus } from '../review-status.js';
import { getGitHubConfig } from '../services/tracker-config.js';
import { LinearClient } from '../services/linear-client.js';
import { IssueDataService } from '../services/issue-data-service.js';
import { httpHandler } from './http-handler.js';
import { resolveJsonlPath } from './jsonl-resolver.js';
import { buildReviewerNodes, type ReviewerRoundMetadata } from './reviewer-tree.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ─── Shared IssueDataService (via singleton) ────────────────────────────────

async function getIssueDataService(): Promise<IssueDataService> {
  const { getSharedIssueService } = await import('../services/issue-service-singleton.js');
  return getSharedIssueService();
}

// ─── Async FS helpers ─────────────────────────────────────────────────────────

/** Returns true if the path exists (any type). */
async function pathExists(p: string): Promise<boolean> {
  return access(p).then(() => true, () => false);
}

/** Read a file or return null if not found. */
async function readOptional(p: string): Promise<string | null> {
  return readFile(p, 'utf-8').catch(() => null);
}

// ─── Local helpers ────────────────────────────────────────────────────────────

/** Cache for resolved project paths to avoid repeated sync FS calls. */
const projectPathCache = new Map<string, string>();

/** TTL cache for closed issues to avoid hammering gh CLI on every poll (~10s). */
let closedIssuesCache: { timestamp: number; data: Array<{ number: number; title: string }> } | null = null;
const CLOSED_ISSUES_TTL_MS = 120_000; // 2 minutes

function getProjectPath(issuePrefix?: string): string {
  if (!issuePrefix) return join(homedir(), 'Projects');

  const cached = projectPathCache.get(issuePrefix);
  if (cached) return cached;

  const resolved = resolveProjectFromIssue(`${issuePrefix}-1`);
  if (resolved) {
    projectPathCache.set(issuePrefix, resolved.projectPath);
    return resolved.projectPath;
  }

  const config = getGitHubConfig();
  if (config) {
    for (const { owner, repo, prefix } of config.repos) {
      const repoPrefix = prefix || repo.toUpperCase().replace(/-CLI$/, '').replace(/-/g, '');
      if (repoPrefix.toUpperCase() === issuePrefix.toUpperCase()) {
        for (const path of [
          join(homedir(), 'Projects', repo),
          join(homedir(), 'Projects', repo.replace(/-cli$/, '')),
          join(homedir(), 'Projects', owner, repo),
        ]) {
          // Sync existsSync is acceptable per CLAUDE.md for fast stat checks
          const { existsSync } = require('node:fs');
          if (existsSync(path)) {
            projectPathCache.set(issuePrefix, path);
            return path;
          }
        }
      }
    }
  }

  const fallback = join(homedir(), 'Projects');
  projectPathCache.set(issuePrefix, fallback);
  return fallback;
}

/**
 * Extract reviewer role from tmux session name (PAN-830).
 * Re-exported from reviewer-tree.ts; supports both the canonical
 * `specialist-<projectKey>-<issueId>-review-<role>` pattern AND the legacy
 * `review-<issueId>-<timestamp>-<role>` pattern.
 */
export { extractReviewerRole } from './reviewer-tree.js';

/**
 * Derive session presence from runtime state, tmux session existence, and heartbeat.
 * Aligns with Cloister's stuck-detection signals (heartbeat freshness + runtime state).
 */
async function derivePresence(
  agentId: string,
  rtState: { state: string } | null,
  tmuxSessionNames: Set<string>,
): Promise<SessionNodePresence> {
  const hasTmux = tmuxSessionNames.has(agentId);
  if (!hasTmux) return 'ended';

  if (!rtState) return 'idle';

  if (rtState.state === 'active') return 'active';
  if (rtState.state === 'idle' || rtState.state === 'waiting-on-human') {
    // Supplemental checks: heartbeat or output.log mtime within 5s indicates
    // recent activity that may not yet be reflected in the in-process state mirror.
    const heartbeatPath = join(homedir(), '.panopticon', 'heartbeats', `${agentId}.json`);
    const hbStat = await stat(heartbeatPath).catch(() => null);
    if (hbStat && (Date.now() - hbStat.mtime.getTime()) < 5000) {
      return 'active';
    }
    const logPath = join(homedir(), '.panopticon', 'agents', agentId, 'output.log');
    const logStat = await stat(logPath).catch(() => null);
    if (logStat && (Date.now() - logStat.mtime.getTime()) < 5000) {
      return 'active';
    }
    return 'idle';
  }

  return 'ended';
}

// resolveJsonlPath is imported from ./jsonl-resolver (PAN-830).

// Read the request body as unknown JSON
const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
});

// ─── Route: GET /api/command-deck/activity/:issueId ───────────────────────

const getMissionControlActivityRoute = HttpRouter.add(
  'GET',
  '/api/command-deck/activity/:issueId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    const result = yield* Effect.tryPromise({
      try: () => fetchActivityData(issueId),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    return jsonResponse(result);
  })),
);

export interface ActivityContext {
  tmuxSessionNames?: Set<string>;
  taskFileContents?: Map<string, string>;
}

export async function fetchActivityData(issueId: string): Promise<unknown> {
  return fetchActivityDataWithContext(issueId, {});
}

export async function fetchActivityDataWithContext(
  issueId: string,
  context: ActivityContext = {},
): Promise<unknown> {
  const issueLower = issueId.toLowerCase();
  const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];

  // Use shared tmux session names if provided, else fetch once (PAN-821)
  const tmuxSessionNames = context.tmuxSessionNames ?? new Set<string>();
  if (!context.tmuxSessionNames) {
    try {
      const allSessions = await listSessionNamesAsync();
      for (const s of allSessions) {
        if (s.trim()) tmuxSessionNames.add(s.trim());
      }
    } catch { /* tmux may not be available */ }
  }

  const sections: Array<{
    type: string;
    role?: string;
    sessionId: string;
    tmuxSession?: string;
    model: string;
    startedAt: string;
    endedAt?: string;
    duration: number | null;
    status: string;
    transcript?: string;
    presence: SessionNodePresence;
    hasJsonl?: boolean;
    roundMetadata?: ReviewerRoundMetadata;
  }> = [];

  // Shared workspace path for JSONL resolution (PAN-821)
  const projectPath = getProjectPath(issuePrefix);
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);

  const agentId = `agent-${issueLower}`;
  const planningAgentId = `planning-${issueLower}`;
  const agentsDir = join(homedir(), '.panopticon', 'agents');

  let hasPlanningSection = false;

  for (const checkId of [planningAgentId, agentId]) {
    const agentDir = join(agentsDir, checkId);
    if (!await pathExists(agentDir)) continue;

    const stateText = await readOptional(join(agentDir, 'state.json'));
    if (!stateText) continue;

    try {
      const state = JSON.parse(stateText) as { model?: string; runtime?: string; startedAt?: string; createdAt?: string; status?: string };
      const isPlanning = checkId.startsWith('planning-');
      const sectionType = isPlanning ? 'planning' : 'work';
      if (isPlanning) hasPlanningSection = true;

      let transcript = '';
      try {
        transcript = (await capturePaneAsync(checkId, 500)).trim();
      } catch { /* agent may not be running */ }

      if (!isPlanning && !transcript) {
        const logText = await readOptional(join(agentDir, 'output.log'));
        if (logText) transcript = logText;
      }

      if (isPlanning && !transcript) {
        const projectPath = getProjectPath(issuePrefix);
        const stateMdText = await readOptional(join(projectPath, 'workspaces', `feature-${issueLower}`, '.planning', 'STATE.md'));
        if (stateMdText) transcript = `PLANNING COMPLETE\n\n${stateMdText}`;
      }

      const rtState = await getAgentRuntimeStateAsync(checkId);
      const presence = await derivePresence(checkId, rtState, tmuxSessionNames);

      // Resolve JSONL path for conversation rendering (PAN-821)
      const jsonlPath = await resolveJsonlPath(checkId, workspacePath);

      // Only expose interactive terminal for work/planning sessions (PAN-821 review)
      const exposeInteractiveTerminal = sectionType === 'work' || sectionType === 'planning';

      sections.push({
        type: sectionType,
        sessionId: checkId,
        model: state.model || state.runtime || 'unknown',
        startedAt: state.startedAt || state.createdAt || new Date().toISOString(),
        duration: state.startedAt ? (() => {
          const ms = Date.now() - new Date(state.startedAt).getTime();
          return isNaN(ms) ? null : Math.floor(ms / 1000);
        })() : null,
        status: rtState?.state === 'active' ? 'running' : rtState?.state === 'suspended' ? 'completed' : (state.status || 'completed'),
        transcript: jsonlPath ? undefined : transcript,
        presence,
        hasJsonl: !!jsonlPath,
        tmuxSession: exposeInteractiveTerminal ? checkId : undefined,
      });
    } catch { /* skip malformed state */ }
  }

  // If no planning agent but STATE.md exists, create synthetic planning section
  if (!hasPlanningSection) {
    const stateMdPath = join(workspacePath, '.planning', 'STATE.md');
    const stateMdText = await readOptional(stateMdPath);
    if (stateMdText) {
      const fileStat = await stat(stateMdPath).catch(() => null);
      const sessionId = `planning-${issueLower}-state`;
      const jsonlPath = await resolveJsonlPath(sessionId, workspacePath);
      sections.push({
        type: 'legacy',
        sessionId,
        model: 'unknown',
        startedAt: (fileStat?.birthtime && !isNaN(fileStat.birthtime.getTime()) ? fileStat.birthtime.toISOString() : undefined)
          || fileStat?.mtime?.toISOString()
          || new Date().toISOString(),
        duration: null,
        status: 'completed',
        transcript: jsonlPath ? undefined : `PLANNING COMPLETE\n\n${stateMdText}`,
        presence: 'ended',
        hasJsonl: !!jsonlPath,
      });
    }
  }

  // Build specialist sections from review-status history
  const centralStatus = getReviewStatus(issueId.toUpperCase());
  if (centralStatus?.history && centralStatus.history.length > 0) {
    const tasksDir = join(homedir(), '.panopticon', 'specialists', 'tasks');
    const taskFilesByType: Record<string, string[]> = { review: [], test: [], merge: [] };

    // Use shared task file contents if provided, else read once and cache (PAN-821)
    let taskFileContents = context.taskFileContents;
    if (!taskFileContents) {
      taskFileContents = new Map<string, string>();
      if (await pathExists(tasksDir)) {
        const filenames = (await readdir(tasksDir).catch(() => [] as string[])).filter(f => f.endsWith('.md'));
        await Promise.all(filenames.map(async (f) => {
          const content = await readOptional(join(tasksDir, f));
          if (content) taskFileContents!.set(f, content);
        }));
      }
    }

    for (const [f, content] of taskFileContents) {
      if (content.includes(issueId.toUpperCase()) || content.includes(issueId)) {
        if (f.startsWith('review-agent')) taskFilesByType.review!.push(f);
        else if (f.startsWith('test-agent')) taskFilesByType.test!.push(f);
        else if (f.startsWith('merge-agent')) taskFilesByType.merge!.push(f);
      }
    }
    for (const type of Object.keys(taskFilesByType)) {
      taskFilesByType[type]!.sort();
    }

    const typeMap: Record<string, string> = { review: 'review', test: 'test', merge: 'merge' };
    let currentSection: { type: string; startedAt: string; endedAt?: string; status: string; notes?: string } | null = null;
    const specialistSections: Array<NonNullable<typeof currentSection>> = [];

    for (const entry of centralStatus.history) {
      const sectionType = typeMap[entry.type] || entry.type;
      if (entry.status === 'reviewing' || entry.status === 'testing' || entry.status === 'merging') {
        currentSection = { type: sectionType, startedAt: entry.timestamp, status: 'running' };
      } else if (currentSection && currentSection.type === sectionType) {
        currentSection.endedAt = entry.timestamp;
        currentSection.status = entry.status === 'passed' ? 'completed' : entry.status === 'failed' ? 'failed' : 'completed';
        currentSection.notes = (entry as { notes?: string }).notes;
        specialistSections.push(currentSection);
        currentSection = null;
      } else {
        specialistSections.push({
          type: sectionType,
          startedAt: entry.timestamp,
          status: entry.status === 'passed' ? 'completed' : entry.status === 'failed' ? 'failed' : 'completed',
          notes: (entry as { notes?: string }).notes,
        });
      }
    }
    if (currentSection) specialistSections.push(currentSection);

    const taskFileIndex: Record<string, number> = { review: 0, test: 0, merge: 0 };

    // PAN-830: Reviewer panes are canonical (`specialist-<projectKey>-<issueId>-review-<role>`)
    // and persist across review rounds, so we emit exactly five reviewer nodes
    // (one per role) anchored to the *most recent* review section in history.
    // Earlier review sections are skipped to avoid duplicate role nodes.
    const lastReviewIndex = specialistSections.reduce(
      (idx, s, i) => (s.type === 'review' ? i : idx),
      -1,
    );
    const resolvedProject = resolveProjectFromIssue(issueId);
    const reviewerProjectKey = resolvedProject?.projectKey ?? issuePrefix.toLowerCase();

    for (let i = 0; i < specialistSections.length; i++) {
      const ss = specialistSections[i]!;
      const duration = ss.startedAt && ss.endedAt
        ? Math.floor((new Date(ss.endedAt).getTime() - new Date(ss.startedAt).getTime()) / 1000)
        : null;

      const transcriptParts: string[] = [];
      const statusLabel = ss.status === 'completed' ? 'PASSED' : ss.status === 'running' ? 'IN PROGRESS...' : ss.status.toUpperCase();
      transcriptParts.push(`${ss.type.toUpperCase()} ${statusLabel}`);

      const taskFiles = taskFilesByType[ss.type] || [];
      const taskIdx = taskFileIndex[ss.type] || 0;
      if (taskIdx < taskFiles.length) {
        const taskContent = await readOptional(join(tasksDir, taskFiles[taskIdx]!));
        if (taskContent) {
          const meaningfulLines = taskContent.split('\n').filter(l =>
            !l.startsWith('```') && !l.startsWith('# EXECUTE') && !l.startsWith('⚠️')
          );
          transcriptParts.push(`\n--- Task ---\n${meaningfulLines.slice(0, 5).join('\n')}`);
        }
        taskFileIndex[ss.type] = taskIdx + 1;
      }

      if (ss.status === 'running') {
        const ageMs = Date.now() - new Date(ss.startedAt).getTime();
        const STALE_THRESHOLD_MS = 30 * 60 * 1000;

        if (ageMs > STALE_THRESHOLD_MS) {
          ss.status = 'completed';
          transcriptParts[0] = `${ss.type.toUpperCase()} TIMED OUT (no result recorded)`;
        }
      }

      if (ss.notes) {
        transcriptParts.push(`\n--- Results ---\n${ss.notes}`);
      }

      // PAN-830: For review sections, emit the five canonical reviewer nodes
      // exactly once (anchored to the latest review section in history). Earlier
      // review sections are absorbed into the round metadata read from
      // `~/.panopticon/agents/<reviewer-id>/round-N.json`.
      if (ss.type === 'review') {
        if (i !== lastReviewIndex) continue;
        const reviewerNodes = await buildReviewerNodes({
          issueId,
          projectKey: reviewerProjectKey,
          workspacePath,
          tmuxSessionNames,
          startedAt: ss.startedAt,
          endedAt: ss.endedAt,
          status: ss.status,
        });
        for (const node of reviewerNodes) sections.push(node);
        continue;
      }

      // Normal handling for non-review types
      if (ss.status === 'running') {
        const tmuxName = `specialist-${ss.type === 'test' ? 'test-agent' : 'merge-agent'}`;
        try {
          const output = (await capturePaneAsync(tmuxName, 100)).trim();
          if (output && (output.includes(issueId.toUpperCase()) || output.includes(issueId) || output.includes(issueLower))) {
            transcriptParts.push(`\n--- Live Output ---\n${output}`);
          } else if (output) {
            transcriptParts.push(`\n--- Waiting ---\nSpecialist is processing another issue. Will update when it reaches ${issueId}.`);
          }
        } catch { /* specialist may not be running */ }
      }

      let tmuxSessionName: string | undefined;
      if (ss.status === 'running') {
        const specialistType = ss.type === 'test' ? 'test-agent' : 'merge-agent';
        const resolved = resolveProjectFromIssue(issueId);
        tmuxSessionName = getTmuxSessionName(specialistType as never, resolved?.projectKey);
      }

      const specialistPresence: SessionNodePresence = tmuxSessionName && tmuxSessionNames.has(tmuxSessionName)
        ? (ss.status === 'running' ? 'active' : 'idle')
        : 'ended';
      const specialistSessionId = `specialist-${ss.type}-${ss.startedAt}`;
      const specialistJsonlPath = await resolveJsonlPath(specialistSessionId, workspacePath);

      // Do NOT expose tmuxSession for specialist sessions — they are autonomous
      // and should not be interactively attached (PAN-821 review)
      sections.push({
        type: ss.type,
        sessionId: specialistSessionId,
        model: 'specialist',
        startedAt: ss.startedAt,
        duration,
        status: ss.status,
        transcript: specialistJsonlPath ? undefined : transcriptParts.join('\n'),
        presence: specialistPresence,
        hasJsonl: !!specialistJsonlPath,
      });
    }
  }

  sections.sort((a, b) => {
    if (!a.startedAt) return 1;
    if (!b.startedAt) return -1;
    return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
  });

  // Cost breakdown
  let costByStage: Record<string, { cost: number; tokens: number }> = {};
  let totalCost = 0;
  try {
    syncCache();
    const issueData = getCostsForIssue(issueId.toUpperCase());
    if (issueData) {
      totalCost = issueData.totalCost;
      costByStage = Object.fromEntries(
        Object.entries(issueData.stages || {}).map(([stage, stats]) => [stage, { cost: stats.cost, tokens: stats.tokens }])
      );
    }
  } catch { /* cost data optional */ }

  return { issueId, sections, costByStage, totalCost };
}

// ─── Route: GET /api/command-deck/planning/:issueId ───────────────────────

const getMissionControlPlanningRoute = HttpRouter.add(
  'GET',
  '/api/command-deck/planning/:issueId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';

    const result = yield* Effect.tryPromise({
      try: () => fetchPlanningData(issueId),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    return jsonResponse(result);
  })),
);

async function fetchPlanningData(issueId: string): Promise<unknown> {
  const issueLower = issueId.toLowerCase();
  const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];

  const projectPath = getProjectPath(issuePrefix);
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
  const planningDir = join(workspacePath, '.planning');

  const result: {
    prd?: string;
    state?: string;
    inference?: string;
    statusReview?: string;
    statusReviewedAt?: string;
    transcripts: Array<{ filename: string; content: string; uploadedAt: string }>;
    discussions: Array<{ filename: string; content: string; syncedAt: string }>;
    notes: Array<{ filename: string; content: string; uploadedAt: string }>;
  } = { transcripts: [], discussions: [], notes: [] };

  // Helper: read PRD content from a location, handling both flat and subdir formats.
  const readPrdContent = async (loc: PrdLocation | null): Promise<string | undefined> => {
    if (!loc) return undefined;
    if (loc.format === 'flat') {
      return (await readOptional(loc.path)) ?? undefined;
    }
    // Subdirectory format: STATE.md is the human-readable PRD content.
    return (await readOptional(join(loc.path, 'STATE.md'))) ?? undefined;
  };

  if (!await pathExists(planningDir)) {
    const prd = await readPrdContent(findPrdAtStatus(projectPath, issueId, 'active'));
    if (prd) result.prd = prd;
    return result;
  }

  result.state = await readOptional(join(planningDir, 'STATE.md')) ?? undefined;
  result.inference = await readOptional(join(planningDir, 'INFERENCE.md')) ?? undefined;

  const statusReviewPath = join(planningDir, 'STATUS_REVIEW.md');
  const statusReview = await readOptional(statusReviewPath);
  if (statusReview) {
    result.statusReview = statusReview;
    const fileStat = await stat(statusReviewPath).catch(() => null);
    if (fileStat) result.statusReviewedAt = fileStat.mtime.toISOString();
  }

  if (!result.prd) {
    for (const status of ['active', 'planned', 'completed'] as const) {
      const content = await readPrdContent(findPrdAtStatus(projectPath, issueId, status));
      if (content) {
        result.prd = content;
        break;
      }
    }
  }

  if (!result.prd && result.state) result.prd = result.state;

  const readArtifactDir = async (subdir: string, dateField: string): Promise<Array<{ filename: string; content: string; [key: string]: string }>> => {
    const dirPath = join(planningDir, subdir);
    if (!await pathExists(dirPath)) return [];
    const files = (await readdir(dirPath).catch(() => [] as string[])).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
    const entries = await Promise.all(files.map(async (filename) => {
      const filePath = join(dirPath, filename);
      const [content, fileStat] = await Promise.all([
        readOptional(filePath),
        stat(filePath).catch(() => null),
      ]);
      return { filename, content: content ?? '', [dateField]: fileStat?.mtime.toISOString() ?? new Date().toISOString() };
    }));
    return entries.sort((a, b) => new Date(b[dateField]!).getTime() - new Date(a[dateField]!).getTime());
  };

  result.transcripts = await readArtifactDir('transcripts', 'uploadedAt') as typeof result.transcripts;
  result.discussions = await readArtifactDir('discussions', 'syncedAt') as typeof result.discussions;
  result.notes = await readArtifactDir('notes', 'uploadedAt') as typeof result.notes;

  return result;
}

// ─── Route: POST /api/command-deck/planning/:issueId/status-review ────────

const postMissionControlStatusReviewRoute = HttpRouter.add(
  'POST',
  '/api/command-deck/planning/:issueId/status-review',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const eventStore = yield* EventStoreService;

    const result = yield* Effect.tryPromise({
      try: () => generateStatusReview(issueId),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    if (result.type === 'ok') {
      yield* eventStore.append({ type: 'planning.sync', timestamp: new Date().toISOString(), payload: { issueId, status: 'reviewing' } });
      return jsonResponse({ success: true, statusReview: result.review, reviewedAt: result.reviewedAt });
    }
    return jsonResponse(result.response, { status: result.status });
  })),
);

async function generateStatusReview(issueId: string): Promise<
  | { type: 'ok'; review: string; reviewedAt: string }
  | { type: 'err'; response: unknown; status: number }
> {
  const issueLower = issueId.toLowerCase();
  const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];

  const projectPath = getProjectPath(issuePrefix);
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
  const planningDir = join(workspacePath, '.planning');

  if (!await pathExists(planningDir)) {
    return { type: 'err', response: { error: 'No planning directory found' }, status: 404 };
  }

  const state = await readOptional(join(planningDir, 'STATE.md'));

  const readPlanningSubdir = async (subdir: string, limit = 5, maxPerFile = 2000): Promise<string> => {
    const dirPath = join(planningDir, subdir);
    if (!await pathExists(dirPath)) return '';
    const files = (await readdir(dirPath).catch(() => [] as string[])).filter((f) => f.endsWith('.md') || f.endsWith('.txt'));
    const parts = await Promise.all(files.slice(0, limit).map(async (file) => {
      const content = await readOptional(join(dirPath, file));
      return content ? `\n### ${file}\n${content.slice(0, maxPerFile)}\n` : '';
    }));
    return parts.join('');
  };

  const [discussionsContent, transcriptsContent, notesContent] = await Promise.all([
    readPlanningSubdir('discussions'),
    readPlanningSubdir('transcripts', 5, 3000),
    readPlanningSubdir('notes'),
  ]);

  let issueContext = '';
  try {
    const issueDataService = await getIssueDataService();
    const allIssues = issueDataService.getIssues();
    const issue = allIssues.find((i: Record<string, unknown>) =>
      i['identifier'] === issueId || (i['identifier'] as string)?.toLowerCase() === issueId.toLowerCase()
    ) as Record<string, unknown> | undefined;
    if (issue) {
      const assignee = issue['assignee'] as { name?: string } | undefined;
      const labels = issue['labels'] as string[] | undefined;
      issueContext = `- **Title**: ${issue['title']}\n- **Status**: ${issue['rawTrackerState'] || issue['status']}\n- **Assignee**: ${assignee?.name || 'Unassigned'}\n- **Source**: ${issue['source']}`;
      if (labels?.length) issueContext += `\n- **Labels**: ${labels.join(', ')}`;
      const children = allIssues.filter((i: Record<string, unknown>) => i['parentRef'] === issueId) as Record<string, unknown>[];
      if (children.length > 0) {
        const done = children.filter((c) => c['status'] === 'Done').length;
        const inProgress = children.filter((c) => c['status'] === 'In Progress').length;
        issueContext += `\n- **Child Stories**: ${children.length} total, ${done} done, ${inProgress} in progress\n\n**Story Breakdown:**\n`;
        for (const child of children.slice(0, 20)) {
          issueContext += `  - ${child['identifier']}: ${child['title']} [${child['rawTrackerState'] || child['status']}]\n`;
        }
      }
    }
  } catch { /* skip if issue data unavailable */ }

  const hasAnyContent = state || discussionsContent || transcriptsContent || notesContent || issueContext;
  if (!hasAnyContent) {
    return { type: 'err', response: { error: 'No planning artifacts, discussions, transcripts, or issue data to review against' }, status: 400 };
  }

  const execSafe = async (cmd: string, opts?: Parameters<typeof execAsync>[1]) => {
    try {
      const { stdout } = await execAsync(cmd, { encoding: 'utf-8', timeout: 10000, ...opts });
      return stdout;
    } catch { return ''; }
  };

  const [gitDiff, gitDiffFull, gitLog, filesChanged] = await Promise.all([
    execSafe(`cd "${workspacePath}" && git diff --stat main 2>/dev/null || git diff --stat HEAD~5 2>/dev/null || echo "No git diff available"`),
    execSafe(`cd "${workspacePath}" && git diff main 2>/dev/null || git diff HEAD~5 2>/dev/null || echo ""`, { timeout: 15000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf-8' }),
    execSafe(`cd "${workspacePath}" && git log --oneline -20 2>/dev/null || echo "No git log available"`),
    execSafe(`cd "${workspacePath}" && git diff --name-only main 2>/dev/null || git diff --name-only HEAD~5 2>/dev/null || echo "No files changed"`),
  ]);

  const centralReviewStatus = getReviewStatus(issueId.toUpperCase());
  const reviewStatus = centralReviewStatus?.reviewStatus || 'unknown';
  const testStatus = centralReviewStatus?.testStatus || 'unknown';

  const { createHash } = await import('crypto');
  const contentHash = createHash('md5')
    .update([state, discussionsContent, transcriptsContent, notesContent, issueContext, gitDiff, gitDiffFull, gitLog, filesChanged, reviewStatus, testStatus].filter(Boolean).join('|'))
    .digest('hex');

  const hashPath = join(planningDir, '.status-review-hash');
  const statusReviewPath = join(planningDir, 'STATUS_REVIEW.md');

  const [savedHash, cachedReview] = await Promise.all([readOptional(hashPath), readOptional(statusReviewPath)]);
  if (savedHash?.trim() === contentHash && cachedReview) {
    const fileStat = await stat(statusReviewPath).catch(() => null);
    console.log(`[status-review] ${issueId}: no changes detected, returning cached review`);
    return { type: 'ok', review: cachedReview, reviewedAt: fileStat?.mtime.toISOString() ?? new Date().toISOString() };
  }

  const now = new Date().toISOString();
  let review: string;

  const analysisPrompt = `You are a senior technical project manager producing an executive-quality status review of a software feature. This review will be read by engineering leadership and executives to understand the current state of this work.

## Issue: ${issueId}
${issueContext ? `\n${issueContext}\n` : ''}
## Pipeline Status
- Review: ${reviewStatus}
- Tests: ${testStatus}

## STATE.md (Planning Context and Progress Notes)
${state ? state.slice(0, 4000) : '(No STATE.md available)'}

## Files Changed
${filesChanged.slice(0, 2000) || 'No changes detected'}

## Git Diff Summary (stats)
${gitDiff.slice(0, 3000) || 'No diff available'}

## Actual Code Changes
${gitDiffFull.slice(0, 15000) || '(No code diff available)'}

## Recent Commits
${gitLog.slice(0, 2000) || 'No commits yet'}

## Discussions & Comments
${discussionsContent || '(No discussions synced)'}

## Meeting Transcripts
${transcriptsContent || '(No transcripts uploaded)'}

## Notes
${notesContent || '(No notes uploaded)'}

---

**IMPORTANT**: Perform a THOROUGH analysis. Cross-reference the actual code changes against the PRD requirements, discussions, and transcripts. Don't just summarize — evaluate whether the implementation correctly addresses each requirement.

Produce a comprehensive status review in markdown format with these sections:

1. **Summary** (2-3 sentences: overall progress, percentage complete estimate, what's done, what's remaining)
2. **Requirements Coverage** (cross-reference EACH PRD requirement against the actual code changes — which requirements are fully implemented, partially implemented, or not yet started. Use a table with columns: Requirement | Status | Evidence. If no PRD, infer requirements from discussions/transcripts/issue tracker data)
3. **Code Quality Assessment** (based on actual code changes: are there any concerns about implementation quality, error handling, test coverage, missing edge cases, security issues?)
4. **Risk Assessment** (blockers, missing tests, incomplete features, concerns from discussions, timeline risks)
5. **Key Decisions & Context** (important points from discussions, transcripts, or notes that affect the work — decisions made, open questions, stakeholder feedback)
6. **Recommendation** (specific next steps, whether it's ready for review/merge, or exactly what needs attention before it can progress)

Be specific: reference actual file names, function names, requirement text, discussion quotes, and transcript highlights. This review should give a reader who hasn't seen the code a clear picture of exactly where things stand.`;

  const apiSettings = loadSettingsApi();
  const statusModelId = (apiSettings.models?.overrides as Record<string, string>)?.['status-review']
    || 'claude-sonnet-4-6';
  const { command: cliCmd, args: cliArgs } = getAgentCommand(statusModelId);
  const modelFlag = cliArgs.length > 0 ? ` ${cliArgs.join(' ')}` : '';
  const promptFile = join(planningDir, '.status-review-prompt.tmp');

  // Build provider env vars for non-Anthropic models
  const { getProviderForModel, getProviderEnv } = await import('../../../lib/providers.js');
  const { loadConfig: loadYamlConfig } = await import('../../../lib/config-yaml.js');
  let providerEnvStr = '';
  const statusProvider = getProviderForModel(statusModelId);
  if (statusProvider.name !== 'anthropic') {
    const { config } = loadYamlConfig();
    const apiKey = config.apiKeys[statusProvider.name as keyof typeof config.apiKeys];
    if (apiKey) {
      const envVars = getProviderEnv(statusProvider, apiKey);
      providerEnvStr = Object.entries(envVars).map(([k, v]) => `${k}="${v}"`).join(' ') + ' ';
    }
  }

  await writeFile(promptFile, analysisPrompt, 'utf-8');
  console.log(`[status-review] ${issueId}: generating with ${providerEnvStr}${cliCmd}${modelFlag}`);

  try {
    const { stdout: aiReview } = await execAsync(
      `${providerEnvStr}cat "${promptFile}" | ${cliCmd} -p${modelFlag} --no-session-persistence`,
      { encoding: 'utf-8', timeout: 120000, maxBuffer: 1024 * 1024 }
    );
    review = `# Status Review - ${issueId}\n\n*AI-Generated: ${now}*\n\n${aiReview.trim()}\n\n---\n*Generated by Panopticon Command Deck AI*`;
  } catch (llmError: unknown) {
    const msg = llmError instanceof Error ? llmError.message : String(llmError);
    console.warn(`AI status review failed for ${issueId}, using static template:`, msg);
    review = `# Status Review - ${issueId}

*Generated: ${now}*
*Note: AI analysis unavailable (${msg}). Showing raw data.*

## Pipeline Status

| Stage | Status |
|-------|--------|
| Work | ${reviewStatus === 'unknown' ? 'In Progress' : 'Complete'} |
| Review | ${reviewStatus} |
| Tests | ${testStatus} |

## Files Changed
\`\`\`
${filesChanged.slice(0, 2000) || 'No changes detected'}
\`\`\`

## Recent Commits
\`\`\`
${gitLog.slice(0, 2000) || 'No commits yet'}
\`\`\`

## Discussions
${discussionsContent || '(No discussions synced)'}

## Transcripts
${transcriptsContent || '(No transcripts uploaded)'}

## Notes
${notesContent || '(No notes uploaded)'}

${issueContext ? `## Issue Tracker Data\n${issueContext}\n` : ''}---
*Review by Panopticon Command Deck (static fallback)*
`;
  } finally {
    await unlink(promptFile).catch(() => { /* ignore */ });
  }

  await Promise.all([
    writeFile(statusReviewPath, review, 'utf-8'),
    writeFile(hashPath, contentHash, 'utf-8'),
  ]);

  return { type: 'ok', review, reviewedAt: now };
}

// ─── Route: POST /api/command-deck/planning/:issueId/upload ────────────────

const postMissionControlUploadRoute = HttpRouter.add(
  'POST',
  '/api/command-deck/planning/:issueId/upload',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const body = yield* readJsonBody;

    const { type, filename, content } = body as { type?: string; filename?: string; content?: string };
    const issueLower = issueId.toLowerCase();
    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];

    if (!type || !filename || !content) {
      return jsonResponse({ error: 'type, filename, and content are required' }, { status: 400 });
    }
    if (!['transcript', 'note'].includes(type)) {
      return jsonResponse({ error: 'type must be transcript or note' }, { status: 400 });
    }

    let safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
    let processedContent = content;

    if (safeName.endsWith('.vtt')) {
      const { vttToMarkdown } = yield* Effect.promise(() => import('../utils/vtt-parser.js'));
      processedContent = vttToMarkdown(content);
      safeName = safeName.replace(/\.vtt$/, '.md');
    }

    const ext = safeName.endsWith('.md') || safeName.endsWith('.txt') ? '' : '.md';
    const projectPath = getProjectPath(issuePrefix);
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const subdir = type === 'transcript' ? 'transcripts' : 'notes';
    const dirPath = join(workspacePath, '.planning', subdir);

    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(dirPath, { recursive: true });
        await writeFile(join(dirPath, safeName + ext), processedContent, 'utf-8');
      },
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    return jsonResponse({ success: true, path: join(dirPath, safeName + ext) });
  })),
);

// ─── Route: POST /api/command-deck/planning/:issueId/sync-discussions ─────

const postMissionControlSyncDiscussionsRoute = HttpRouter.add(
  'POST',
  '/api/command-deck/planning/:issueId/sync-discussions',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueId(issueId)) {
      return jsonResponse({ error: 'Invalid issue id: ' + issueId }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const linear = yield* LinearClient;

    const { tracker } = body as { tracker?: string };
    const issueLower = issueId.toLowerCase();
    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];

    if (!tracker || !['github', 'linear', 'rally'].includes(tracker)) {
      return jsonResponse({ error: 'tracker must be github, linear, or rally' }, { status: 400 });
    }

    const projectPath = getProjectPath(issuePrefix);
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const discussionsDir = join(workspacePath, '.planning', 'discussions');

    yield* Effect.tryPromise({
      try: () => mkdir(discussionsDir, { recursive: true }),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    const syncedFiles: string[] = [];

    if (tracker === 'github') {
      const ghConfig = getGitHubConfig();
      if (!ghConfig) {
        return jsonResponse({ error: 'GitHub not configured' }, { status: 400 });
      }

      yield* Effect.promise(async () => {
        try {
          const issueNum = issueId.replace(/^[A-Z]+-/, '');
          const { stdout } = await execFileAsync(
            'gh',
            [
              'issue', 'view', issueNum,
              '--repo', `${ghConfig.owner}/${ghConfig.repos[0]}`,
              '--json', 'comments',
              '--jq', '.comments[] | "## " + .author.login + " (" + .createdAt + ")\n\n" + .body + "\n\n---\n"',
            ],
            { encoding: 'utf-8', timeout: 30000 }
          );
          if (stdout.trim()) {
            const filename = `github-${issueId}-comments.md`;
            await writeFile(join(discussionsDir, filename), `# GitHub Comments for ${issueId}\n\nSynced: ${new Date().toISOString()}\n\n---\n\n` + stdout, 'utf-8');
            syncedFiles.push(filename);
          }
        } catch (err) { console.warn(`Failed to sync GitHub comments for ${issueId}:`, err); }

        try {
          const { stdout: prList } = await execFileAsync(
            'gh',
            [
              'pr', 'list',
              '--repo', `${ghConfig.owner}/${ghConfig.repos[0]}`,
              '--head', `feature/${issueLower}`,
              '--json', 'number,title',
              '--jq', '.[].number',
            ],
            { encoding: 'utf-8', timeout: 15000 }
          );
          for (const prNum of prList.trim().split('\n').filter(Boolean)) {
            try {
              const { stdout: prComments } = await execFileAsync(
                'gh',
                [
                  'pr', 'view', prNum,
                  '--repo', `${ghConfig.owner}/${ghConfig.repos[0]}`,
                  '--json', 'comments',
                  '--jq', '.comments[] | "## " + .author.login + " (" + .createdAt + ")\n\n" + .body + "\n\n---\n"',
                ],
                { encoding: 'utf-8', timeout: 15000 }
              );
              if (prComments.trim()) {
                const filename = `pr-${prNum}-discussion.md`;
                await writeFile(join(discussionsDir, filename), `# PR #${prNum} Discussion\n\nSynced: ${new Date().toISOString()}\n\n---\n\n` + prComments, 'utf-8');
                syncedFiles.push(filename);
              }
            } catch { /* no PR found */ }
          }
        } catch { /* no PR list */ }
      });

    } else if (tracker === 'linear') {
      try {
        const issue = yield* linear.getIssue(issueId).pipe(Effect.catchCause(() => Effect.succeed(null)));
        if (!issue) {
          return jsonResponse({ error: 'Linear not configured or issue not found' }, { status: 400 });
        }
        const comments = yield* linear.getComments(issue.id).pipe(Effect.catchCause(() => Effect.succeed([])));
        if (comments.length > 0) {
          const filename = `linear-${issueId}-comments.md`;
          const commentBody = comments.map((c: { author: string; createdAt: string; body: string }) =>
            `## ${c.author} (${c.createdAt})\n\n${c.body}\n\n---\n`
          ).join('\n');
          yield* Effect.tryPromise({
            try: () => writeFile(join(discussionsDir, filename), `# Linear Comments for ${issueId}\n\nSynced: ${new Date().toISOString()}\n\n---\n\n` + commentBody, 'utf-8'),
            catch: (err) => new Error(String(err)),
          });
          syncedFiles.push(filename);
        }
      } catch (err) { console.warn(`Failed to sync Linear comments for ${issueId}:`, err); }

    } else if (tracker === 'rally') {
      try {
        const issueDataService = yield* Effect.tryPromise({
          try: () => getIssueDataService(),
          catch: () => null,
        });
        const allIssues = (issueDataService?.getIssues() ?? []) as Record<string, unknown>[];
        const parentFeature = allIssues.find((i) => i['source'] === 'rally' && i['identifier'] === issueId);
        const childStories = allIssues.filter((i) => i['source'] === 'rally' && i['parentRef'] === issueId);

        if (childStories.length > 0 || parentFeature) {
          const filename = `rally-${issueId}-stories.md`;
          const lines: string[] = [`# Rally Stories for ${issueId}`, '', `Synced: ${new Date().toISOString()}`, ''];

          if (parentFeature) {
            const pf = parentFeature as { title?: string; rawTrackerState?: string; status?: string; derivedStatus?: string; totalChildCount?: number; completedChildCount?: number; inProgressChildCount?: number };
            lines.push(`**Feature**: ${pf.title}`, `**Rally State**: ${pf.rawTrackerState || pf.status}`);
            if (pf.derivedStatus) lines.push(`**Derived Status**: ${pf.derivedStatus}`);
            lines.push(`**Stories**: ${pf.totalChildCount || childStories.length} total, ${pf.completedChildCount || 0} done, ${pf.inProgressChildCount || 0} active`, '');
          }

          lines.push('---', '', '## Child Stories', '');
          for (const story of childStories) {
            const s = story as { status?: string; identifier?: string; title?: string; rawTrackerState?: string; assignee?: { name?: string } };
            const statusEmoji = s.status === 'Done' ? '✅' : s.status === 'In Progress' ? '🔄' : s.status === 'In Review' ? '👀' : '⬜';
            lines.push(`- ${statusEmoji} **${s.identifier}**: ${s.title}`, `  - Status: ${s.rawTrackerState || s.status}`);
            if (s.assignee?.name) lines.push(`  - Assignee: ${s.assignee.name}`);
            lines.push('');
          }

          yield* Effect.tryPromise({
            try: () => writeFile(join(discussionsDir, filename), lines.join('\n'), 'utf-8'),
            catch: (err) => new Error(String(err)),
          });
          syncedFiles.push(filename);
        }
      } catch (err) { console.warn(`Failed to sync Rally stories for ${issueId}:`, err); }
    }

    return jsonResponse({ synced: syncedFiles.length, files: syncedFiles });
  })),
);

// ─── Route: POST /api/command-deck/planning/:issueId/init ─────────────────

const postMissionControlPlanningInitRoute = HttpRouter.add(
  'POST',
  '/api/command-deck/planning/:issueId/init',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const body = yield* readJsonBody;
    const eventStore = yield* EventStoreService;

    const { shadow } = body as { shadow?: boolean };
    const issueLower = issueId.toLowerCase();
    const issuePrefix = extractPrefix(issueId) ?? issueId.split('-')[0];

    const projectPath = getProjectPath(issuePrefix);
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const planningDir = join(workspacePath, '.planning');

    yield* Effect.tryPromise({
      try: async () => {
        await Promise.all(['transcripts', 'discussions', 'notes'].map(subdir =>
          mkdir(join(planningDir, subdir), { recursive: true })
        ));

        if (shadow) {
          const inferencePath = join(planningDir, 'INFERENCE.md');
          if (!await pathExists(inferencePath)) {
            await writeFile(inferencePath, `# Inference Document - ${issueId}\n\n*This document is maintained by the Shadow Engineering Monitoring Agent.*\n\n## Status\n\nAwaiting initial artifact analysis.\n\n## Understanding\n\n(pending)\n\n## Gaps & Risks\n\n(pending)\n`, 'utf-8');
          }
        }
      },
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });

    const sessionName = `planning-${issueLower}`;
    yield* eventStore.append({ type: 'planning.started', timestamp: new Date().toISOString(), payload: { issueId, sessionName } });
    return jsonResponse({ success: true, path: planningDir });
  })),
);

// ─── Route: GET /api/command-deck/projects ────────────────────────────────

const getMissionControlProjectsRoute = HttpRouter.add(
  'GET',
  '/api/command-deck/projects',
  httpHandler(Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () => fetchProjectTree(),
      catch: (err) => new Error(err instanceof Error ? err.message : String(err)),
    });
    return jsonResponse(result);
  })),
);

async function fetchProjectTree(): Promise<unknown[]> {
  const projects = listProjects();

  const issueTitleMap = new Map<string, string>();
  const issueStateMap = new Map<string, string>();
  let allIssues: Array<Record<string, unknown>> = [];
  try {
    const issueDataService = await getIssueDataService();
    allIssues = issueDataService.getIssues() as Array<Record<string, unknown>>;
    for (const issue of allIssues) {
      const id = issue['identifier'] as string | undefined;
      const title = issue['title'] as string | undefined;
      const state = issue['state'] as string | undefined;
      if (id && title) {
        issueTitleMap.set(id.toUpperCase(), title);
      }
      if (id && state) {
        issueStateMap.set(id.toUpperCase(), state);
      }
    }
  } catch { /* non-fatal */ }

  const tmuxResult = await listSessionNamesAsync().catch(() => [] as string[]);
  const tmuxSessions = new Set<string>();
  for (const line of tmuxResult) {
    const trimmed = line.trim();
    if (trimmed) tmuxSessions.add(trimmed);
  }

  // Closed issues change at human cadence — cache for 2 min to avoid ~8,600
  // gh CLI invocations per day while the projects tab is open.
  let closedIssues: Array<{ number: number; title: string }> = [];
  if (closedIssuesCache && (Date.now() - closedIssuesCache.timestamp) < CLOSED_ISSUES_TTL_MS) {
    closedIssues = closedIssuesCache.data;
  } else {
    try {
      const { stdout } = await execAsync(
        'gh issue list --repo eltmon/panopticon-cli --state closed --limit 200 --json number,title 2>/dev/null || echo "[]"'
      );
      closedIssues = JSON.parse(stdout.trim()) as Array<{ number: number; title: string }>;
      closedIssuesCache = { timestamp: Date.now(), data: closedIssues };
    } catch {
      closedIssuesCache = { timestamp: Date.now(), data: [] };
    }
  }
  for (const ci of closedIssues) {
    const key = `PAN-${ci.number}`;
    if (!issueTitleMap.has(key) && ci.title) {
      issueTitleMap.set(key, ci.title.replace(/^PAN-\d+:\s*/i, ''));
    }
  }

  const projectTree: Array<{
    name: string;
    path: string;
    features: Array<Record<string, unknown>>;
  }> = [];

  const now = Date.now();
  const RECENT_DAYS = 7;
  const recentMs = RECENT_DAYS * 24 * 60 * 60 * 1000;

  for (const project of projects) {
    const projectPath = (project.config as { path: string }).path;
    const workspaceConfig = (project.config as { workspace?: { workspaces_dir?: string } }).workspace;
    const workspacesDir = join(projectPath, workspaceConfig?.workspaces_dir || 'workspaces');
    const features: Array<Record<string, unknown>> = [];

    if (await pathExists(workspacesDir)) {
      const entries = await readdir(workspacesDir, { withFileTypes: true }).catch(() => []);
      const featureEntries = entries.filter(e => e.isDirectory() && e.name.startsWith('feature-'));

      const featureResults = await withConcurrencyLimit(
        featureEntries.map((entry) => async () => {
          const featurePath = join(workspacesDir, entry.name);
          const issueLower = entry.name.replace('feature-', '');
          const issueId = issueLower.toUpperCase();
          const planningDir = join(featurePath, '.planning');

          const agentDir = join(homedir(), '.panopticon', 'agents', `agent-${issueLower}`);
          let agentStatus: string | null = null;
          let lastActivity: number | null = null;

          const stateText = await readOptional(join(agentDir, 'state.json'));
          if (stateText) {
            try {
              const state = JSON.parse(stateText) as { state?: string; lastActivity?: string };
              agentStatus = state.state || null;
              if (state.lastActivity) lastActivity = new Date(state.lastActivity).getTime();
            } catch { /* skip */ }
          }

          const hasTmux = tmuxSessions.has(`agent-${issueLower}`);
          const hasRecentAgentActivity = lastActivity != null && (now - lastActivity) < recentMs;
          const isAgentLive = (agentStatus === 'active' || agentStatus === 'suspended') && (hasTmux || hasRecentAgentActivity);

          const hasWorkspace = await pathExists(featurePath);

          const issueCanonicalState = issueStateMap.get(issueId) || '';
          const showByTrackerState = ['in_progress', 'in_review'].includes(issueCanonicalState);

          if (!hasTmux && !isAgentLive && !hasWorkspace && !showByTrackerState) return null;

          const [hasPlanning, hasPrd, hasState, isShadow] = await Promise.all([
            pathExists(planningDir),
            pathExists(join(planningDir, 'PLANNING_PROMPT.md')),
            pathExists(join(planningDir, 'STATE.md')),
            pathExists(join(planningDir, 'INFERENCE.md')),
          ]);

          const centralReviewStatus = getReviewStatus(issueId);
          const reviewStatus = centralReviewStatus?.reviewStatus || null;
          const testStatus = centralReviewStatus?.testStatus || null;
          const mergeStatus = centralReviewStatus?.mergeStatus || null;

          const heartbeatFile = join(homedir(), '.panopticon', 'heartbeats', `agent-${issueLower}.json`);
          let isHeartbeatFresh = false;
          const hbText = await readOptional(heartbeatFile);
          if (hbText) {
            try {
              const hb = JSON.parse(hbText) as { timestamp: string };
              isHeartbeatFresh = (now - new Date(hb.timestamp).getTime()) < 10 * 60 * 1000;
            } catch { /* skip */ }
          }

          const isAgentTrulyActive = hasTmux && (isHeartbeatFresh || agentStatus === 'active');

          let stateLabel = 'Idle';
          if (mergeStatus === 'merged') stateLabel = 'Done';
          else if (reviewStatus === 'passed' && testStatus === 'passed') stateLabel = 'In Review';
          else if (reviewStatus === 'reviewing' || testStatus === 'testing') stateLabel = 'In Review';
          else if (reviewStatus === 'passed' && testStatus === 'pending') stateLabel = 'In Review';
          else if (isAgentTrulyActive) stateLabel = 'In Progress';
          else if (hasTmux && !isHeartbeatFresh && agentStatus === 'active') stateLabel = 'Has Context';
          else if (agentStatus === 'suspended') stateLabel = 'Suspended';
          else if (hasRecentAgentActivity && agentStatus === 'active' && isHeartbeatFresh) stateLabel = 'In Progress';
          else if (hasPrd && !hasState) stateLabel = 'Planning';
          else if (hasState) stateLabel = 'Has Context';

          let title = issueTitleMap.get(issueId) || '';
          if (!title && hasPrd) {
            const promptContent = await readOptional(join(planningDir, 'PLANNING_PROMPT.md'));
            if (promptContent) {
              const firstLine = promptContent.split('\n').find(l => l.trim().length > 0) || '';
              title = firstLine.replace(/^#+\s*/, '').trim();
            }
          }
          if (!title) title = issueId;

          return {
            issueId, title, branch: `feature/${issueLower}`,
            status: isAgentTrulyActive ? 'running' : hasState ? 'has_state' : 'idle',
            stateLabel, agentStatus, hasPlanning, hasPrd, hasState, isShadow,
            readyForMerge: centralReviewStatus?.readyForMerge ?? false,
          };
        }),
        15,
      );

      features.push(...featureResults.filter((f): f is NonNullable<typeof f> => f !== null));
    }

    // Add Rally Features from cached issues
    const existingIds = new Set(features.map(f => f['issueId']));
    const projectName = (project.config as { name?: string }).name || projectPath.split('/').pop() || 'Unknown';

    for (const issue of allIssues) {
      if (issue['source'] !== 'rally') continue;
      if (!(issue['artifactType'] as string | undefined)?.includes('PortfolioItem')) continue;
      if ((issue['project'] as { name?: string } | undefined)?.name !== projectName) continue;
      if (existingIds.has(issue['identifier'])) continue;

      let stateLabel = (issue['rawTrackerState'] as string) || (issue['status'] as string) || 'Unknown';
      if (issue['derivedStatus'] === 'closed') stateLabel = 'Done';
      else if (issue['derivedStatus'] === 'in_progress') stateLabel = 'In Progress';

      features.push({
        issueId: issue['identifier'], title: issue['title'],
        branch: '', status: 'idle', stateLabel, agentStatus: null,
        hasPlanning: false, hasPrd: false, hasState: false, isShadow: false,
        isRally: true, childCount: issue['totalChildCount'],
        completedCount: issue['completedChildCount'], inProgressCount: issue['inProgressChildCount'],
        rawTrackerState: issue['rawTrackerState'],
      });
    }

    // Add tracker issues without workspaces that are in active states
    const SHOW_ALWAYS_STATES = new Set(['in_progress', 'in_review']);
    const projectPrefixes: string[] = [];
    if (project.config.issue_prefix) {
      projectPrefixes.push(project.config.issue_prefix.toUpperCase());
    }
    if (project.config.issue_prefixes) {
      for (const p of project.config.issue_prefixes) {
        projectPrefixes.push(p.toUpperCase());
      }
    }
    // Fallback: derive prefix from project key
    if (projectPrefixes.length === 0) {
      projectPrefixes.push(project.key.toUpperCase().replace(/-/g, ''));
    }

    for (const issue of allIssues) {
      const issueId = issue['identifier'] as string | undefined;
      if (!issueId || existingIds.has(issueId)) continue;

      const prefix = extractPrefix(issueId);
      if (!prefix || !projectPrefixes.includes(prefix.toUpperCase())) continue;

      const state = issue['state'] as string | undefined;
      if (!state || !SHOW_ALWAYS_STATES.has(state)) continue;

      features.push({
        issueId,
        title: issue['title'] || issueTitleMap.get(issueId.toUpperCase()) || issueId,
        branch: '',
        status: 'idle',
        stateLabel: issue['status'] || state,
        agentStatus: null,
        hasPlanning: false,
        hasPrd: false,
        hasState: false,
        isShadow: false,
      });
    }

    projectTree.push({ name: projectName, path: projectPath, features });
  }

  return projectTree;
}

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const commandDeckRouteLayer = Layer.mergeAll(
  getMissionControlActivityRoute,
  getMissionControlPlanningRoute,
  postMissionControlStatusReviewRoute,
  postMissionControlUploadRoute,
  postMissionControlSyncDiscussionsRoute,
  postMissionControlPlanningInitRoute,
  getMissionControlProjectsRoute,
);

export default commandDeckRouteLayer;
