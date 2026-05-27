/**
 * Conversation fork pipeline.
 *
 * This module handles creating a new conversation from an existing one.
 * Two modes are supported:
 *
 * 1. Summary fork (default): The conversation history is serialized and sent
 *    to an LLM summarizer (see smart-compaction.ts). The generated structured
 *    summary is injected as the first user message in the new session.
 *
 * 2. Plain fork: Raw JSONL history is copied from the last compact_boundary
 *    into a new session file. Thinking blocks are sanitized (converted to text)
 *    to prevent signature validation errors on cross-model resumes.
 *
 * Entry point: createSummaryFork()
 * - Reserves a new session ID and file path
 * - Generates summary (LLM, heuristic fallback, or skips for plain fork)
 * - Creates a DB record for the new conversation
 * - Returns the new conversation + session metadata
 *
 * Dashboard API: runForkPipeline() in src/dashboard/server/routes/conversations.ts
 * wires the options through and handles tmux spawn + summary injection.
 */
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';

import type { Conversation } from '../database/conversations-db.js';
import {
  createConversation,
  getConversationByName,
  recordConversationHandoff,
  updateConversationForkFallbackReason,
} from '../database/conversations-db.js';
import { encodeClaudeProjectDir, packageRoot, sessionFilePath } from '../paths.js';
import { loadConfigSync } from '../config-yaml.js';
import { deliverAgentMessage } from '../agents.js';
import { generateSmartSummary, parseEntries, runModelSummary, serializeConversation } from './smart-compaction.js';
import { createHandoffPaths, ensureHandoffsDir, type HandoffPaths } from './handoff-paths.js';
import type { RuntimeName } from '../runtimes/types.js';
import { FsError } from '../errors.js';
import { getWorkspaceStackHealth } from '../workspace/stack-health.js';

export type SummaryForkMode = 'summary' | 'plain' | 'handoff';
export type HandoffAuthor = 'source' | 'external';

export interface SummaryForkOptions {
  model?: string;
  cwd?: string;
  harness?: RuntimeName;
  localSummaryOnly?: boolean;
  forkMode?: SummaryForkMode;
  focus?: string;
  handoffTimeoutMs?: number;
  handoffPollIntervalMs?: number;
  /** When true, include thinking block content in the serialized conversation sent to the summary model. Default: true. */
  includeThinkingInSummary?: boolean;
  /**
   * Who authors the handoff document when forkMode === 'handoff'.
   *
   * - 'source' (legacy): deliver the handoff prompt to the live source agent
   *   via deliverAgentMessage and wait for it to write the doc + .done sentinel.
   *   Requires the source conversation to be alive. Pollutes the source's
   *   context. Uses whatever model/harness the source is running on.
   * - 'external' (default): spawn a separate authoring session with the chosen
   *   model/harness that reads the source JSONL transcript and emits the doc.
   *   Does not touch the source conversation. Works on ended sources.
   */
  handoffAuthor?: HandoffAuthor;
  /** Model for the external handoff authoring session. Ignored when handoffAuthor === 'source'. */
  handoffAuthorModel?: string;
  /** Harness for the external handoff authoring session. Ignored when handoffAuthor === 'source'. */
  handoffAuthorHarness?: RuntimeName;
}

export interface SummaryForkResult {
  conversation: Conversation;
  sessionId: string;
  sessionFile: string;
  summary: string;
  summaryModel: string | null;
  forkMode: SummaryForkMode;
  handoffDocPath: string | null;
  forkFallbackReason: string | null;
}

const FORK_WAIT_INSTRUCTION = `\n---\n\n**Do not take any action.** This is context from a prior conversation fork. Acknowledge the summary and wait for the user's next instruction.`;
const DEFAULT_HANDOFF_TIMEOUT_MS = 300_000;
const DEFAULT_HANDOFF_POLL_INTERVAL_MS = 1_000;
const NO_HANDOFF_FOCUS = 'No specific focus was provided.';

export type HandoffDocValidation =
  | { ok: true }
  | { ok: false; reason: string };

export interface RequestHandoffOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: Date;
}

export interface RequestHandoffResult {
  docPath: string;
  docText: string;
}

