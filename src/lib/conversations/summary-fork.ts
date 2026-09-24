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
 * Entry point: handleConversationSummaryFork() in
 * src/lib/overdeck/conversation-forks.ts reserves the session
 * (reserveSummaryForkSession) and hands its id to runForkPipeline(), which
 * generates the seed (generateSummaryForFork, requestHandoffFromAgent /
 * authorHandoffExternal, or copySessionFromCompactBoundary for a plain fork)
 * and handles the spawn and summary injection. This module holds those
 * helpers.
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';

import type { LegacyConversation as Conversation } from '../overdeck/conversations.js';
import { packageRoot } from '../paths.js';
import { encodeClaudeProjectDir, sessionFilePath } from '../runtimes/storage/claude-code.js';
import { loadConfigSync } from '../config-yaml.js';
import { deliverAgentMessage } from '../agents.js';
import { runModelSummary } from './smart-compaction.js';
import { getTranscriptAdapter } from './transcript-adapter.js';
import { createHandoffPaths, ensureHandoffsDir, type HandoffPaths } from './handoff-paths.js';
import type { RuntimeName } from '../runtimes/types.js';
import { getWorkspaceStackHealth } from '../workspace/stack-health.js';

export type SummaryForkMode = 'summary' | 'plain' | 'handoff';
export type HandoffAuthor = 'source' | 'external';

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

