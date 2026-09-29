/**
 * Session Vault seeded continuation (PAN-2609, decision P-16).
 *
 * When a harness cannot resume a materialized transcript natively, the vault
 * hands it a markdown digest of the VIEW instead: every human turn (FR-18) plus
 * the final assistant text of each turn, capped at 32 KB, under a header that
 * says plainly it is not a native resume. No model is involved; the digest is
 * built from the saved lines alone. Imports only Node built-ins and sibling
 * vault modules.
 */
import type { SessionRecord } from './format.js';
import { isHumanTurn, type TurnHarness } from './turns.js';

export const SEED_DIGEST_MAX_BYTES = 32 * 1024;

export function seedHeader(title: string): string {
  return `[Session Vault] Seeded continuation of ${JSON.stringify(title)} (not a native resume)`;
}

/** File name the digest is written to for harnesses that get no launch. */
export function seedFileName(vaultId: string): string {
  return `.overdeck-vault-seed-${vaultId}.md`;
}

interface Turn {
  human: string;
  assistant: string | null;
}

function parse(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function textOf(content: unknown, textTypes: readonly string[]): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) => (part && typeof part === 'object' ? (part as { type?: unknown; text?: unknown }) : undefined))
    .filter((part) => part && typeof part.text === 'string' && textTypes.includes(String(part.type).toLowerCase()))
    .map((part) => part!.text as string)
    .join('\n');
  return text.length > 0 ? text : null;
}

function humanText(entry: Record<string, unknown>, harness: string): string | null {
  if (harness === 'codex') {
    const payload = entry.payload as { content?: unknown } | undefined;
    return textOf(payload?.content, ['input_text', 'text']);
  }
  const message = entry.message as { content?: unknown } | undefined;
  return textOf(message?.content, ['text']);
}

function assistantText(entry: Record<string, unknown>, harness: string): string | null {
  if (harness === 'codex') {
    if (entry.type !== 'response_item') return null;
    const payload = entry.payload as { type?: unknown; role?: unknown; content?: unknown } | undefined;
    if (!payload || payload.type !== 'message' || payload.role !== 'assistant') return null;
    return textOf(payload.content, ['output_text', 'text']);
  }
  if (entry.type !== 'assistant') return null;
  const message = entry.message as { content?: unknown } | undefined;
  return textOf(message?.content, ['text']);
}

/** Group the VIEW lines into human turns with the last assistant text of each. */
export function collectTurns(lines: readonly string[], harness: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of lines) {
    const entry = parse(line);
    if (!entry) continue;
    if (isHumanTurn(entry, harness as TurnHarness)) {
      const human = humanText(entry, harness);
      if (human) turns.push({ human: human.trim(), assistant: null });
      continue;
    }
    const assistant = assistantText(entry, harness);
    if (assistant && turns.length > 0) turns[turns.length - 1]!.assistant = assistant.trim();
  }
  return turns;
}

/**
 * Build the digest for `record` from its VIEW lines. The result never exceeds
 * `SEED_DIGEST_MAX_BYTES`; when the turns do not fit, the oldest are dropped
 * first and a line says how many were omitted.
 */
export function buildSeedDigest(record: Pick<SessionRecord, 'title' | 'harness' | 'cwd' | 'vaultId'>, viewLines: readonly string[]): string {
  const header = seedHeader(record.title);
  const preamble = [
    header,
    '',
    `Vault record: ${record.vaultId}`,
    `Harness: ${record.harness}`,
    `Saved cwd: ${record.cwd}`,
    '',
    'The conversation below was saved by Session Vault and could not be resumed natively.',
    'Continue from where it left off.',
    '',
  ].join('\n');
  const turns = collectTurns(viewLines, record.harness);
  const rendered = turns.map((turn, index) => {
    const parts = [`## Turn ${index + 1}`, '', '**Human:**', '', turn.human];
    if (turn.assistant) parts.push('', '**Assistant (final):**', '', turn.assistant);
    return parts.join('\n');
  });

  let start = 0;
  let body = '';
  while (start <= rendered.length) {
    const kept = rendered.slice(start);
    const omitted = start > 0 ? `_${start} earlier turn${start === 1 ? '' : 's'} omitted to fit the size cap._\n\n` : '';
    body = `${preamble}${omitted}${kept.join('\n\n')}\n`;
    if (Buffer.byteLength(body, 'utf8') <= SEED_DIGEST_MAX_BYTES || kept.length === 0) break;
    start++;
  }
  if (Buffer.byteLength(body, 'utf8') > SEED_DIGEST_MAX_BYTES) {
    // A single turn larger than the cap: keep the header and truncate the tail.
    const bytes = Buffer.from(body, 'utf8').subarray(0, SEED_DIGEST_MAX_BYTES - 1);
    body = `${bytes.toString('utf8').replace(/�+$/, '')}\n`;
  }
  return body;
}