export class HandoffStallError extends Error {
  constructor(
    public readonly docPath: string,
    public readonly sentinelPath: string,
    public readonly timeoutMs: number,
  ) {
    super(`Timed out waiting ${timeoutMs}ms for handoff document and sentinel: ${docPath}, ${sentinelPath}`);
    this.name = 'HandoffStallError';
  }
}

export class HandoffValidationError extends Error {
  constructor(
    public readonly docPath: string,
    public readonly reason: string,
  ) {
    super(`Invalid handoff document ${docPath}: ${reason}`);
    this.name = 'HandoffValidationError';
  }
}

/**
 * Strip a wrapping ``` fenced code block from the doc body if the LLM
 * helpfully wrapped its Markdown output in a fence. Returns the inner
 * content if a fence was detected, otherwise returns the trimmed input.
 */
export function sanitizeHandoffDoc(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  return fenceMatch?.[1]?.trim() ?? trimmed;
}

export function validateHandoffDoc(text: string): HandoffDocValidation {
  const sanitized = sanitizeHandoffDoc(text);
  if (sanitized.length < 200) {
    return { ok: false, reason: 'handoff document must be at least 200 characters' };
  }
  // Accept any heading depth (H1-H6), case-insensitive, with an optional
  // trailing colon. Real-world LLM outputs vary on heading conventions; the
  // failure mode of a too-strict validator is silent fallback to summary fork
  // with no surface to the user, which is the worst outcome.
  if (!/^#{1,6}\s+suggested skills\s*:?\s*$/imu.test(sanitized)) {
    return { ok: false, reason: 'handoff document must contain a Suggested skills heading' };
  }
  return { ok: true };
}

function renderHandoffPrompt(template: string, focus: string | undefined, outputPath: string): string {
  const safeFocus = focus?.trim() || NO_HANDOFF_FOCUS;
  return template
    .split('{{focus}}').join(safeFocus)
    .split('{{outputPath}}').join(outputPath);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHandoffDoc(paths: HandoffPaths, timeoutMs: number, pollIntervalMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      await access(paths.docPath);
      await access(paths.sentinelPath);
      return await readFile(paths.docPath, 'utf-8');
    } catch {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new HandoffStallError(paths.docPath, paths.sentinelPath, timeoutMs);
      }
      await delay(Math.min(pollIntervalMs, remainingMs));
    }
  }
}

const DEFAULT_HANDOFF_AUTHOR_MODEL = 'claude-sonnet-4-6';
const HANDOFF_AUTHOR_TIMEOUT_MS = 300_000;

function renderExternalHandoffPrompt(template: string, focus: string | undefined, transcript: string): string {
  const safeFocus = focus?.trim() || NO_HANDOFF_FOCUS;
  return template
    .split('{{focus}}').join(safeFocus)
    .split('{{transcript}}').join(transcript);
}

/**
 * Author a handoff document from an external authoring session.
 *
 * Reads the source JSONL transcript and asks a fresh, isolated model session
 * (with the chosen model + harness) to write the handoff Markdown. The source
 * conversation is never contacted — its context is not polluted.
 *
 * Returns the same { docPath, docText } shape as requestHandoffFromAgent so
 * callers can substitute one for the other.
 */
