import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpServerResponse } from 'effect/unstable/http';

import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { parseIssueIdSync } from '../issue-id.js';
import {
  createConversation,
  getConversationByName,
  getStuckForks,
  incrementForkRetryCount,
  markConversationActive,
  markConversationEnded,
  recordConversationHandoff,
  setForkRequest,
  updateConversationForkFallbackReason,
  updateConversationTitle,
  updateForkStatus,
  type ForkRequest,
  type LegacyConversation as Conversation,
} from './conversations.js';
import {
  isInsideGitWorkTree,
  resolveAllowedHarness,
  spawnConversationSession,
  waitForPiTuiReady,
  waitForTmuxSession,
} from './conversation-runtime.js';
import { resolveConversationDeliveryMethod } from './conversation-delivery.js';
import { deliverAgentMessage, getAgentRuntimeStateSync, waitForReadySignal } from '../agents.js';
import { getTranscriptAdapter } from '../conversations/transcript-adapter.js';
import { resolveDiscoveredSessionFile } from '../conversations/discovered-session-file.js';
import {
  authorHandoffExternal,
  copySessionFromCompactBoundary,
  generateFallbackSummary,
  generateSummaryForFork,
  handoffFailureReason,
  handoffPreconditionFallbackReason,
  logHandoffFallback,
  prependFallbackFocus,
  requestHandoffFromAgent,
  reserveSummaryForkSession,
  type HandoffAuthor,
  type SummaryForkMode,
} from '../conversations/summary-fork.js';
import { UnknownModelError } from '../providers.js';
import { sessionFilePath } from '../paths.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import type { RuntimeName } from '../runtimes/types.js';
import { getAgentRuntimeStateSync as getAgentRuntimeStateSyncFromAgents } from '../agents.js';
import { isHarnessProcessAlive, sessionExists } from '../tmux.js';
import {
  readLauncherPinnedSessionId,
  resolveCodexRolloutPath,
  resolvePiSessionPath,
} from '../../dashboard/server/routes/jsonl-resolver.js';
import * as self from './conversation-forks.js';

const SAFE_MODEL_PATTERN = /^[a-zA-Z0-9_.:\/-]+$/;
const SESSION_FILE_MISS_TTL_MS = 2000;
const sessionFileByIdCache = new Map<string, { path: string | null; ts: number }>();

async function findClaudeSessionFileById(sessionId: string): Promise<string | null> {
  const cached = sessionFileByIdCache.get(sessionId);
  if (cached) {
    if (cached.path) {
      if (existsSync(cached.path)) return cached.path;
      sessionFileByIdCache.delete(sessionId);
    } else if (Date.now() - cached.ts < SESSION_FILE_MISS_TTL_MS) {
      return null;
    }
  }
  try {
    const claudeProjects = join(homedir(), '.claude', 'projects');
    const dirs = await readdir(claudeProjects);
    const SAFE_DIR_PATTERN = /^[a-zA-Z0-9_.-]+$/;
    const candidates = dirs
      .filter((dir) => SAFE_DIR_PATTERN.test(dir))
      .map((dir) => join(claudeProjects, dir, `${sessionId}.jsonl`));
    const STAT_BATCH_SIZE = 50;
    for (let i = 0; i < candidates.length; i += STAT_BATCH_SIZE) {
      const batch = candidates.slice(i, i + STAT_BATCH_SIZE);
      const checks = await Promise.all(
        batch.map(async (candidate) => {
          try {
            await stat(candidate);
            return candidate;
          } catch {
            return null;
          }
        }),
      );
      const found = checks.find((candidate): candidate is string => candidate !== null);
      if (found) {
        sessionFileByIdCache.set(sessionId, { path: found, ts: Date.now() });
        return found;
      }
    }
  } catch {
    /* ~/.claude/projects unreadable */
  }
  sessionFileByIdCache.set(sessionId, { path: null, ts: Date.now() });
  return null;
}

