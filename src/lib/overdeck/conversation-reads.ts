import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';

import { withConcurrencyLimit } from '../concurrency.js';
import { scanPendingInputsPromise, type PendingAskUserQuestionSnapshot, type PendingInputKind } from '../agent-enrichment.js';
import { detectAwaitingInputForAgent, parseCodexApprovalPrompt } from '../agent-input-detection.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { loadConfigSync } from '../config-yaml.js';
import { isBackgroundFeatureEnabled } from '../background-ai/features.js';
import {
  CONVERSATION_TITLE_MODEL,
  fallbackTranscriptTitle,
  serializeConversationTranscript,
  summarizeFirstMessageTitle,
  summarizeTranscriptAbout,
  summarizeTranscriptTitle,
} from '../conversations/transcript-summary.js';
import {
  getConversationByClaudeSessionId,
  getConversationById,
  getConversationByName,
  listConversations,
  updateConversationCost,
  updateConversationTitle,
  canReplaceTitle,
  type LegacyConversation as Conversation,
} from './conversations.js';
import {
  computeContextUsage,
  parseConversationMessages,
  parseFromLastCompactBoundary,
  type ParseState,
} from '../../dashboard/server/services/conversation-service.js';
import { resolveConversationGitInfo } from '../../dashboard/server/services/git-info.js';
import { resolveConversationMessageLocator } from '../../dashboard/server/services/conversation-message-resolver.js';
import { isPiSessionFile, parsePiConversationMessages } from '../../dashboard/server/services/pi-conversation-parser.js';
import { isOhmypiSessionFile, parseOhmypiConversationMessages } from '../../dashboard/server/services/ohmypi-conversation-parser.js';
import { parseCodexConversationMessages } from '../../dashboard/server/services/codex-conversation-parser.js';
import { isCompacting } from '../../dashboard/server/services/conversation-compaction.js';
import {
  resolveAgentHarness,
  resolveClaudeSessionId,
  resolveCodexRolloutPath,
  resolvePiSessionPath,
} from '../../dashboard/server/routes/jsonl-resolver.js';

export interface ConversationReadResult {
  body: unknown;
  status?: number;
}

export interface ConversationReadDependencies {
  resolveSessionFile(conv: Conversation): Promise<string | null>;
  tmuxSessionExists(sessionName: string): Promise<boolean>;
  listSessionNames(): Promise<string[]>;
  shouldReportUnresolvedLiveSession(conv: Pick<Conversation, 'status' | 'harness'> | null | undefined): boolean;
}

export type ConversationMessagesParseResult = Awaited<ReturnType<typeof parseConversationMessages>>;

function result(body: unknown, status?: number): ConversationReadResult {
  return status === undefined ? { body } : { body, status };
}

// ─── Messages cache ───────────────────────────────────────────────────────────

const MESSAGES_CACHE_MAX = 100;
const messagesCache = new Map<
  string,
  {
    mtimeMs: number;
    size: number;
    result: ConversationMessagesParseResult;
    byteOffset: number;
    parseState: ParseState | undefined;
  }
>();

function isCodexSessionFile(sessionFile: string): boolean {
  return sessionFile.includes('/codex-home/sessions/') || /\/rollout-[^/]+\.jsonl$/.test(sessionFile);
}

