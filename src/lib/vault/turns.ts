/**
 * Session Vault human-turn labeling (PAN-2609, FR-18).
 *
 * Turn numbers count only prompts a person typed. Harnesses also write
 * user-role lines that no human typed: Claude Code's `<task-notification>`,
 * slash-command echoes, tool results and compaction summaries; Codex's
 * `<environment_context>` and friends. Those are matched by their exact known
 * prefixes, never by "starts with `<`", so a typed prompt that begins with
 * `<div>` still counts.
 *
 * Codex writes a typed prompt both as a model-facing `response_item` message
 * (role `user`) and as an `event_msg` echo. Only the `response_item` form is
 * counted here, because the injected context lines FR-18 names are written in
 * that form and counting both forms would double every turn.
 *
 * Imports nothing outside this file.
 */
/** Harness families whose transcripts the vault understands. */
export type TurnHarness = 'claude-code' | 'codex';

/** Exact prefixes of Claude Code user-role lines that no human typed. */
export const CLAUDE_INJECTED_PREFIXES: readonly string[] = [
  '<task-notification>',
  '<command-name>',
  '<local-command-stdout>',
  '<local-command-caveat>',
  '[Request interrupted by user]',
];

/** Exact prefixes of Codex user-role lines that no human typed. */
export const CODEX_INJECTED_PREFIXES: readonly string[] = [
  '<environment_context>',
  '<codex_internal_context>',
  '# Files mentioned by the user:',
];

function parse(line: string | unknown): unknown {
  if (typeof line !== 'string') return line;
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function hasInjectedPrefix(text: string, prefixes: readonly string[]): boolean {
  const trimmed = text.trimStart();
  return prefixes.some((prefix) => trimmed.startsWith(prefix));
}

/** Visible text of a Claude Code user entry; undefined for tool_result-only entries. */
function claudeUserText(entry: Record<string, unknown>): string | undefined {
  if (entry.type !== 'user') return undefined;
  if (entry.isCompactSummary === true) return undefined;
  const message = entry.message as { role?: unknown; content?: unknown } | undefined;
  if (!message || typeof message !== 'object') return undefined;
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  if (content.some((block) => block && typeof block === 'object' && (block as { type?: unknown }).type === 'tool_result')) {
    return undefined;
  }
  const text = content
    .filter((block) => block && typeof block === 'object' && (block as { type?: unknown }).type === 'text')
    .map((block) => (block as { text?: unknown }).text)
    .filter((value): value is string => typeof value === 'string')
    .join('');
  return text.length > 0 ? text : undefined;
}

/** Visible text of a Codex model-facing user message (`response_item`, role `user`). */
function codexUserText(entry: Record<string, unknown>): string | undefined {
  if (entry.type !== 'response_item') return undefined;
  const payload = entry.payload as { type?: unknown; role?: unknown; content?: unknown } | undefined;
  if (!payload || typeof payload !== 'object') return undefined;
  if (payload.type !== 'message' || payload.role !== 'user') return undefined;
  const content = payload.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((part) => (part && typeof part === 'object' ? (part as { type?: unknown; text?: unknown }) : undefined))
    .filter((part) => part && typeof part.text === 'string' && /^(input_)?text$/i.test(String(part.type)))
    .map((part) => part!.text as string)
    .join('');
  return text.length > 0 ? text : undefined;
}

/**
 * True when the line is a prompt a person typed. Accepts a raw JSONL line or an
 * already-parsed entry.
 */
export function isHumanTurn(line: string | unknown, harness: TurnHarness): boolean {
  const entry = parse(line);
  if (!entry || typeof entry !== 'object') return false;
  const record = entry as Record<string, unknown>;
  if (harness === 'claude-code') {
    const text = claudeUserText(record);
    if (text === undefined || text.trim().length === 0) return false;
    return !hasInjectedPrefix(text, CLAUDE_INJECTED_PREFIXES);
  }
  const text = codexUserText(record);
  if (text === undefined || text.trim().length === 0) return false;
  return !hasInjectedPrefix(text, CODEX_INJECTED_PREFIXES);
}

/** Count human turns across a transcript's lines. */
export function countHumanTurns(lines: readonly (string | unknown)[], harness: TurnHarness): number {
  return lines.filter((line) => isHumanTurn(line, harness)).length;
}