async function resolveForkSourceSessionFile(conv: Conversation): Promise<string | null> {
  if (getHarnessBehavior(conv.harness).transcriptKind === 'ohmypi-jsonl') {
    const piPath = await resolvePiSessionPath(conv.tmuxSession);
    if (piPath) return piPath;
  }
  if (getHarnessBehavior(conv.harness).transcriptKind === 'codex-rollout-jsonl') {
    const codexPath = await resolveCodexRolloutPath(conv.tmuxSession);
    if (codexPath) return codexPath;
  }
  const pinned = await readLauncherPinnedSessionId(conv.tmuxSession);
  const sessionId = pinned ?? conv.claudeSessionId;
  if (sessionId) {
    const deterministic = sessionFilePath(conv.cwd, sessionId);
    if (existsSync(deterministic)) return deterministic;
    const found = await findClaudeSessionFileById(sessionId);
    if (found) return found;
    const discovered = await resolveDiscoveredSessionFile(conv.claudeSessionId);
    return discovered ?? deterministic;
  }
  const discovered = await resolveDiscoveredSessionFile(conv.claudeSessionId);
  if (discovered) return discovered;
  console.error(
    `[fork-pipeline] UNRESOLVED claude-code session for conversation '${conv.name}' ` +
      `(tmux=${conv.tmuxSession}, status=${conv.status}, cwd=${conv.cwd}): no --session-id ` +
      `pinned in launcher.sh and no recorded claudeSessionId. The fork source transcript cannot be trusted.`,
  );
  return null;
}

function resolvePlainForkTargetSessionFile(conv: Conversation): string | null {
  if (!conv.claudeSessionId) return null;
  return sessionFilePath(conv.cwd, conv.claudeSessionId);
}

/** Validate a caller-supplied cwd is an existing directory under the user's home. */
async function validateCwdContainment(cwd: string): Promise<boolean> {
  if (!cwd.startsWith('/')) return false;
  const segments = cwd.split('/').filter(Boolean);
  if (segments.includes('..')) return false;
  try {
    const resolved = await realpath(cwd);
    const stats = await stat(resolved);
    if (!stats.isDirectory()) return false;
    const home = homedir();
    if (!resolved.startsWith(`${home}/`) && resolved !== home) return false;
    return true;
  } catch {
    return false;
  }
}

export function parseSummaryForkFocus(value: unknown): { ok: true; focus: string | undefined } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, focus: undefined };
  if (typeof value !== 'string') return { ok: false, error: 'focus must be a string' };
  const focus = value.trim();
  if (!focus) return { ok: true, focus: undefined };
  if (focus.length > 500) return { ok: false, error: 'focus must be 500 characters or fewer' };
  if (/[\x00-\x1f\x7f]/u.test(focus)) return { ok: false, error: 'focus must not contain control characters' };
  return { ok: true, focus };
}

export function buildForkRequest(params: ForkRequest): ForkRequest {
  return {
    parentConversationName: params.parentConversationName,
    sessionId: params.sessionId,
    forkMode: params.forkMode,
    ...(params.issueId !== undefined ? { issueId: params.issueId } : {}),
    ...(params.summaryModel !== undefined ? { summaryModel: params.summaryModel } : {}),
    localSummaryOnly: params.localSummaryOnly,
    ...(params.includeThinkingInSummary !== undefined ? { includeThinkingInSummary: params.includeThinkingInSummary } : {}),
    ...(params.summaryHarness !== undefined ? { summaryHarness: params.summaryHarness } : {}),
    ...(params.handoffFocus !== undefined ? { handoffFocus: params.handoffFocus } : {}),
    handoffAuthor: params.handoffAuthor,
    ...(params.handoffAuthorModel !== undefined ? { handoffAuthorModel: params.handoffAuthorModel } : {}),
    ...(params.handoffAuthorHarness !== undefined ? { handoffAuthorHarness: params.handoffAuthorHarness } : {}),
  };
}