export async function getCachedMessages(
  sessionFile: string,
  isSpecialist: boolean,
): Promise<ConversationMessagesParseResult> {
  const fileStats = await stat(sessionFile);
  const cacheKey = `${sessionFile}:${isSpecialist}`;
  const cached = messagesCache.get(cacheKey);
  if (cached && cached.mtimeMs === fileStats.mtimeMs && cached.size === fileStats.size && cached.byteOffset >= fileStats.size) {
    return cached.result;
  }

  let parsed: ConversationMessagesParseResult;

  if (isCodexSessionFile(sessionFile)) {
    parsed = await parseCodexConversationMessages(sessionFile);
  } else if (isOhmypiSessionFile(sessionFile)) {
    parsed = await parseOhmypiConversationMessages(sessionFile);
  } else if (isPiSessionFile(sessionFile)) {
    parsed = await parsePiConversationMessages(sessionFile);
  } else if (isSpecialist) {
    parsed = await parseFromLastCompactBoundary(sessionFile);
  } else if (
    cached &&
    cached.parseState &&
    cached.byteOffset <= fileStats.size &&
    cached.size <= fileStats.size
  ) {
    const incremental = await parseConversationMessages(sessionFile, cached.byteOffset, cached.parseState);
    if (incremental.byteOffset < cached.byteOffset) {
      parsed = await parseConversationMessages(sessionFile, 0);
    } else {
      const cachedResult = cached.result;
      const mergedFileEdits = new Map(cachedResult.fileEditsByAssistantId ?? []);
      for (const [k, v] of incremental.fileEditsByAssistantId ?? []) {
        const existing = mergedFileEdits.get(k);
        mergedFileEdits.set(k, existing ? [...existing, ...v] : v);
      }
      parsed = {
        messages: cachedResult.messages.concat(incremental.messages),
        workLog: cachedResult.workLog.concat(incremental.workLog),
        byteOffset: incremental.byteOffset,
        streaming: incremental.streaming,
        totalCost: cachedResult.totalCost + incremental.totalCost,
        totalTokens: cachedResult.totalTokens + incremental.totalTokens,
        latestAssistantUsage: incremental.latestAssistantUsage,
        contextBoundaryOffset: incremental.contextBoundaryOffset,
        contextActiveBytes: incremental.contextActiveBytes,
        pendingToolUse: incremental.pendingToolUse,
        unresolvedResults: incremental.unresolvedResults,
        lastSequence: incremental.lastSequence,
        mtimeMs: incremental.mtimeMs,
        proposedPlan: incremental.proposedPlan ?? cachedResult.proposedPlan,
        compactBoundaries: (cachedResult.compactBoundaries ?? []).concat(incremental.compactBoundaries ?? []),
        planToolUseIds: incremental.planToolUseIds,
        permissionMode: incremental.permissionMode ?? cachedResult.permissionMode,
        fileEditsByAssistantId: mergedFileEdits,
        countedUsageIds: incremental.countedUsageIds,
      };
    }
  } else {
    parsed = await parseConversationMessages(sessionFile, 0);
  }

  messagesCache.set(cacheKey, {
    mtimeMs: fileStats.mtimeMs,
    size: fileStats.size,
    result: parsed,
    byteOffset: parsed.byteOffset,
    parseState: {
      pendingToolUse: parsed.pendingToolUse,
      unresolvedResults: parsed.unresolvedResults,
      lastSequence: parsed.lastSequence,
      planToolUseIds: parsed.planToolUseIds,
      proposedPlan: parsed.proposedPlan,
      latestAssistantUsage: parsed.latestAssistantUsage,
      contextBoundaryOffset: parsed.contextBoundaryOffset,
      permissionMode: parsed.permissionMode,
      countedUsageIds: parsed.countedUsageIds,
    },
  });
  if (messagesCache.size > MESSAGES_CACHE_MAX) {
    const firstKey = messagesCache.keys().next().value;
    if (firstKey !== undefined) messagesCache.delete(firstKey);
  }
  return parsed;
}

// ─── Pending input helpers ───────────────────────────────────────────────────

export function askUserQuestionSnapshotFromScan(
  scan: Awaited<ReturnType<typeof scanPendingInputsPromise>>,
): PendingAskUserQuestionSnapshot | undefined {
  if (scan.askUserQuestions.length === 0) return undefined;
  const first = scan.askUserQuestions[0];
  return {
    toolUseId: first.toolId,
    askedAt: first.timestamp,
    questions: first.questions.map(q => ({
      question: q.question,
      header: q.header,
      multiSelect: q.multiSelect,
      options: q.options.map(o => ({ label: o.label, description: o.description })),
    })),
  };
}

const CODEX_APPROVAL_TOOL_PREFIX = 'codex-approval:';