export async function authorHandoffExternal(
  sourceConv: Conversation,
  sourceSessionFile: string,
  focus: string | undefined,
  model: string | undefined,
  harness: RuntimeName | undefined,
  options: { now?: Date } = {},
): Promise<RequestHandoffResult> {
  await ensureHandoffsDir();
  const timestamp = (options.now ?? new Date()).toISOString();
  const paths = createHandoffPaths(sourceConv.name, timestamp);
  const template = await readFile(join(packageRoot, 'roles', 'handoff-external.md'), 'utf-8');
  const entries = await parseEntries(sourceSessionFile);
  // Skip thinking blocks — they're large and the structured output we want
  // doesn't need internal reasoning, only the user/assistant exchange.
  const transcript = serializeConversation(entries, /* includeThinking */ false);
  const prompt = renderExternalHandoffPrompt(template, focus, transcript);

  const effectiveModel = model ?? DEFAULT_HANDOFF_AUTHOR_MODEL;
  const effectiveHarness: RuntimeName = harness ?? 'claude-code';
  console.log(`[claude-invoke] purpose=handoff-author-external | model=${effectiveModel} | harness=${effectiveHarness} | source=${sourceConv.name} | transcriptChars=${transcript.length}`);

  const docText = await Effect.runPromise(runModelSummary(prompt, effectiveModel, HANDOFF_AUTHOR_TIMEOUT_MS, effectiveHarness));
  const validation = validateHandoffDoc(docText);
  if (!validation.ok) {
    // Persist the rejected output for diagnosis. Without this the LLM's actual
    // response is lost and "why did validation fail" is impossible to answer
    // after the fact — see PAN-1518 follow-up: silent fallback is the worst
    // failure mode for handoff.
    const rejectedPath = `${paths.docPath}.rejected.md`;
    await writeFile(rejectedPath, docText, 'utf-8').catch((err) => {
      console.warn(`[handoff-author-external] failed to persist rejected output to ${rejectedPath}: ${err?.message ?? err}`);
    });
    console.warn(`[handoff-author-external] validation rejected output (${validation.reason}); raw output saved to ${rejectedPath}`);
    throw new HandoffValidationError(paths.docPath, validation.reason);
  }

  const sanitized = sanitizeHandoffDoc(docText);
  await writeFile(paths.docPath, sanitized, 'utf-8');
  await writeFile(paths.sentinelPath, '', 'utf-8');

  return { docPath: paths.docPath, docText: sanitized };
}

export async function requestHandoffFromAgent(
  sourceConv: Conversation,
  focus?: string,
  options: RequestHandoffOptions = {},
): Promise<RequestHandoffResult> {
  await ensureHandoffsDir();
  const timestamp = (options.now ?? new Date()).toISOString();
  const paths = createHandoffPaths(sourceConv.name, timestamp);
  const template = await readFile(join(packageRoot, 'roles', 'handoff.md'), 'utf-8');
  const prompt = renderHandoffPrompt(template, focus, paths.docPath);

  await deliverAgentMessage(sourceConv.tmuxSession, prompt, 'handoff-request');

  const docText = await waitForHandoffDoc(
    paths,
    options.timeoutMs ?? DEFAULT_HANDOFF_TIMEOUT_MS,
    options.pollIntervalMs ?? DEFAULT_HANDOFF_POLL_INTERVAL_MS,
  );
  const validation = validateHandoffDoc(docText);
  if (!validation.ok) {
    // The source agent already wrote the file to docPath. Move it aside to
    // .rejected.md so the next handoff attempt doesn't reuse a stale invalid
    // doc and so the operator can inspect what the agent wrote.
    const rejectedPath = `${paths.docPath}.rejected.md`;
    await writeFile(rejectedPath, docText, 'utf-8').catch((err) => {
      console.warn(`[handoff-source] failed to persist rejected output to ${rejectedPath}: ${err?.message ?? err}`);
    });
    console.warn(`[handoff-source] validation rejected source-authored doc (${validation.reason}); raw output saved to ${rejectedPath}`);
    throw new HandoffValidationError(paths.docPath, validation.reason);
  }

  return { docPath: paths.docPath, docText: sanitizeHandoffDoc(docText) };
}

function workspaceSourceFromCwd(sourceConv: Conversation): { issueId: string; workspacePath: string } | null {
  const normalizedCwd = sourceConv.cwd.replace(/\\/g, '/');
  const match = normalizedCwd.match(/^((?:(?:.*)\/)?workspaces\/feature-([a-z]+-\d+))(?:\/.*)?$/i);
  if (!match?.[1] || !match[2]) return null;
  return {
    issueId: sourceConv.issueId ?? match[2].toUpperCase(),
    workspacePath: match[1],
  };
}

