/**
 * Conversation transcript summarization.
 *
 * Shared helpers for turning a conversation's parsed messages into LLM-generated
 * artifacts:
 *
 *  - `summarizeFirstMessageTitle()` — the conversation-creation auto-title
 *    (titles from the opening user message only).
 *  - `summarizeTranscriptTitle()` — a fresh title generated from the *whole*
 *    conversation, used by the explicit "regenerate title" action.
 *  - `summarizeTranscriptAbout()` — a few-sentence description of what the
 *    conversation has been about, used by the conversation "About" drawer.
 *
 * All three call the Claude CLI with a hardcoded Haiku model — fast and cheap
 * for short structured outputs. There is no fallback: callers log the failure
 * and keep whatever artifact already exists.
 *
 * This module deliberately reads no files itself. Callers pass already-parsed
 * `ChatMessage[]` (via `serializeConversationTranscript`) so it stays a pure
 * leaf utility, importable from both CLI and dashboard-server code without a
 * layering inversion.
 */
import { spawn } from 'node:child_process';
import type { ChatMessage } from '@panctl/contracts';
import { buildChildEnvSync } from '../child-env.js';
import { getProviderEnvForModel } from '../agents.js';

/** Haiku — fast/cheap, used for every conversation title and about-summary. */
export const CONVERSATION_TITLE_MODEL = 'claude-haiku-4-5-20251001';

/** Total transcript characters allowed into a single prompt. */
const TRANSCRIPT_BUDGET = 24_000;
/** Per-message character cap before truncation — keeps one verbose turn from eating the budget. */
const PER_MESSAGE_LIMIT = 1_800;
/** When over budget, keep this many opening characters (captures original intent). */
const HEAD_BUDGET = 8_000;
/** ...and this many trailing characters (captures the current direction). */
const TAIL_BUDGET = 15_000;

const TITLE_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
} as const;

const ABOUT_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
} as const;

type TranscriptMessage = Pick<ChatMessage, 'role' | 'text'>;

/**
 * Render parsed conversation messages into a compact plain-text transcript
 * suitable for a summarization prompt.
 *
 * Tool calls/results are intentionally excluded — the parsed `messages` array
 * already holds only conversational text (tool activity lives in `workLog`).
 * Over-budget transcripts keep the head and tail so both the original intent
 * and the latest direction survive.
 */
export function serializeConversationTranscript(
  messages: ReadonlyArray<TranscriptMessage>,
): string {
  const rendered = messages
    .filter((m) => m.role !== 'system' && typeof m.text === 'string' && m.text.trim().length > 0)
    .map((m) => {
      const speaker = m.role === 'user' ? 'User' : 'Assistant';
      let text = m.text.trim();
      if (text.length > PER_MESSAGE_LIMIT) {
        text = `${text.slice(0, PER_MESSAGE_LIMIT)}…`;
      }
      return `${speaker}: ${text}`;
    });

  const joined = rendered.join('\n\n');
  if (joined.length <= TRANSCRIPT_BUDGET) {
    return joined;
  }
  const head = joined.slice(0, HEAD_BUDGET);
  const tail = joined.slice(joined.length - TAIL_BUDGET);
  return `${head}\n\n[… middle of the conversation omitted for length …]\n\n${tail}`;
}

/** Strip quotes, collapse whitespace, and keep the first line of a model-produced title. */
export function sanitizeTitle(raw: string | null | undefined): string {
  if (!raw) return '';
  return (
    raw
      .trim()
      .split(/\r?\n/)[0]
      ?.trim()
      .replace(/^['"`]+|['"`]+$/g, '')
      .trim()
      .replace(/\s+/g, ' ') ?? ''
  );
}

/**
 * Invoke `claude -p` with a JSON schema and return the structured output.
 * Throws on non-zero exit, timeout, spawn error, or unparseable output.
 */
async function invokeClaudeStructured(
  model: string,
  prompt: string,
  schema: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  const providerEnv = await getProviderEnvForModel(model);
  const childEnv = { ...buildChildEnvSync(), ...providerEnv };

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      'claude',
      ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--model', model],
      { env: childEnv },
    );
    let out = '';
    let errOut = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`claude invocation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (data: string) => { out += data; });
    child.stderr.on('data', (data: string) => { errOut += data; });
    child.on('error', (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(errOut || `claude invocation exited with code ${code}`));
      } else {
        resolve(out);
      }
    });
    try {
      child.stdin.write(prompt, 'utf-8');
      child.stdin.end();
    } catch (err) {
      clearTimeout(timeout);
      child.kill('SIGTERM');
      reject(err);
    }
  });

  // Claude CLI returns { structured_output: {...}, ... } or the bare object.
  const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
  const structured = parsed['structured_output'];
  return structured && typeof structured === 'object'
    ? (structured as Record<string, unknown>)
    : parsed;
}

/** Generate a 3-8 word title from the opening user message (conversation-creation path). */
export async function summarizeFirstMessageTitle(
  firstMessage: string,
  model = CONVERSATION_TITLE_MODEL,
): Promise<string> {
  const prompt = [
    'You write concise thread titles for coding conversations.',
    "Summarize the user's request in 3-8 words.",
    'Avoid quotes, filler, prefixes, and trailing punctuation.',
    '',
    'User message:',
    firstMessage,
  ].join('\n');
  const result = await invokeClaudeStructured(model, prompt, TITLE_SCHEMA);
  return sanitizeTitle(typeof result['title'] === 'string' ? (result['title'] as string) : '');
}

/** Generate a fresh 3-8 word title from the whole conversation (explicit retitle action). */
export async function summarizeTranscriptTitle(
  transcript: string,
  model = CONVERSATION_TITLE_MODEL,
): Promise<string> {
  const prompt = [
    'You write concise thread titles for coding conversations.',
    'Read the whole conversation below and write a 3-8 word title that captures',
    'what it is *currently* about. If the topic shifted, favor the most recent direction.',
    'Avoid quotes, filler, prefixes, and trailing punctuation.',
    '',
    'Conversation:',
    transcript,
  ].join('\n');
  const result = await invokeClaudeStructured(model, prompt, TITLE_SCHEMA);
  return sanitizeTitle(typeof result['title'] === 'string' ? (result['title'] as string) : '');
}

/** Generate a 2-4 sentence description of what the conversation has been about. */
export async function summarizeTranscriptAbout(
  transcript: string,
  model = CONVERSATION_TITLE_MODEL,
): Promise<string> {
  const prompt = [
    'You summarize coding conversations for a quick-reference panel.',
    'In 2-4 plain sentences, describe what this conversation has been about:',
    "the user's goal, the main things explored or done, and where it currently stands.",
    'Be specific and factual. No preamble, no lists, no markdown.',
    '',
    'Conversation:',
    transcript,
  ].join('\n');
  const result = await invokeClaudeStructured(model, prompt, ABOUT_SCHEMA, 45_000);
  return typeof result['summary'] === 'string' ? (result['summary'] as string).trim() : '';
}