export async function codexConversationPendingInput(
  conv: Conversation,
  sessionAlive: boolean,
  askedAt: string,
): Promise<{ kinds: PendingInputKind[]; approval?: PendingAskUserQuestionSnapshot }> {
  if (!sessionAlive || getHarnessBehavior(conv.harness).transcriptKind !== 'codex-rollout-jsonl') return { kinds: [] };
  try {
    const detection = await Effect.runPromise(
      detectAwaitingInputForAgent(conv.tmuxSession, { isPlanning: false }),
    );
    if (!detection) return { kinds: [] };
    if (detection.reason === 'session_resume') return { kinds: ['sessionResume'] };

    const parsed = parseCodexApprovalPrompt(detection.prompt);
    if (parsed) {
      const approval: PendingAskUserQuestionSnapshot = {
        toolUseId: `${CODEX_APPROVAL_TOOL_PREFIX}${conv.tmuxSession}`,
        askedAt,
        questions: [{
          question: parsed.detail ? `${parsed.header}\n\n${parsed.detail}` : parsed.header,
          header: 'Codex approval',
          multiSelect: false,
          options: parsed.options.map((o) => ({ label: `${o.number}. ${o.label}` })),
        }],
      };
      return { kinds: ['permissionRequest'], approval };
    }
    return { kinds: ['permissionRequest'] };
  } catch {
    return { kinds: [] };
  }
}

export async function getConversationsPendingInputFeed(
  deps: Pick<ConversationReadDependencies, 'resolveSessionFile' | 'listSessionNames'>,
): Promise<ConversationReadResult> {
  try {
    const conversations = listConversations({ limit: 1000 });
    const liveSessionNames = new Set(await deps.listSessionNames());
    const alive = conversations.filter(
      (conv) => !conv.forkStatus && liveSessionNames.has(conv.tmuxSession),
    );
    const rows = await Effect.runPromise(withConcurrencyLimit(
      alive.map((conv) => Effect.promise(async () => {
        const convSf = await deps.resolveSessionFile(conv);
        let pending: PendingAskUserQuestionSnapshot | undefined;
        let lastActivityAt: string | null = null;
        if (convSf && existsSync(convSf)) {
          try {
            lastActivityAt = new Date((await stat(convSf)).mtimeMs).toISOString();
          } catch {
            // non-fatal — askedAt falls back to now for the codex path
          }
          try {
            pending = askUserQuestionSnapshotFromScan(await scanPendingInputsPromise(convSf));
          } catch {
            // JSONL scan failure — non-fatal
          }
        }
        if (!pending) {
          const codex = await codexConversationPendingInput(
            conv,
            true,
            lastActivityAt ?? new Date().toISOString(),
          );
          if (codex.approval) pending = codex.approval;
        }
        if (!pending) return null;
        return {
          name: conv.name,
          title: conv.title ?? null,
          issueId: conv.issueId ?? null,
          pendingAskUserQuestion: pending,
        };
      })),
      8,
    ));
    return result(rows.filter((row) => row !== null));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] pending-input feed failed:', msg);
    return result({ error: 'Internal server error' }, 500);
  }
}

// ─── Single conversation reads ────────────────────────────────────────────────

export async function getConversationRead(
  rawId: string,
  deps: Pick<ConversationReadDependencies, 'resolveSessionFile' | 'tmuxSessionExists'>,
): Promise<ConversationReadResult> {
  try {
    const numericId = Number(rawId);
    const conv = !Number.isNaN(numericId) && /^\d+$/.test(rawId)
      ? getConversationById(numericId)
      : getConversationByName(rawId);
    if (!conv) return result({ error: 'Conversation not found' }, 404);

    const sessionAlive = conv.status === 'active' && !conv.forkStatus && await deps.tmuxSessionExists(conv.tmuxSession);
    const convSf = await deps.resolveSessionFile(conv);
    let contextUsage = null;
    if (convSf && existsSync(convSf)) {
      try {
        contextUsage = await computeContextUsage(convSf, conv.model);
      } catch {
        contextUsage = null;
      }
    }
    const gitInfo = await resolveConversationGitInfo(conv.cwd);
    let pendingInputCount = 0;
    let pendingInputKinds: PendingInputKind[] = [];
    let pendingAskUserQuestion: PendingAskUserQuestionSnapshot | undefined;
    if (sessionAlive && convSf && existsSync(convSf)) {
      try {
        const scan = await scanPendingInputsPromise(convSf);
        const kinds: PendingInputKind[] = [];
        if (scan.askUserQuestions.length > 0) {
          kinds.push('askUserQuestion');
          pendingAskUserQuestion = askUserQuestionSnapshotFromScan(scan);
        }
        if (scan.exitPlanModePending) kinds.push('exitPlanMode');
        if (scan.enterPlanModeOpen && !scan.exitPlanModePending) kinds.push('enterPlanMode');
        pendingInputKinds = kinds;
        pendingInputCount = kinds.length;
      } catch {
        // non-fatal
      }
    }
    if (pendingInputCount === 0) {
      const codex = await codexConversationPendingInput(conv, sessionAlive, new Date().toISOString());
      if (codex.kinds.length > 0) {
        pendingInputKinds = codex.kinds;
        pendingInputCount = codex.kinds.length;
        if (codex.approval) pendingAskUserQuestion = codex.approval;
      }
    }
    return result({
      ...conv,
      sessionAlive,
      contextUsage,
      branch: gitInfo.branch,
      isWorktree: gitInfo.isWorktree,
      pendingInputCount,
      pendingInputKinds,
      pendingAskUserQuestion,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] get conversation failed:', msg);
    return result({ error: 'Internal server error' }, 500);
  }
}

const SPECIALIST_SESSION_CACHE_TTL_MS = 5_000;
const SPECIALIST_SESSION_CACHE_MAX = 100;
const specialistSessionFileCache = new Map<string, { path: string; timestamp: number }>();
const SAFE_SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function getSpecialistSessionCache(name: string): string | undefined {
  const entry = specialistSessionFileCache.get(name);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > SPECIALIST_SESSION_CACHE_TTL_MS) {
    specialistSessionFileCache.delete(name);
    return undefined;
  }
  return entry.path;
}

