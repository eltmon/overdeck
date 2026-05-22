/**
 * Session-format converter (P0, 2026-05-14).
 *
 * When a conversation's harness changes (Claude Code <-> Pi Agent), the two
 * runtimes store transcripts in incompatible JSONL formats and in different
 * locations:
 *
 *   - Claude Code: ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
 *   - Pi Agent:    ~/.panopticon/agents/<tmux-session>/sessions/<iso>_<id>.jsonl
 *
 * Historically the orchestrator would silently flip the harness and leave the
 * old transcript orphaned (the DB kept pointing at a session id with no file),
 * and the compaction path would even append Claude-format records into a Pi
 * JSONL. The chosen fix is to *convert* on an explicit harness change rather
 * than guard against it or build a multi-format reader.
 *
 * The conversion is deliberately lossless-of-content but lossy-of-structure:
 * we extract a readable transcript from the source format and seed a fresh
 * session in the target format with that transcript carried in as a single
 * continuation/summary message — the same "faux compaction boundary" mechanism
 * Panopticon already uses for native compaction. Tool-call structure, thinking
 * blocks, and per-message token accounting do not round-trip; the conversation
 * *content* does. This keeps the converter robust as both harness formats
 * continue to evolve.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Data, Effect } from 'effect';

import type { RuntimeName } from './runtimes/types.js';
import { sessionFilePath } from './paths.js';

export interface ConvertOptions {
  fromHarness: RuntimeName;
  toHarness: RuntimeName;
  /** Absolute path to the existing source-format JSONL transcript. */
  sourceSessionFile: string;
  /** Conversation working directory (used to locate the Claude project dir). */
  cwd: string;
  /** tmux session name, e.g. `conv-20260514-4336` (used for the Pi session dir). */
  tmuxSession: string;
}

export interface ConvertResult {
  /** Session id the target harness should resume. */
  sessionId: string;
  /** Absolute path to the freshly-written target-format JSONL. */
  targetSessionFile: string;
}

interface TranscriptTurn {
  role: string;
  text: string;
}

/** Pull plain text out of a Claude/Pi `message.content` (string or block array). */
function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (typeof b['text'] === 'string') parts.push(b['text'] as string);
    else if (typeof b['thinking'] === 'string') parts.push(`[thinking] ${b['thinking'] as string}`);
    else if (b['type'] === 'tool_use' && typeof b['name'] === 'string') {
      parts.push(`[tool_use: ${b['name'] as string}]`);
    } else if (b['type'] === 'tool_result') {
      const inner = extractContentText(b['content']);
      if (inner) parts.push(`[tool_result] ${inner}`);
    }
  }
  return parts.join('\n').trim();
}

/** Read a Claude Code JSONL transcript into ordered role/text turns. */
function extractClaudeTranscript(raw: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = entry['type'];
    if (type !== 'user' && type !== 'assistant') continue;
    const message = entry['message'];
    if (!message || typeof message !== 'object') continue;
    const m = message as Record<string, unknown>;
    const role = typeof m['role'] === 'string' ? (m['role'] as string) : (type as string);
    const text = extractContentText(m['content']);
    if (text) turns.push({ role, text });
  }
  return turns;
}

/** Read a Pi Agent JSONL transcript into ordered role/text turns. */
function extractPiTranscript(raw: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry['type'] !== 'message') continue;
    const message = entry['message'];
    if (!message || typeof message !== 'object') continue;
    const m = message as Record<string, unknown>;
    const role = typeof m['role'] === 'string' ? (m['role'] as string) : 'assistant';
    const text = extractContentText(m['content']);
    if (text) turns.push({ role, text });
  }
  return turns;
}

/** Render ordered turns into a single readable transcript block. */
function renderTranscript(turns: TranscriptTurn[]): string {
  return turns
    .map((t) => `### ${t.role}\n${t.text}`)
    .join('\n\n');
}