export async function handoffPreconditionFallbackReason(sourceConv: Conversation): Promise<string | null> {
  if (sourceConv.status === 'ended') return 'source-ended';

  const workspaceSource = workspaceSourceFromCwd(sourceConv);
  if (!workspaceSource) return null;

  try {
    await access(join(workspaceSource.workspacePath, '.devcontainer'));
  } catch {
    return null;
  }

  const health = await Effect.runPromise(getWorkspaceStackHealth(workspaceSource.issueId, {
    workspacePath: workspaceSource.workspacePath,
  }));
  return health.healthy ? 'source-workspace-devcontainer' : null;
}

export function handoffFailureReason(error: unknown): string {
  if (error instanceof HandoffStallError) return 'handoff-timeout';
  if (error instanceof HandoffValidationError) return 'handoff-validation';
  return 'handoff-request-failed';
}

export function logHandoffFallback(sourceConv: Conversation, reason: string): void {
  console.warn(`[summary-fork] handoff-fallback source=${sourceConv.name} reason=${reason}`);
}

/**
 * When a handoff falls back to a summary fork, the user's focus text would
 * otherwise be silently dropped. Prepend a small notice to the summary so the
 * successor conversation still sees what was asked, and so the user gets a
 * visible breadcrumb that the intended handoff failed.
 */
export function prependFallbackFocus(summary: string, focus: string | undefined, fallbackReason: string): string {
  const trimmedFocus = focus?.trim();
  if (!trimmedFocus) return summary;
  const header = [
    `**Note from Panopticon:** the intended handoff fell back to a summary fork (\`${fallbackReason}\`). The focus you requested is preserved below; the summary that follows is auto-generated, not an authored handoff document.`,
    '',
    '**Requested focus:**',
    '',
    `> ${trimmedFocus.split('\n').join('\n> ')}`,
    '',
    '---',
    '',
  ].join('\n');
  return header + summary;
}

async function generateSummarySeed(
  sourceSessionFile: string,
  summaryModel: string | undefined,
  localSummaryOnly: boolean | undefined,
  includeThinkingInSummary: boolean | undefined,
  summaryHarness?: RuntimeName,
): Promise<{ summary: string; summaryModel: string | null }> {
  if (localSummaryOnly) {
    return {
      summary: await Effect.runPromise(generateFallbackSummary(sourceSessionFile)),
      summaryModel: null,
    };
  }
  return generateSummaryForFork(sourceSessionFile, summaryModel, includeThinkingInSummary, summaryHarness);
}

async function generateFallbackSummaryPromise(jsonlPath: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const lines = (await readFile(jsonlPath, 'utf-8'))
    .split('\n')
    .filter((l) => l.trim());

  const userMessages: string[] = [];
  const filesModified = new Set<string>();
  const toolsUsed = new Set<string>();

  for (const line of lines) {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === 'user' && entry.message) {
      const content = entry.message.content;
      if (typeof content === 'string' && content.trim()) {
        if (!content.trim().startsWith('<local-command') && !content.trim().startsWith('<command-name')) {
          userMessages.push(content.trim());
        }
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text?.trim() && !block.text.trim().startsWith('<')) {
            userMessages.push(block.text.trim());
          }
        }
      }
    }

    if (entry.type === 'assistant' && entry.message?.content) {
      const content = entry.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use') {
            toolsUsed.add(block.name);
            if (block.name === 'Edit' || block.name === 'Write') {
              const fp = block.input?.file_path || block.input?.path;
              if (fp) filesModified.add(fp);
            }
          }
        }
      }
    }
  }

  let summary = `## Conversation Summary Fork\n\n`;
  summary += `This is a continuation of a previous conversation, seeded with a summary of the earlier work.\n\n`;

  if (userMessages.length > 0) {
    summary += `### User Messages:\n`;
    for (const msg of userMessages.slice(0, 10)) {
      summary += `- ${msg.slice(0, 200)}${msg.length > 200 ? '...' : ''}\n`;
    }
    summary += '\n';
  }

  if (filesModified.size > 0) {
    summary += `### Files Modified:\n`;
    for (const f of [...filesModified].sort()) {
      summary += `- \`${f.replace(/.*\/panopticon-cli\//, '')}\`\n`;
    }
    summary += '\n';
  }

  if (toolsUsed.size > 0) {
    summary += `### Tools Used: ${[...toolsUsed].sort().join(', ')}\n\n`;
  }

  summary += FORK_WAIT_INSTRUCTION;

  return summary;
}