function setSpecialistSessionCache(name: string, sessionFile: string): void {
  specialistSessionFileCache.set(name, { path: sessionFile, timestamp: Date.now() });
  if (specialistSessionFileCache.size > SPECIALIST_SESSION_CACHE_MAX) {
    const firstKey = specialistSessionFileCache.keys().next().value;
    if (firstKey !== undefined) specialistSessionFileCache.delete(firstKey);
  }
}

async function resolveSpecialistSessionFile(name: string): Promise<string | null> {
  const cached = getSpecialistSessionCache(name);
  if (cached) return cached;
  if (!/^(specialist-|agent-|planning-|strike-|inspect-)|^(flywheel-orchestrator|conv-flywheel-orchestrator)$/.test(name)) return null;

  try {
    const agentHarness = await resolveAgentHarness(name);
    if (
      agentHarness !== 'claude-code' &&
      agentHarness !== 'codex' &&
      agentHarness !== 'ohmypi' &&
      agentHarness !== 'pi'
    ) {
      return null;
    }
    const agentBehavior = getHarnessBehavior(agentHarness);
    if (agentBehavior.transcriptKind === 'codex-rollout-jsonl') {
      const rollout = await resolveCodexRolloutPath(name);
      if (rollout) {
        setSpecialistSessionCache(name, rollout);
        return rollout;
      }
    } else if (agentBehavior.transcriptKind === 'ohmypi-jsonl') {
      const piSession = await resolvePiSessionPath(name);
      if (piSession) {
        setSpecialistSessionCache(name, piSession);
        return piSession;
      }
    }
  } catch {
    // fall through to Claude lookup
  }

  try {
    const claudeSessionId = await resolveClaudeSessionId(name);
    if (claudeSessionId && SAFE_SESSION_ID_PATTERN.test(claudeSessionId)) {
      const claudeProjects = join(homedir(), '.claude', 'projects');
      const dirs = await readdir(claudeProjects);
      const SAFE_DIR_PATTERN = /^[a-zA-Z0-9_.-]+$/;
      const candidates = dirs
        .filter((dir) => SAFE_DIR_PATTERN.test(dir))
        .map((dir) => join(claudeProjects, dir, `${claudeSessionId}.jsonl`));
      const STAT_BATCH_SIZE = 50;
      let found: string | null = null;
      for (let i = 0; i < candidates.length && !found; i += STAT_BATCH_SIZE) {
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
        found = checks.find((c): c is string => c !== null) ?? null;
      }
      if (found) {
        setSpecialistSessionCache(name, found);
        return found;
      }
    }
  } catch {
    // session resolution failed
  }
  return null;
}