function buildContinuation(fromHarness: RuntimeName, transcript: string): string {
  return [
    `This session is being continued from a previous conversation that ran under the ${fromHarness} harness.`,
    'The runtime was switched, so the transcript below is carried forward as context rather than as a native session.',
    'Continue from this history without redoing already-completed work.',
    '',
    '--- PRIOR TRANSCRIPT ---',
    transcript || '(the prior transcript was empty)',
    '--- END PRIOR TRANSCRIPT ---',
  ].join('\n');
}

/** Short opaque id in Pi's `<8-hex>` style. */
function shortId(): string {
  return randomBytes(4).toString('hex');
}async function convertConversationTranscriptPromise(opts: ConvertOptions): Promise<ConvertResult> {
  if (opts.fromHarness === opts.toHarness) {
    throw new Error(`convertConversationTranscript called with no harness change (${opts.fromHarness})`);
  }

  const raw = await readFile(opts.sourceSessionFile, 'utf-8');
  const turns =
    opts.fromHarness === 'pi' ? extractPiTranscript(raw) : extractClaudeTranscript(raw);
  const continuation = buildContinuation(opts.fromHarness, renderTranscript(turns));
  const timestamp = new Date().toISOString();

  if (opts.toHarness === 'pi') {
    const sessionId = randomUUID();
    const agentDir = join(homedir(), '.panopticon', 'agents', opts.tmuxSession);
    const sessionDir = join(agentDir, 'sessions');
    await mkdir(sessionDir, { recursive: true, mode: 0o700 });
    const fileName = `${timestamp.replace(/[:.]/g, '-')}_${sessionId}.jsonl`;
    const targetSessionFile = join(sessionDir, fileName);
    const lines = [
      JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp, cwd: opts.cwd }),
      JSON.stringify({
        type: 'message',
        id: shortId(),
        parentId: null,
        timestamp,
        message: { role: 'user', content: [{ type: 'text', text: continuation }] },
      }),
    ];
    await writeFile(targetSessionFile, `${lines.join('\n')}\n`, 'utf-8');
    // spawnConversationSession resumes Pi from <agentDir>/session.id — point it
    // at the converted session so the new runtime picks up the carried history.
    await writeFile(join(agentDir, 'session.id'), `${sessionId}\n`, 'utf-8');
    return { sessionId, targetSessionFile };
  }

  // toHarness === 'claude-code'
  const sessionId = randomUUID();
  const targetSessionFile = sessionFilePath(opts.cwd, sessionId);
  await mkdir(join(targetSessionFile, '..'), { recursive: true });
  const boundaryUuid = randomUUID();
  const lines = [
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: 'system',
      subtype: 'compact_boundary',
      content: `Conversation runtime switched from ${opts.fromHarness} to claude-code`,
      isMeta: false,
      timestamp,
      uuid: boundaryUuid,
      sessionId,
      cwd: opts.cwd,
      level: 'info',
      compactMetadata: { trigger: 'panopticon-harness-switch', preTokens: 0 },
    }),
    JSON.stringify({
      parentUuid: boundaryUuid,
      isSidechain: false,
      type: 'user',
      message: { role: 'user', content: continuation },
      isVisibleInTranscriptOnly: true,
      isCompactSummary: true,
      uuid: randomUUID(),
      sessionId,
      cwd: opts.cwd,
      timestamp,
    }),
  ];
  await writeFile(targetSessionFile, `${lines.join('\n')}\n`, 'utf-8');
  return { sessionId, targetSessionFile };
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Tagged error for session-format-converter Effect variants. */
export class SessionConvertError extends Data.TaggedError('SessionConvertError')<{
  readonly fromHarness: RuntimeName;
  readonly toHarness: RuntimeName;
  readonly sourceSessionFile: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Effect variant of `convertConversationTranscript`. */
export const convertConversationTranscript = (
  opts: ConvertOptions,
): Effect.Effect<ConvertResult, SessionConvertError> =>
  Effect.tryPromise({
    try: () => convertConversationTranscriptPromise(opts),
    catch: (cause) =>
      new SessionConvertError({
        fromHarness: opts.fromHarness,
        toHarness: opts.toHarness,
        sourceSessionFile: opts.sourceSessionFile,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