export async function generateSummaryForFork(jsonlPath: string, summaryModel?: string, includeThinkingInSummary?: boolean, summaryHarness: RuntimeName = 'claude-code'): Promise<{ summary: string; summaryModel: string | null }> {
  if (!summaryModel) {
    // Fork summaries serialize the entire conversation in one shot. Sonnet 4.6's
    // 1M-token context handles large sessions that would overflow Haiku's 200k.
    summaryModel = 'claude-sonnet-4-6';
  }

  console.log(`[claude-invoke] purpose=summary-fork | model=${summaryModel} | harness=${summaryHarness} | source=summary-fork.ts:generateSummaryForFork | jsonl=${jsonlPath}`);

  const { config } = loadConfigSync();
  const richMode = config.conversations.richCompaction;

  try {
    const result = await Effect.runPromise(generateSmartSummary({ jsonlPath, model: summaryModel, richMode, mode: 'fork', includeThinkingInSummary, harness: summaryHarness }));
    console.log(`[claude-invoke] SUCCESS purpose=summary-fork | model=${summaryModel} | outputChars=${result.summary.length}`);
    return { summary: result.summary + FORK_WAIT_INSTRUCTION, summaryModel };
  } catch (err: any) {
    console.error(`[claude-invoke] FAILED purpose=summary-fork | model=${summaryModel} | error="${err.message}"`);
    throw err;
  }
}async function reserveSummaryForkSessionPromise(
  cwd: string,
): Promise<{ sessionId: string; sessionFile: string }> {
  const sessionId = randomUUID();
  const encodedDir = encodeClaudeProjectDir(cwd);
  const sessionsDir = join(process.env.HOME ?? '', '.claude', 'projects', encodedDir);

  await mkdir(sessionsDir, { recursive: true });

  return {
    sessionId,
    sessionFile: join(sessionsDir, `${sessionId}.jsonl`),
  };
}

/**
 * Find the byte offset of the last `compact_boundary` entry in a JSONL file.
 * Returns 0 if no boundary is found.
 */
async function findLastCompactBoundaryOffset(jsonlPath: string): Promise<number> {
  const { readFile } = await import('node:fs/promises');
  const content = await readFile(jsonlPath, 'utf-8');
  const lines = content.split('\n');
  let offset = 0;
  let lastBoundaryOffset = 0;
  for (const line of lines) {
    if (line.trim()) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
          lastBoundaryOffset = offset;
        }
      } catch { /* skip invalid lines */ }
    }
    offset += line.length + 1; // +1 for \n
  }
  return lastBoundaryOffset;
}

/**
 * Sanitize assistant entries by converting thinking blocks to plain text.
 * This prevents API errors when resuming a session cross-model/provider,
 * since thinking block signatures are bound to the original API request.
 */