export async function getConversationMessagesRead(
  name: string,
  deps: Pick<ConversationReadDependencies, 'resolveSessionFile' | 'shouldReportUnresolvedLiveSession'>,
): Promise<ConversationReadResult> {
  try {
    const conv = getConversationByName(name);
    let sessionFile: string | null | undefined = conv ? await deps.resolveSessionFile(conv) : undefined;
    if (!conv) {
      sessionFile = await resolveSpecialistSessionFile(name);
      if (!sessionFile) return result({ error: 'Conversation not found' }, 404);
    }

    if (!sessionFile) {
      if (deps.shouldReportUnresolvedLiveSession(conv)) {
        return result({
          messages: [],
          workLog: [],
          streaming: false,
          error:
            `Could not resolve the live session for this conversation — its launcher pins ` +
            `no --session-id and no session is recorded. The transcript cannot be shown ` +
            `reliably; this needs attention.`,
        });
      }
      return result({ messages: [], workLog: [], streaming: false });
    }

    try {
      const parsed = await getCachedMessages(sessionFile, false);
      if (conv && (parsed.totalCost > 0 || parsed.totalTokens > 0)) {
        updateConversationCost(name, parsed.totalCost, parsed.totalTokens);
      }

      let contextUsage = null;
      if (conv) {
        try {
          contextUsage = await computeContextUsage(sessionFile, conv.model);
        } catch {
          contextUsage = null;
        }
      }

      return result({
        messages: parsed.messages,
        workLog: parsed.workLog,
        streaming: parsed.streaming,
        totalCost: parsed.totalCost,
        totalTokens: parsed.totalTokens,
        proposedPlan: parsed.proposedPlan,
        compactBoundaries: (parsed.compactBoundaries?.length ?? 0) > 0 ? parsed.compactBoundaries : undefined,
        compacting: isCompacting(sessionFile) || undefined,
        contextUsage,
      });
    } catch (parseErr: unknown) {
      const code = (parseErr as { code?: string })?.code;
      if (code === 'ENOENT') return result({ messages: [], workLog: [], streaming: false });
      throw parseErr;
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] load messages failed:', msg);
    return result({ error: 'Internal server error' }, 500);
  }
}

export async function getConversationMessageLocator(
  name: string,
  byteOffset: number,
  deps: Pick<ConversationReadDependencies, 'resolveSessionFile'>,
): Promise<ConversationReadResult> {
  try {
    const conv = getConversationByName(name) ?? getConversationByClaudeSessionId(name);
    if (!conv) return result({ error: 'Conversation not found' }, 404);

    const sessionFile = await deps.resolveSessionFile(conv);
    if (!sessionFile) return result({ error: 'Conversation transcript not found' }, 404);

    const locator = await resolveConversationMessageLocator(sessionFile, byteOffset);
    if (!locator) return result({ error: 'Message not found for byteOffset' }, 404);
    return result(locator);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] resolve message locator failed:', msg);
    return result({ error: 'Internal server error' }, 500);
  }
}

// ─── Title generation / retitle / about summary ──────────────────────────────

export function configuredTitleModel(): string {
  try {
    return loadConfigSync().config.conversations.titleModel || CONVERSATION_TITLE_MODEL;
  } catch {
    return CONVERSATION_TITLE_MODEL;
  }
}

export async function generateAiTitle(
  conversationName: string,
  firstMessage: string,
  deps: Pick<ConversationReadDependencies, 'resolveSessionFile'>,
): Promise<void> {
  if (!isBackgroundFeatureEnabled('conversationTitles')) return;

  const conv = getConversationByName(conversationName);
  if (!conv || !canReplaceTitle(conv)) return;

  console.log(`[claude-invoke] purpose=conversation-title | model=${CONVERSATION_TITLE_MODEL} | source=conversation-reads.ts:generateAiTitle | conversation=${conversationName} | promptChars=${firstMessage.length}`);

  const sanitized = await summarizeFirstMessageTitle(firstMessage, configuredTitleModel());
  if (!sanitized) {
    console.warn(`[generateAiTitle] Model returned empty title for "${conversationName}"`);
    return;
  }

  const freshConv = getConversationByName(conversationName);
  if (!freshConv || !canReplaceTitle(freshConv)) {
    console.log(`[generateAiTitle] Conversation "${conversationName}" was renamed while generating title; skipping update`);
    return;
  }

  updateConversationTitle(conversationName, sanitized, 'ai');
  console.log(`[claude-invoke] SUCCESS purpose=conversation-title | model=${CONVERSATION_TITLE_MODEL} | conversation=${conversationName} | outputChars=${sanitized.length}`);
  scheduleTitleRefinement(conversationName, deps);
}