class HandoffValidationError extends Error {
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
function sanitizeHandoffDoc(text: string): string {
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

const HANDOFF_AUTHOR_TIMEOUT_MS = 300_000;

/**
 * PAN-3860: thrown when no handoff authoring model is available — neither a
 * per-call override (`--author-model`) nor `conversations.handoff_author_model`
 * in config.yaml. There is deliberately no hardcoded fallback model (repo
 * rule: never hardcode a model fallback). This is a distinct error type so
 * callers can distinguish "operator hasn't configured this" from a
 * transient authoring failure: the former must fail the whole pipeline
 * loudly, never silently degrade to a plain summary fork.
 */
export class HandoffAuthorModelNotConfiguredError extends Error {
  constructor() {
    super('no handoff author model configured: set conversations.handoff_author_model in ~/.overdeck/config.yaml');
    this.name = 'HandoffAuthorModelNotConfiguredError';
  }
}

// When the raw transcript exceeds this many characters, pre-compact it via
// generateSmartSummary (which chunks internally) before sending to the
// handoff authoring model. Threshold chosen to keep the final prompt
// comfortably under Haiku's 200k-token window (~800k chars at 4 chars/token,
// minus headroom for the template, focus, and a response budget). The exact
// value isn't critical — anything that triggers compaction for "long"
// transcripts is fine.
const HANDOFF_TRANSCRIPT_COMPACT_THRESHOLD = 100_000;

function renderExternalHandoffPrompt(template: string, focus: string | undefined, transcript: string, outputPath: string): string {
  const safeFocus = focus?.trim() || NO_HANDOFF_FOCUS;
  return template
    .split('{{focus}}').join(safeFocus)
    .split('{{outputPath}}').join(outputPath)
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

  const effectiveModel = model ?? loadConfigSync().config.conversations.handoffAuthorModel;
  if (!effectiveModel) throw new HandoffAuthorModelNotConfiguredError();
  const effectiveHarness: RuntimeName = harness ?? 'claude-code';

  // The authoring harness decides the prompt template: Claude Code's `Write`
  // tool vs Pi's lowercase `write` tool, with harness-specific phrasing about
  // how the model should call it. Both templates share the same H2 contract,
  // and the file-on-disk read below is harness-independent.
  const templateName = effectiveHarness === 'ohmypi' ? 'handoff-external-pi.md' : 'handoff-external.md';
  const template = await readFile(join(packageRoot, 'roles', templateName), 'utf-8');

  // The source's harness decides how the transcript is read/serialized; the
  // authoring harness (model + harness picked by the user) is independent.
  const sourceAdapter = getTranscriptAdapter(sourceConv.harness ?? undefined);
  // Skip thinking blocks — they're large and the structured output we want
  // doesn't need internal reasoning, only the user/assistant exchange.
  const transcript = await sourceAdapter.serializeTranscript(sourceSessionFile, { includeThinking: false });

  // If the raw transcript is small enough, feed it to the model verbatim —
  // that's the richest input. For long transcripts we'd overflow any model's
  // context window in a single-pass prompt, so first compact via the chunked
  // generateSmartSummary path (which already handles chunking + merging) and
  // feed the compact summary to the handoff authoring step. The handoff
  // template treats {{transcript}} as opaque context — a compact summary
  // works as well as the raw transcript, just with less fine detail.
  let promptInput: string;
  let inputLabel: 'raw-transcript' | 'compact-summary';
  // Precompaction goes through the source adapter's compactSummary, which is
  // harness-agnostic: claude-code uses the entry-aware smart-compaction flow,
  // Pi (and future harnesses) serialize their transcript and run the generic
  // chunk-and-merge summarizer. Either way a long source transcript is
  // compacted before it reaches the authoring model's context window.
  if (transcript.length > HANDOFF_TRANSCRIPT_COMPACT_THRESHOLD) {
    console.log(`[claude-invoke] purpose=handoff-author-external | model=${effectiveModel} | harness=${effectiveHarness} | source=${sourceConv.name} | transcriptChars=${transcript.length} | precompacting=true`);
    const { config } = loadConfigSync();
    const richMode = config.conversations.richCompaction;
    const compact = await sourceAdapter.compactSummary(sourceSessionFile, {
      model: effectiveModel,
      richMode,
      includeThinking: false,
      harness: effectiveHarness,
    });
    promptInput = compact.summary;
    inputLabel = 'compact-summary';
    console.log(`[claude-invoke] purpose=handoff-author-external precompact-result | model=${effectiveModel} | compactChars=${compact.summary.length}`);
  } else {
    promptInput = transcript;
    inputLabel = 'raw-transcript';
  }

  const prompt = renderExternalHandoffPrompt(template, focus, promptInput, paths.docPath);
  console.log(`[claude-invoke] purpose=handoff-author-external | model=${effectiveModel} | harness=${effectiveHarness} | source=${sourceConv.name} | inputType=${inputLabel} | promptChars=${prompt.length} | outputPath=${paths.docPath}`);

  // The prompt tells the model to use its Write tool to author the document
  // directly at paths.docPath. We capture stdout only as a diagnostic log —
  // the source of truth for the doc is the file on disk. Writing via tool
  // avoids stdout preamble leaks like "Here is the handoff document:" that
  // contaminated earlier attempts.
  //
  // The authoring session is headless (`claude -p`), so the Write tool must be
  // explicitly allowlisted — otherwise `--permission-mode auto` raises a
  // permission prompt the session can never answer, the model emits "I need
  // permission to write…" to stdout, no file is written, and the whole fork
  // falls back to a plain summary with reason `handoff-validation` (PAN-1582).
  // Pi runs in rpc mode and auto-executes tools, so the allowlist is a no-op there.
  const stdout = await runModelSummary(prompt, effectiveModel, HANDOFF_AUTHOR_TIMEOUT_MS, effectiveHarness, ['Write']);
  console.log(`[claude-invoke] purpose=handoff-author-external acknowledgement | model=${effectiveModel} | stdoutChars=${stdout.length} | stdoutPreview=${JSON.stringify(stdout.slice(0, 120))}`);

  let docText: string;
  try {
    docText = await readFile(paths.docPath, 'utf-8');
  } catch (err) {
    // The model didn't use Write — it almost certainly produced the doc on
    // stdout instead. Persist whatever we got for diagnosis, then surface
    // the failure as a validation error so the pipeline falls back to a
    // summary fork rather than spinning forever.
    const rejectedPath = `${paths.docPath}.rejected.md`;
    await writeFile(rejectedPath, stdout, 'utf-8').catch((wErr) => {
      console.warn(`[handoff-author-external] failed to persist stdout to ${rejectedPath}: ${wErr?.message ?? wErr}`);
    });
    console.warn(`[handoff-author-external] model did not call Write — stdout (${stdout.length} chars) saved to ${rejectedPath}: ${(err as { message?: string })?.message ?? err}`);
    throw new HandoffValidationError(paths.docPath, 'authoring session did not call its Write tool to create the handoff doc');
  }

  const validation = validateHandoffDoc(docText);
  if (!validation.ok) {
    // The file exists but its content failed the contract check. Persist
    // the rejected file for diagnosis and surface the reason.
    const rejectedPath = `${paths.docPath}.rejected.md`;
    await writeFile(rejectedPath, docText, 'utf-8').catch((err) => {
      console.warn(`[handoff-author-external] failed to persist rejected doc to ${rejectedPath}: ${err?.message ?? err}`);
    });
    console.warn(`[handoff-author-external] validation rejected file content (${validation.reason}); copy saved to ${rejectedPath}`);
    throw new HandoffValidationError(paths.docPath, validation.reason);
  }

  // Sanitize as a safety net in case the model wrapped the file in fences
  // despite the prompt telling it not to. Overwrite the file with the
  // cleaned text so downstream consumers see the same thing the validator
  // approved.
  const sanitized = sanitizeHandoffDoc(docText);
  if (sanitized !== docText) {
    await writeFile(paths.docPath, sanitized, 'utf-8');
  }
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
    `**Note from Overdeck:** the intended handoff fell back to a summary fork (\`${fallbackReason}\`). The focus you requested is preserved below; the summary that follows is auto-generated, not an authored handoff document.`,
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

function buildFallbackSummary(
  userMessages: string[],
  filesModified: Set<string>,
  toolsUsed: Set<string>,
): string {
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
      summary += `- \`${f.replace(/.*\/overdeck\//, '')}\`\n`;
    }
    summary += '\n';
  }

  if (toolsUsed.size > 0) {
    summary += `### Tools Used: ${[...toolsUsed].sort().join(', ')}\n\n`;
  }

  summary += FORK_WAIT_INSTRUCTION;

  return summary;
}

/** Build a deterministic, model-free summary of a session transcript (the fallback when the model summary fails). */
export async function generateFallbackSummary(jsonlPath: string, harness?: RuntimeName): Promise<string> {
  const adapter = getTranscriptAdapter(harness);
  if (adapter.name !== 'claude-code') {
    const serialized = await adapter.serializeTranscript(jsonlPath, { includeThinking: false });
    const userMessages: string[] = [];
    const filesModified = new Set<string>();
    const toolsUsed = new Set<string>();

    for (const part of serialized.split('\n\n')) {
      if (part.startsWith('[user]\n')) {
        userMessages.push(part.slice('[user]\n'.length));
      } else if (part.startsWith('[tool_use: ')) {
        const closingBracket = part.indexOf(']');
        if (closingBracket !== -1) {
          toolsUsed.add(part.slice('[tool_use: '.length, closingBracket));
        }
      }
    }

    return buildFallbackSummary(userMessages, filesModified, toolsUsed);
  }

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

  return buildFallbackSummary(userMessages, filesModified, toolsUsed);
}

export async function generateSummaryForFork(
  jsonlPath: string,
  summaryModel?: string,
  includeThinkingInSummary?: boolean,
  summaryHarness: RuntimeName = 'claude-code',
  sourceHarness?: RuntimeName,
): Promise<{ summary: string; summaryModel: string | null }> {
  if (!summaryModel) {
    // Fork summaries serialize the entire conversation in one shot. Sonnet 4.6's
    // 1M-token context handles large sessions that would overflow Haiku's 200k.
    summaryModel = 'claude-sonnet-4-6';
  }

  console.log(`[claude-invoke] purpose=summary-fork | model=${summaryModel} | summaryHarness=${summaryHarness} | sourceHarness=${sourceHarness ?? 'claude-code'} | source=summary-fork.ts:generateSummaryForFork | jsonl=${jsonlPath}`);

  const { config } = loadConfigSync();
  const richMode = config.conversations.richCompaction;

  // The source harness selects which transcript adapter parses/serializes the
  // JSONL (Pi and Claude Code have different shapes); the summary harness
  // selects which CLI backend runs the summarizer LLM. They are independent —
  // e.g. a Pi source can be summarized by a Claude model.
  const adapter = getTranscriptAdapter(sourceHarness);

  try {
    const result = await adapter.compactSummary(jsonlPath, {
      model: summaryModel,
      richMode,
      includeThinking: includeThinkingInSummary,
      harness: summaryHarness,
    });
    console.log(`[claude-invoke] SUCCESS purpose=summary-fork | model=${summaryModel} | outputChars=${result.summary.length}`);
    return { summary: result.summary + FORK_WAIT_INSTRUCTION, summaryModel };
  } catch (err: any) {
    console.error(`[claude-invoke] FAILED purpose=summary-fork | model=${summaryModel} | error="${err.message}"`);
    throw err;
  }
}

/** Reserve a new session id and file for a summary fork in `cwd`. */
export async function reserveSummaryForkSession(
  cwd: string,
): Promise<{ sessionId: string; sessionFile: string }> {
  // Delegate session reservation to the shared conversation-fork primitive.
  const { reserveForkSession } = await import('./session-fork.js');
  return reserveForkSession(cwd);
}

/** Copy a session transcript from its last compact boundary into a fork's session file. */
export async function copySessionFromCompactBoundary(
  sourcePath: string,
  destPath: string,
): Promise<void> {
  const { copySessionForFork } = await import('./session-fork.js');
  return copySessionForFork(sourcePath, destPath, { fullHistory: false });
}

// Re-export runModelSummary for any callers that need it directly
export { runModelSummary };
