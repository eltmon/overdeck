/**
 * Claude Code transcript effort parsing (PAN-4255).
 *
 * Pure functions, no I/O. They read two signals out of a claude-code session
 * transcript:
 *  - the `<local-command-stdout>` record Claude Code writes after `/effort <level>`
 *    (the confirmation record, or a rejection), and
 *  - the `effort` / `perTurnEffort` fields every assistant record carries on
 *    Claude Code >= 2.1.280 (the observed effort).
 */
import { isEffortLevel, type EffortLevel } from '@overdeck/contracts';

export type EffortCommandResult =
  | { kind: 'set'; level: EffortLevel }
  | { kind: 'rejected'; message: string };

const SET_PATTERN = /Set effort level to ([a-z]+)\b/;
const REJECT_PATTERNS = [/Invalid argument:[^<]*/, /Failed to set effort level[^<]*/, /Not applied:[^<]*/];

/** Reads one `<local-command-stdout>` string. Null when it is not an /effort result. */
export function parseEffortCommandStdout(content: string): EffortCommandResult | null {
  if (!content.includes('<local-command-stdout>')) return null;
  const set = SET_PATTERN.exec(content);
  if (set && isEffortLevel(set[1])) return { kind: 'set', level: set[1] };
  for (const pattern of REJECT_PATTERNS) {
    const hit = pattern.exec(content);
    if (hit) return { kind: 'rejected', message: hit[0].trim() };
  }
  return null;
}

/** The effort a single JSONL record shows, or null. Sidechain records never count. */
export function observedEffortFromRecord(record: unknown): EffortLevel | null {
  if (!record || typeof record !== 'object') return null;
  const entry = record as Record<string, unknown>;
  if (entry['isSidechain'] === true) return null;
  if (entry['type'] === 'assistant') {
    if (isEffortLevel(entry['effort'])) return entry['effort'];
    if (isEffortLevel(entry['perTurnEffort'])) return entry['perTurnEffort'];
    return null;
  }
  if (entry['type'] === 'user') {
    const message = entry['message'];
    if (!message || typeof message !== 'object') return null;
    const content = (message as Record<string, unknown>)['content'];
    if (typeof content !== 'string') return null;
    const result = parseEffortCommandStdout(content);
    return result?.kind === 'set' ? result.level : null;
  }
  return null;
}