const refinementScheduled = new Set<string>();

export function scheduleTitleRefinement(
  conversationName: string,
  deps: Pick<ConversationReadDependencies, 'resolveSessionFile'>,
): void {
  if (!isBackgroundFeatureEnabled('titleRefinement')) return;
  if (refinementScheduled.has(conversationName)) return;
  refinementScheduled.add(conversationName);

  const TIMEOUT_MS = 10 * 60 * 1000;
  const POLL_INTERVAL_MS = 1500;
  const startedAt = Date.now();

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let done = false;

  const stop = () => {
    done = true;
    if (timer) clearTimeout(timer);
    refinementScheduled.delete(conversationName);
  };

  async function tick(): Promise<void> {
    if (done) return;
    if (running) {
      timer = setTimeout(tick, POLL_INTERVAL_MS);
      return;
    }
    running = true;
    try {
      if (Date.now() - startedAt > TIMEOUT_MS) {
        console.log(`[title-refine] Timed out waiting for first assistant response in "${conversationName}"`);
        stop();
        return;
      }

      const conv = getConversationByName(conversationName);
      if (!conv) {
        stop();
        return;
      }
      if (conv.titleSource !== 'ai') {
        stop();
        return;
      }

      const sessionFile = await deps.resolveSessionFile(conv);
      if (!sessionFile || !existsSync(sessionFile)) {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }

      const { messages } = await getCachedMessages(sessionFile, false);
      const firstCompleteAssistant = messages.find(
        (m) => m.role === 'assistant' && m.completedAt,
      );
      if (!firstCompleteAssistant) {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }

      const transcript = serializeConversationTranscript(messages);
      if (!transcript.trim()) {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }

      console.log(`[claude-invoke] purpose=conversation-title-refine | model=${CONVERSATION_TITLE_MODEL} | conversation=${conversationName} | transcriptChars=${transcript.length}`);
      const refined = await summarizeTranscriptTitle(transcript, configuredTitleModel());
      if (!refined) {
        console.warn(`[title-refine] Model returned empty refined title for "${conversationName}"`);
        stop();
        return;
      }

      const freshConv = getConversationByName(conversationName);
      if (!freshConv || freshConv.titleSource !== 'ai') {
        console.log(`[title-refine] Conversation "${conversationName}" no longer eligible (source=${freshConv?.titleSource ?? 'missing'}); skipping`);
        stop();
        return;
      }

      updateConversationTitle(conversationName, refined, 'ai-refined');
      console.log(`[claude-invoke] SUCCESS purpose=conversation-title-refine | conversation=${conversationName} | title="${refined}"`);
      stop();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[title-refine] failed for "${conversationName}":`, msg);
      stop();
    } finally {
      running = false;
    }
  }

  timer = setTimeout(tick, POLL_INTERVAL_MS);
}

const MAX_TITLE_LENGTH = 200;

export function patchConversationTitle(
  name: string,
  body: Record<string, unknown>,
): { status: number; body: { success: true } | { error: string } } {
  const conv = getConversationByName(name);
  if (!conv) return { status: 404, body: { error: 'Conversation not found' } };

  if (typeof body.title === 'string' && body.title.trim()) {
    const trimmed = body.title.trim();
    if (trimmed.length > MAX_TITLE_LENGTH) {
      return { status: 400, body: { error: `Title exceeds maximum length of ${MAX_TITLE_LENGTH} characters` } };
    }
    updateConversationTitle(name, trimmed, 'manual');
  }

  return { status: 200, body: { success: true } };
}

const retitleInFlight = new Set<string>();
const EXPLICIT_RETITLE_TIMEOUT_MS = 90_000;

export function isClaudeInvocationTimeout(error: unknown): boolean {
  return error instanceof Error && /claude invocation timed out after \d+ms/.test(error.message);
}

interface ConversationAboutSummary {
  summary: string;
  messageCount: number;
  generatedAt: string;
}

const aboutSummaryCache = new Map<string, { transcriptSize: number; data: ConversationAboutSummary }>();
const ABOUT_SUMMARY_CACHE_MAX = 100;

export async function retitleConversation(
  name: string,
  deps: Pick<ConversationReadDependencies, 'resolveSessionFile'>,
): Promise<ConversationReadResult> {
  try {
    const conv = getConversationByName(name);
    if (!conv) return result({ error: 'Conversation not found' }, 404);
    if (retitleInFlight.has(name)) {
      return result({ error: 'A title regeneration is already running for this conversation' }, 409);
    }
    const sessionFile = await deps.resolveSessionFile(conv);
    if (!sessionFile || !existsSync(sessionFile)) {
      return result({ error: 'Conversation has no transcript yet' }, 400);
    }
    const { messages } = await getCachedMessages(sessionFile, false);
    const transcript = serializeConversationTranscript(messages);
    if (!transcript.trim()) {
      return result({ error: 'Conversation has no messages to summarize yet' }, 400);
    }

    retitleInFlight.add(name);
    try {
      const model = configuredTitleModel();
      console.log(`[claude-invoke] purpose=conversation-retitle | model=${model} | conversation=${name} | transcriptChars=${transcript.length}`);
      let title: string;
      try {
        title = await summarizeTranscriptTitle(transcript, model, EXPLICIT_RETITLE_TIMEOUT_MS);
      } catch (error: unknown) {
        if (!isClaudeInvocationTimeout(error)) throw error;
        title = fallbackTranscriptTitle(transcript);
        if (!title) throw error;
        console.warn(`[conversations] retitle timed out for "${name}"; using deterministic fallback title "${title}"`);
      }
      if (!title) return result({ error: 'Title model returned an empty result' }, 502);
      updateConversationTitle(name, title, 'ai');
      console.log(`[claude-invoke] SUCCESS purpose=conversation-retitle | conversation=${name} | title="${title}"`);
      return result({ title });
    } finally {
      retitleInFlight.delete(name);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[conversations] retitle failed for "${name}":`, msg);
    return result({ error: `Failed to regenerate title: ${msg}` }, 500);
  }
}