export async function handleConversationHandoffDoc(
  name: string,
): Promise<HttpServerResponse.HttpServerResponse> {
  const conv = getConversationByName(name);
  if (!conv) {
    return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
  }
  if (!conv.handoffDocPath) {
    return jsonResponse({ error: 'Handoff document not found' }, { status: 404 });
  }
  try {
    const docText = await readFile(conv.handoffDocPath, 'utf-8');
    return HttpServerResponse.text(docText, {
      contentType: 'text/markdown',
      headers: {
        'Content-Disposition': `inline; filename="${conv.name}-handoff.md"`,
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return jsonResponse({ error: 'Handoff document is no longer available' }, { status: 410 });
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[conversations] failed to read handoff doc for "${name}":`, msg);
    return jsonResponse({ error: 'Failed to read handoff document' }, { status: 500 });
  }
}

/**
 * Title a handoff conversation after the work it carries (the focus), not the
 * parent's title. A handoff with no focus falls back to "Handoff: <parent>".
 */
function handoffTitleFromFocus(focus: string | undefined, fallback: string): string {
  const f = focus?.replace(/\s+/g, ' ').trim();
  if (!f) return `Handoff: ${fallback}`;
  const trimmed = f.length > 70 ? `${f.slice(0, 69).trimEnd()}…` : f;
  return `Handoff: ${trimmed}`;
}

type ForkPipelineRuntimeOverrides = Partial<{
  sessionExists: (sessionName: string) => Promise<boolean>;
  isHarnessProcessAlive: (sessionName: string) => Promise<boolean>;
  spawnConversationSession: typeof spawnConversationSession;
  waitForTmuxSession: typeof waitForTmuxSession;
  getAgentRuntimeStateSync: typeof getAgentRuntimeStateSyncFromAgents;
}>;

let forkPipelineRuntimeOverrides: ForkPipelineRuntimeOverrides = {};

export function __setForkPipelineRuntimeOverridesForTest(overrides: ForkPipelineRuntimeOverrides): void {
  forkPipelineRuntimeOverrides = overrides;
}

export function __resetForkPipelineRuntimeOverridesForTest(): void {
  forkPipelineRuntimeOverrides = {};
}

async function forkSessionExists(sessionName: string): Promise<boolean> {
  return forkPipelineRuntimeOverrides.sessionExists
    ? forkPipelineRuntimeOverrides.sessionExists(sessionName)
    : Effect.runPromise(sessionExists(sessionName));
}

async function forkHarnessProcessAlive(sessionName: string): Promise<boolean> {
  return forkPipelineRuntimeOverrides.isHarnessProcessAlive
    ? forkPipelineRuntimeOverrides.isHarnessProcessAlive(sessionName)
    : isHarnessProcessAlive(sessionName);
}

function forkRuntimeState(sessionName: string): ReturnType<typeof getAgentRuntimeStateSync> {
  return forkPipelineRuntimeOverrides.getAgentRuntimeStateSync
    ? forkPipelineRuntimeOverrides.getAgentRuntimeStateSync(sessionName)
    : getAgentRuntimeStateSync(sessionName);
}

async function forkSpawnConversationSession(...args: Parameters<typeof spawnConversationSession>): Promise<void> {
  return (forkPipelineRuntimeOverrides.spawnConversationSession ?? spawnConversationSession)(...args);
}

async function forkWaitForTmuxSession(...args: Parameters<typeof waitForTmuxSession>): Promise<void> {
  return (forkPipelineRuntimeOverrides.waitForTmuxSession ?? waitForTmuxSession)(...args);
}

export async function confirmForkPromptAccepted(
  tmuxSession: string,
  timeoutMs: number,
): Promise<'accepted' | 'still-idle' | 'unknown'> {
  const deadline = Date.now() + timeoutMs;
  let sawIdle = false;
  do {
    const state = forkRuntimeState(tmuxSession)?.state;
    if (state === 'active' || state === 'waiting-on-human') return 'accepted';
    if (state === 'idle') sawIdle = true;
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  return sawIdle ? 'still-idle' : 'unknown';
}

export async function readExistingHandoffDoc(conv: Pick<Conversation, 'handoffDocPath'>): Promise<string | null> {
  if (!conv.handoffDocPath || !existsSync(conv.handoffDocPath)) return null;
  return readFile(conv.handoffDocPath, 'utf-8');
}

export async function ensureForkSessionReady(
  conv: Conversation,
  sessionId: string,
  resume: boolean,
  plainFork = false,
): Promise<void> {
  const tmuxAlive = await forkSessionExists(conv.tmuxSession);
  if (tmuxAlive) {
    const harnessAlive = await forkHarnessProcessAlive(conv.tmuxSession);
    if (harnessAlive) {
      console.info(`[fork-pipeline] Reusing existing live tmux session ${conv.tmuxSession} for ${conv.name}`);
      return;
    }
    console.warn(`[fork-pipeline] Existing tmux session ${conv.tmuxSession} for ${conv.name} is a keep-alive corpse — recreating`);
  }
  await forkSpawnConversationSession(
    conv.tmuxSession,
    conv.cwd,
    sessionId,
    conv.model ?? undefined,
    conv.effort ?? undefined,
    conv.issueId ?? undefined,
    resume,
    conv.harness ?? 'claude-code',
    plainFork,
  );
  await forkWaitForTmuxSession(conv.tmuxSession);
}

export async function injectForkSummary(conv: Conversation, summary: string, caller: string): Promise<void> {
  updateForkStatus(conv.name, 'injecting');
  const method = resolveConversationDeliveryMethod(conv);
  const behavior = getHarnessBehavior(conv.harness);
  if (behavior.transcriptKind === 'ohmypi-jsonl') {
    await waitForPiTuiReady(conv.tmuxSession, 60000);
    await deliverAgentMessage(conv.tmuxSession, summary, caller, method);
    return;
  }
  const ready = await waitForReadySignal(conv.tmuxSession, 60);
  if (!ready) {
    console.warn(`[${caller}] ready signal not detected for ${conv.name} within 60s — delivering and confirming anyway`);
  }
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await deliverAgentMessage(conv.tmuxSession, summary, caller, method);
    const outcome = await confirmForkPromptAccepted(conv.tmuxSession, 8000);
    if (outcome === 'accepted') return;
    if (outcome === 'unknown') {
      console.warn(`[${caller}] delivery to ${conv.name} could not be confirmed (runtime mirror silent) — not retrying`);
      return;
    }
    if (attempt < MAX_ATTEMPTS) {
      console.warn(`[${caller}] ${conv.name} still idle 8s after delivery (attempt ${attempt}/${MAX_ATTEMPTS}) — TUI likely dropped the paste during startup, re-delivering`);
    } else {
      console.warn(`[${caller}] could not confirm brief delivery for ${conv.name} after ${MAX_ATTEMPTS} attempts — successor may be sitting at an empty prompt`);
    }
  }
}

export function handleForkPipelineFailure(name: string, err: unknown): void {
  console.error(`[fork-pipeline] Failed for ${name}:`, err);
  const msg = err instanceof Error ? err.message : String(err);
  updateForkStatus(name, 'failed', msg);
  markConversationEnded(name);
}

export async function runForkPipeline(
  convName: string,
  parentConv: Conversation,
  sessionId: string,
  summaryModel?: string,
  forkMode: SummaryForkMode = 'summary',
  localSummaryOnly = false,
  includeThinkingInSummary?: boolean,
  summaryHarness?: RuntimeName,
  handoffFocus?: string,
  handoffAuthor: HandoffAuthor = 'external',
  handoffAuthorModel?: string,
  handoffAuthorHarness?: RuntimeName,
): Promise<void> {
  const conv = getConversationByName(convName);
  if (!conv) throw new Error(`Fork conversation ${convName} not found`);
  const parentSessionFile = await resolveForkSourceSessionFile(parentConv);
  if (!parentSessionFile) throw new Error(`Parent has no session file`);
  if (forkMode === 'plain') {
    if (getHarnessBehavior(conv.harness).transcriptKind !== 'claude-jsonl') {
      throw new Error(`Plain forks cannot launch under the ${conv.harness} harness — it cannot consume Claude session history.`);
    }
    const tmuxAlive = await forkSessionExists(conv.tmuxSession);
    const reusableSession = tmuxAlive && await forkHarnessProcessAlive(conv.tmuxSession);
    if (!reusableSession) {
      const forkSessionFile = resolvePlainForkTargetSessionFile(conv);
      if (!forkSessionFile) throw new Error(`Fork conversation ${convName} has no session file`);
      await Effect.runPromise(copySessionFromCompactBoundary(parentSessionFile, forkSessionFile));
    }
    updateForkStatus(convName, 'spawning');
    await ensureForkSessionReady(conv, sessionId, true, true);
    markConversationActive(convName);
    updateForkStatus(convName, null);
    return;
  }
  let summary: string;
  let effectiveForkMode = forkMode;
  let handoffDocPath: string | null = null;
  let forkFallbackReason: string | null = null;
  const buildSummary = async (): Promise<string> => {
    if (localSummaryOnly) {
      try {
        return await Effect.runPromise(generateFallbackSummary(parentSessionFile));
      } catch (error) {
        console.warn(
          `[fork-pipeline] Heuristic fallback summary failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return '';
      }
    }
    try {
      const result = await generateSummaryForFork(
        parentSessionFile,
        summaryModel,
        includeThinkingInSummary,
        summaryHarness,
        parentConv.harness ?? undefined,
      );
      return result.summary;
    } catch (error) {
      if (!forkFallbackReason) {
        forkFallbackReason = `LLM summary failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      console.warn(
        `[fork-pipeline] LLM summary failed, falling back to heuristic: ${error instanceof Error ? error.message : String(error)}`,
      );
      try {
        return await Effect.runPromise(generateFallbackSummary(parentSessionFile));
      } catch (heuristicError) {
        console.warn(
          `[fork-pipeline] Heuristic fallback also failed: ${heuristicError instanceof Error ? heuristicError.message : String(heuristicError)}`,
        );
        return '';
      }
    }
  };
  if (forkMode === 'handoff') {
    const existingHandoffDoc = await readExistingHandoffDoc(conv);
    if (existingHandoffDoc !== null) {
      summary = existingHandoffDoc;
      handoffDocPath = conv.handoffDocPath;
    } else if (handoffAuthor === 'external') {
      try {
        const handoff = await authorHandoffExternal(
          parentConv,
          parentSessionFile,
          handoffFocus,
          handoffAuthorModel,
          handoffAuthorHarness,
        );
        summary = handoff.docText;
        handoffDocPath = handoff.docPath;
      } catch (error) {
        forkFallbackReason = handoffFailureReason(error);
        effectiveForkMode = 'summary';
        logHandoffFallback(parentConv, forkFallbackReason);
        summary = prependFallbackFocus(await buildSummary(), handoffFocus, forkFallbackReason);
      }
    } else {
      const preconditionFallback = await handoffPreconditionFallbackReason(parentConv);
      if (preconditionFallback) {
        forkFallbackReason = preconditionFallback;
        effectiveForkMode = 'summary';
        logHandoffFallback(parentConv, preconditionFallback);
        summary = prependFallbackFocus(await buildSummary(), handoffFocus, preconditionFallback);
      } else {
        try {
          const handoff = await requestHandoffFromAgent(parentConv, handoffFocus);
          summary = handoff.docText;
          handoffDocPath = handoff.docPath;
        } catch (error) {
          forkFallbackReason = handoffFailureReason(error);
          effectiveForkMode = 'summary';
          logHandoffFallback(parentConv, forkFallbackReason);
          summary = prependFallbackFocus(await buildSummary(), handoffFocus, forkFallbackReason);
        }
      }
    }
  } else {
    summary = await buildSummary();
  }
  updateConversationForkFallbackReason(convName, forkFallbackReason);
  updateConversationTitle(
    convName,
    effectiveForkMode === 'handoff'
      ? handoffTitleFromFocus(handoffFocus, parentConv.title || parentConv.name)
      : `Summary Fork: ${parentConv.title || parentConv.name}`,
    'manual',
  );
  if (handoffDocPath) {
    recordConversationHandoff(parentConv.name, convName, handoffDocPath);
  }
  updateForkStatus(convName, 'spawning');
  await self.ensureForkSessionReady(conv, sessionId, false);
  await self.injectForkSummary(conv, summary, effectiveForkMode === 'handoff' ? 'handoff' : 'summary-fork');
  markConversationActive(convName);
  updateForkStatus(convName, null);
}

function parsePersistedForkRequest(raw: string): ForkRequest | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ForkRequest>;
    if (typeof parsed.parentConversationName !== 'string') return null;
    if (typeof parsed.sessionId !== 'string') return null;
    if (parsed.forkMode !== 'summary' && parsed.forkMode !== 'plain' && parsed.forkMode !== 'handoff') return null;
    if (typeof parsed.localSummaryOnly !== 'boolean') return null;
    if (parsed.handoffAuthor !== 'source' && parsed.handoffAuthor !== 'external') return null;
    return parsed as ForkRequest;
  } catch {
    return null;
  }
}

const inFlightForkPipelines = new Set<Promise<void>>();

export function registerInFlightForkPipeline(pipeline: Promise<void>): Promise<void> {
  const tracked = pipeline.finally(() => {
    inFlightForkPipelines.delete(tracked);
  });
  inFlightForkPipelines.add(tracked);
  return tracked;
}

export function getInFlightForkPipelineCount(): number {
  return inFlightForkPipelines.size;
}

export async function waitForInFlightForkPipelines(timeoutMs = 10_000): Promise<{ completed: boolean; count: number }> {
  const pipelines = [...inFlightForkPipelines];
  const count = pipelines.length;
  if (count === 0) return { completed: true, count: 0 };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.allSettled(pipelines).then(() => ({ completed: true, count })),
      new Promise<{ completed: boolean; count: number }>((resolve) => {
        timeout = setTimeout(() => resolve({ completed: false, count }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function recoverStuckForks(): Promise<number> {
  const forks = getStuckForks();
  let recovered = 0;
  for (const fork of forks) {
    try {
      if (!fork.forkRequest) {
        updateForkStatus(fork.name, 'failed', 'Dashboard restarted during fork before recovery metadata was persisted');
        continue;
      }
      const request = parsePersistedForkRequest(fork.forkRequest);
      if (!request) {
        updateForkStatus(fork.name, 'failed', 'Persisted fork request is invalid');
        continue;
      }
      const tmuxAlive = await forkSessionExists(fork.tmuxSession);
      const harnessAlive = tmuxAlive && await forkHarnessProcessAlive(fork.tmuxSession);
      const runtimeState = harnessAlive ? forkRuntimeState(fork.tmuxSession)?.state : undefined;
      if (harnessAlive && (runtimeState === 'active' || runtimeState === 'waiting-on-human')) {
        markConversationActive(fork.name);
        updateForkStatus(fork.name, null);
        recovered += 1;
        continue;
      }
      if (fork.forkRetryCount >= 2) {
        updateForkStatus(fork.name, 'failed', 'Fork recovery retry limit reached');
        continue;
      }
      incrementForkRetryCount(fork.name);
      const parentConv = getConversationByName(request.parentConversationName);
      if (!parentConv) {
        updateForkStatus(fork.name, 'failed', `Parent conversation ${request.parentConversationName} not found`);
        continue;
      }
      await registerInFlightForkPipeline(runForkPipeline(
        fork.name,
        parentConv,
        request.sessionId,
        request.summaryModel,
        request.forkMode,
        request.localSummaryOnly,
        request.includeThinkingInSummary,
        request.summaryHarness,
        request.handoffFocus,
        request.handoffAuthor,
        request.handoffAuthorModel,
        request.handoffAuthorHarness,
      ));
      recovered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[fork-recovery] Failed to recover ${fork.name}:`, error);
      updateForkStatus(fork.name, 'failed', message);
    }
  }
  return recovered;
}

export async function handleConversationSummaryFork(
  name: string,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof jsonResponse>> {
  try {
    const conv = getConversationByName(name);
    if (!conv) {
      return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    }
    const sourceAdapter = getTranscriptAdapter(conv.harness ?? undefined);
    const sourceSessionFile = await sourceAdapter.resolveSessionFile(conv);
    if (!sourceSessionFile || !existsSync(sourceSessionFile)) {
      return jsonResponse({ error: `No session file found for conversation ${conv.name}` }, { status: 400 });
    }
    const model = typeof body['model'] === 'string'
      ? body['model'].trim()
      : undefined;
    const summaryModel = typeof body['summaryModel'] === 'string'
      ? body['summaryModel'].trim()
      : undefined;
    const cwd = typeof body['cwd'] === 'string' && body['cwd'].trim()
      ? body['cwd'].trim()
      : undefined;
    const requestedForkMode = body['forkMode'];
    let forkMode: SummaryForkMode = 'summary';
    if (requestedForkMode !== undefined) {
      if (requestedForkMode !== 'summary' && requestedForkMode !== 'plain' && requestedForkMode !== 'handoff') {
        return jsonResponse({ error: 'Invalid forkMode' }, { status: 400 });
      }
      forkMode = requestedForkMode;
    } else if (body['plain'] === true) {
      console.debug('[summary-fork] legacy plain=true mapped to forkMode=plain');
      forkMode = 'plain';
    }
    const focusResult = parseSummaryForkFocus(body['focus']);
    if (!focusResult.ok) {
      return jsonResponse({ error: focusResult.error }, { status: 400 });
    }
    const handoffFocus = focusResult.focus;
    const requestedIssueId = body['issueId'];
    let explicitIssueId: string | undefined;
    if (requestedIssueId !== undefined) {
      if (typeof requestedIssueId !== 'string' || !parseIssueIdSync(requestedIssueId.trim())) {
        return jsonResponse({ error: 'Invalid issueId' }, { status: 400 });
      }
      explicitIssueId = requestedIssueId.trim();
    }
    const requestedHandoffAuthor = body['handoffAuthor'];
    let handoffAuthor: HandoffAuthor = 'external';
    if (requestedHandoffAuthor !== undefined) {
      if (requestedHandoffAuthor !== 'source' && requestedHandoffAuthor !== 'external') {
        return jsonResponse({ error: 'Invalid handoffAuthor (expected "source" or "external")' }, { status: 400 });
      }
      handoffAuthor = requestedHandoffAuthor;
    }
    const handoffAuthorModel = typeof body['handoffAuthorModel'] === 'string'
      ? body['handoffAuthorModel'].trim()
      : undefined;
    if (handoffAuthorModel && !SAFE_MODEL_PATTERN.test(handoffAuthorModel)) {
      return jsonResponse({ error: 'Invalid handoffAuthorModel' }, { status: 400 });
    }
    if (forkMode === 'plain' && !sourceAdapter.supportsPlainForkAsSource) {
      return jsonResponse({
        error: `Plain forks are not supported for ${sourceAdapter.name} sources — only Claude Code can be the source of a plain fork. Use a summary or handoff fork instead.`,
      }, { status: 400 });
    }
    if (forkMode === 'handoff' && handoffAuthor === 'source' && !sourceAdapter.supportsSourceAuthoredHandoff) {
      return jsonResponse({
        error: `Source-authored handoffs are not supported for ${sourceAdapter.name} sources because the harness has no signaling channel for the .done sentinel. Use external authoring (handoffAuthor: "external") instead.`,
      }, { status: 400 });
    }
    const localSummaryOnly = body['localSummaryOnly'] === true;
    const includeThinkingInSummary = body['includeThinkingInSummary'] === true;
    const customTitle = typeof body['title'] === 'string' ? body['title'].trim() : undefined;
    if (cwd && !(await validateCwdContainment(cwd))) {
      return jsonResponse({ error: 'Invalid cwd' }, { status: 400 });
    }
    if (typeof body['model'] === 'string' && !model) {
      return jsonResponse({ error: 'model must not be blank' }, { status: 400 });
    }
    if (model && !SAFE_MODEL_PATTERN.test(model)) {
      return jsonResponse({ error: 'Invalid model' }, { status: 400 });
    }
    if (typeof body['summaryModel'] === 'string' && summaryModel && !SAFE_MODEL_PATTERN.test(summaryModel)) {
      return jsonResponse({ error: 'Invalid summaryModel' }, { status: 400 });
    }
    const effectiveCwd = cwd || conv.cwd || process.cwd();
    if (forkMode === 'handoff' && !(await isInsideGitWorkTree(effectiveCwd))) {
      return jsonResponse({
        error: `Handoff cwd is not inside a git repository: ${effectiveCwd}. Run the handoff from a git working tree.`,
      }, { status: 400 });
    }
    const { sessionId } = await Effect.runPromise(reserveSummaryForkSession(effectiveCwd));
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const suffix = randomUUID().slice(0, 4);
    const newName = `${timestamp}-${suffix}`;
    const newTmux = `conv-${newName}`;
    const launchModel = model || conv.model;
    const effectiveSummaryModel = summaryModel || 'claude-sonnet-5';
    const launchHarness = await resolveAllowedHarness(body['harness'], launchModel);
    const summaryHarness = await resolveAllowedHarness(body['summaryHarness'], effectiveSummaryModel);
    const handoffAuthorHarness = body['handoffAuthorHarness'] !== undefined
      ? await resolveAllowedHarness(body['handoffAuthorHarness'], handoffAuthorModel || effectiveSummaryModel)
      : undefined;
    if (forkMode === 'plain' && getHarnessBehavior(launchHarness).transcriptKind !== 'claude-jsonl') {
      return jsonResponse({
        error: `Plain forks cannot launch under ${launchHarness} — it cannot consume Claude session history. Use a summary fork instead.`,
      }, { status: 400 });
    }
    const defaultTitle = forkMode === 'plain'
      ? `Fork: ${conv.title || conv.name}`
      : forkMode === 'handoff'
        ? handoffTitleFromFocus(handoffFocus, conv.title || conv.name)
        : `Summary Fork: ${conv.title || conv.name}`;
    const newConv = createConversation({
      name: newName,
      tmuxSession: newTmux,
      cwd: cwd || conv.cwd || process.cwd(),
      issueId: explicitIssueId ?? conv.issueId ?? undefined,
      title: customTitle || defaultTitle,
      titleSource: 'manual',
      titleSeed: forkMode === 'plain'
        ? `Fork of ${conv.name}`
        : forkMode === 'handoff'
          ? `Handoff of ${conv.name}`
          : `Summary Fork of ${conv.name}`,
      claudeSessionId: sessionId,
      model: launchModel ?? undefined,
      effort: conv.effort ?? undefined,
      harness: launchHarness,
      forkStatus: forkMode === 'plain' ? 'spawning' : forkMode === 'handoff' ? 'handoff' : 'summarizing',
    });
    const forkRequest = buildForkRequest({
      parentConversationName: conv.name,
      sessionId,
      forkMode,
      ...(explicitIssueId !== undefined ? { issueId: explicitIssueId } : {}),
      ...(summaryModel !== undefined ? { summaryModel } : {}),
      localSummaryOnly,
      includeThinkingInSummary,
      ...(summaryHarness !== undefined ? { summaryHarness } : {}),
      ...(handoffFocus !== undefined ? { handoffFocus } : {}),
      handoffAuthor,
      ...(handoffAuthorModel !== undefined ? { handoffAuthorModel } : {}),
      ...(handoffAuthorHarness !== undefined ? { handoffAuthorHarness } : {}),
    });
    setForkRequest(newConv.name, JSON.stringify(forkRequest));
    markConversationActive(newConv.name);
    registerInFlightForkPipeline(
      runForkPipeline(newConv.name, conv, sessionId, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, summaryHarness, handoffFocus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness),
    ).catch((err) => {
      handleForkPipelineFailure(newConv.name, err);
    });
    return jsonResponse({
      success: true,
      conversation: newConv,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] create summary fork failed:', msg);
    return jsonResponse({ error: error instanceof UnknownModelError ? msg : 'Internal server error' }, { status: error instanceof UnknownModelError ? 400 : 500 });
  }
}