function sanitizeEntryForPlainFork(entry: any): any {
  if (entry.type !== 'assistant' || !entry.message || !Array.isArray(entry.message.content)) {
    return entry;
  }

  const sanitizedContent = entry.message.content.map((block: any) => {
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      // Convert thinking block to text block so the new model doesn't
      // attempt to validate a signature bound to a different API request.
      return {
        type: 'text',
        text: `[Thinking]\n${block.thinking}`,
      };
    }
    return block;
  });

  return {
    ...entry,
    message: {
      ...entry.message,
      content: sanitizedContent,
    },
  };
}async function copySessionFromCompactBoundaryPromise(
  sourcePath: string,
  destPath: string,
): Promise<void> {
  const { readFile, writeFile } = await import('node:fs/promises');
  const boundaryOffset = await findLastCompactBoundaryOffset(sourcePath);
  const content = await readFile(sourcePath, 'utf-8');
  const sliced = boundaryOffset > 0 ? content.slice(boundaryOffset) : content;

  // Sanitize each line to strip thinking signatures
  const sanitizedLines = sliced.split('\n').map((line) => {
    if (!line.trim()) return line;
    try {
      const entry = JSON.parse(line);
      const sanitized = sanitizeEntryForPlainFork(entry);
      return JSON.stringify(sanitized);
    } catch {
      // Keep malformed lines as-is
      return line;
    }
  });

  await writeFile(destPath, sanitizedLines.join('\n'), 'utf-8');
}async function createSummaryForkPromise(
  conv: Conversation,
  options: SummaryForkOptions = {},
): Promise<SummaryForkResult> {
  const sourceSessionFile = conv.claudeSessionId
    ? sessionFilePath(conv.cwd, conv.claudeSessionId)
    : null;
  if (!sourceSessionFile) {
    throw new Error(`No session file found for conversation ${conv.name}`);
  }

  const cwd = options.cwd || conv.cwd || process.cwd();
  const launchModel = options.model || conv.model;
  const summaryModel = options.model || conv.model;
  const forkMode = options.forkMode ?? 'summary';
  console.log(`[summary-fork] Forking conv=${conv.name} launchModel=${launchModel || 'default'} summaryModel=${summaryModel || 'default'} localOnly=${options.localSummaryOnly || false} forkMode=${forkMode}`);

  const { sessionId, sessionFile } = await Effect.runPromise(reserveSummaryForkSession(cwd));

  let summary: string;
  let usedSummaryModel: string | null;
  let effectiveForkMode = forkMode;
  let handoffDocPath: string | null = null;
  let forkFallbackReason: string | null = null;

  if (forkMode === 'plain') {
    // Plain fork: copy raw JSONL from last compact boundary (or full history)
    // into the new session file so Claude Code can --resume it directly.
    await Effect.runPromise(copySessionFromCompactBoundary(sourceSessionFile, sessionFile));
    summary = '';
    usedSummaryModel = null;
  } else if (forkMode === 'handoff') {
    const handoffAuthor: HandoffAuthor = options.handoffAuthor ?? 'external';
    if (handoffAuthor === 'external') {
      // External authoring: read the source JSONL and have a fresh authoring
      // session write the handoff doc. Source conversation is never touched.
      // Works on ended source conversations and lets the user pick the
      // authoring model/harness independently of the source.
      try {
        const handoff = await authorHandoffExternal(
          conv,
          sourceSessionFile,
          options.focus,
          options.handoffAuthorModel,
          options.handoffAuthorHarness,
        );
        summary = handoff.docText;
        usedSummaryModel = options.handoffAuthorModel ?? DEFAULT_HANDOFF_AUTHOR_MODEL;
        handoffDocPath = handoff.docPath;
      } catch (error) {
        forkFallbackReason = handoffFailureReason(error);
        effectiveForkMode = 'summary';
        logHandoffFallback(conv, forkFallbackReason);
        const result = await generateSummarySeed(sourceSessionFile, summaryModel ?? undefined, options.localSummaryOnly, options.includeThinkingInSummary);
        summary = prependFallbackFocus(result.summary, options.focus, forkFallbackReason);
        usedSummaryModel = result.summaryModel;
      }
    } else {
      // Source authoring (legacy): deliver the handoff prompt to the live
      // source agent and wait for it to write the doc + .done sentinel.
      // Requires the source conversation to be alive and pollutes its
      // context with the handoff turn pair.
      const preconditionFallback = await handoffPreconditionFallbackReason(conv);
      if (preconditionFallback) {
        forkFallbackReason = preconditionFallback;
        effectiveForkMode = 'summary';
        logHandoffFallback(conv, preconditionFallback);
        const result = await generateSummarySeed(sourceSessionFile, summaryModel ?? undefined, options.localSummaryOnly, options.includeThinkingInSummary);
        summary = prependFallbackFocus(result.summary, options.focus, preconditionFallback);
        usedSummaryModel = result.summaryModel;
      } else {
        try {
          const handoff = await requestHandoffFromAgent(conv, options.focus, {
            timeoutMs: options.handoffTimeoutMs,
            pollIntervalMs: options.handoffPollIntervalMs,
          });
          summary = handoff.docText;
          usedSummaryModel = null;
          handoffDocPath = handoff.docPath;
        } catch (error) {
          forkFallbackReason = handoffFailureReason(error);
          effectiveForkMode = 'summary';
          logHandoffFallback(conv, forkFallbackReason);
          const result = await generateSummarySeed(sourceSessionFile, summaryModel ?? undefined, options.localSummaryOnly, options.includeThinkingInSummary);
          summary = prependFallbackFocus(result.summary, options.focus, forkFallbackReason);
          usedSummaryModel = result.summaryModel;
        }
      }
    }
  } else {
    const result = await generateSummarySeed(sourceSessionFile, summaryModel ?? undefined, options.localSummaryOnly, options.includeThinkingInSummary);
    summary = result.summary;
    usedSummaryModel = result.summaryModel;
  }

  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = randomUUID().slice(0, 4);
  const newName = `${timestamp}-${suffix}`;
  const newTmux = `conv-${newName}`;

  let newConv = createConversation({
    name: newName,
    tmuxSession: newTmux,
    cwd,
    issueId: conv.issueId ?? undefined,
    title: effectiveForkMode === 'plain'
      ? `Fork: ${conv.title || conv.name}`
      : effectiveForkMode === 'handoff'
        ? `Handoff: ${conv.title || conv.name}`
        : `Summary Fork: ${conv.title || conv.name}`,
    titleSource: 'manual',
    titleSeed: effectiveForkMode === 'plain'
      ? `Fork of ${conv.name}`
      : effectiveForkMode === 'handoff'
        ? `Handoff of ${conv.name}`
        : `Summary Fork of ${conv.name}`,
    claudeSessionId: sessionId,
    model: launchModel ?? undefined,
    effort: conv.effort ?? undefined,
    harness: options.harness ?? conv.harness ?? undefined,
  });
  if (handoffDocPath) {
    newConv = recordConversationHandoff(conv.name, newConv.name, handoffDocPath);
  }
  if (forkFallbackReason) {
    updateConversationForkFallbackReason(newConv.name, forkFallbackReason);
    newConv = getConversationByName(newConv.name) ?? newConv;
  }

  return {
    conversation: newConv,
    sessionId,
    sessionFile,
    summary,
    summaryModel: usedSummaryModel,
    forkMode: effectiveForkMode,
    handoffDocPath,
    forkFallbackReason,
  };
}