export async function getConversationAbout(
  name: string,
  forceRefresh: boolean,
  deps: Pick<ConversationReadDependencies, 'resolveSessionFile'>,
): Promise<ConversationReadResult> {
  try {
    const conv = getConversationByName(name);
    if (!conv) return result({ error: 'Conversation not found' }, 404);

    const sessionFile = await deps.resolveSessionFile(conv);
    if (!sessionFile || !existsSync(sessionFile)) {
      return result({ summary: null, messageCount: 0, generatedAt: null });
    }
    const { size } = await stat(sessionFile);
    const cached = aboutSummaryCache.get(name);
    if (!forceRefresh && cached && cached.transcriptSize === size) {
      return result({ ...cached.data, cached: true });
    }

    const { messages } = await getCachedMessages(sessionFile, false);
    const conversational = messages.filter(
      (m) => m.role !== 'system' && typeof m.text === 'string' && m.text.trim().length > 0,
    );
    if (conversational.length === 0) {
      return result({ summary: null, messageCount: 0, generatedAt: null });
    }

    const transcript = serializeConversationTranscript(messages);
    const aboutModel = configuredTitleModel();
    console.log(`[claude-invoke] purpose=conversation-about | model=${aboutModel} | conversation=${name} | transcriptChars=${transcript.length}`);
    const summary = await summarizeTranscriptAbout(transcript, aboutModel);
    if (!summary) return result({ error: 'Summary model returned an empty result' }, 502);

    const data: ConversationAboutSummary = {
      summary,
      messageCount: conversational.length,
      generatedAt: new Date().toISOString(),
    };
    aboutSummaryCache.set(name, { transcriptSize: size, data });
    if (aboutSummaryCache.size > ABOUT_SUMMARY_CACHE_MAX) {
      const firstKey = aboutSummaryCache.keys().next().value;
      if (firstKey !== undefined) aboutSummaryCache.delete(firstKey);
    }
    console.log(`[claude-invoke] SUCCESS purpose=conversation-about | conversation=${name} | summaryChars=${summary.length}`);
    return result({ ...data, cached: false });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[conversations] about summary failed for "${name}":`, msg);
    return result({ error: 'Failed to summarize conversation' }, 500);
  }
}