// Re-export runModelSummary for any callers that need it directly
export { runModelSummary };

// ─── Effect variants (PAN-1249, additive) ────────────────────────────────────
//
// Additive Effect surface for fork helpers. Failures from the underlying
// fs ops or LLM calls surface as FsError (filesystem failures) or Error
// (LLM / generation failures). The existing Promise functions remain
// canonical; these are wrappers for Effect-native callers.

/** Effect variant of generateFallbackSummary. */
export function generateFallbackSummary(
  jsonlPath: string,
): Effect.Effect<string, FsError> {
  return Effect.tryPromise({
    try: () => generateFallbackSummaryPromise(jsonlPath),
    catch: (cause) =>
      new FsError({ path: jsonlPath, operation: 'fallback-summary', cause }),
  });
}

/** Effect variant of reserveSummaryForkSession. */
export function reserveSummaryForkSession(
  cwd: string,
): Effect.Effect<{ sessionId: string; sessionFile: string }, FsError> {
  return Effect.tryPromise({
    try: () => reserveSummaryForkSessionPromise(cwd),
    catch: (cause) =>
      new FsError({ path: cwd, operation: 'reserve-session', cause }),
  });
}

/** Effect variant of copySessionFromCompactBoundary. */
export function copySessionFromCompactBoundary(
  sourcePath: string,
  destPath: string,
): Effect.Effect<void, FsError> {
  return Effect.tryPromise({
    try: () => copySessionFromCompactBoundaryPromise(sourcePath, destPath),
    catch: (cause) =>
      new FsError({ path: sourcePath, operation: 'copy-session', cause }),
  });
}

/** Effect variant of createSummaryFork. */
export function createSummaryFork(
  conv: Conversation,
  options: SummaryForkOptions = {},
): Effect.Effect<SummaryForkResult, FsError> {
  return Effect.tryPromise({
    try: () => createSummaryForkPromise(conv, options),
    catch: (cause) =>
      new FsError({ path: conv.name, operation: 'create-summary-fork', cause }),
  });
}
