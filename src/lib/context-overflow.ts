/**
 * Context-window overflow is NOT a transient error. It surfaces as e.g.
 * "API Error: 400 Your input exceeds the context window of this model." and
 * nudging "continue" only re-sends the same oversized context for the same 400.
 */
export const CONTEXT_OVERFLOW_PATTERNS = [
  'input exceeds the context window',
  'exceeds the context window of this model',
  'exceeded model token limit',
];

export const CONTEXT_OVERFLOW_TAIL_LINES = 40;

/**
 * Recognize context-window overflow from any thrown error, including the
 * claude -p non-zero exit envelope that carries "result":"Prompt is too long"
 * and "terminal_reason":"blocking_limit".
 */
export function isContextOverflowError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();
  const patterns = [
    ...CONTEXT_OVERFLOW_PATTERNS,
    'prompt is too long',
    'blocking_limit',
  ];
  return patterns.some(pattern => normalized.includes(pattern.toLowerCase()));
}

export function isContextOverflowTail(output: string): boolean {
  const recentTail = output.split('\n').slice(-CONTEXT_OVERFLOW_TAIL_LINES).join('\n');
  return CONTEXT_OVERFLOW_PATTERNS.some(pattern => recentTail.includes(pattern));
}

/**
 * PAN-1781: Opening prompt for a fresh session that replaces a context-wedged
 * one. The old session is summarized out-of-band and the summary is embedded
 * here — the fresh session never resumes the old JSONL, so there is no stale
 * leaf for the harness to rewind to (the failure mode that made in-place
 * boundary injection a silent no-op ~half the time).
 *
 * When summarization fails entirely, `summary` is null and the seed degrades
 * to durable-artifact reconstruction only — the same end state the old
 * /clear + reseed tier produced, minus the keystroke fragility.
 */
export function buildCompactRecoverySeedMessage(issueId: string, summary: string | null): string {
  const lines = [
    `Your previous session for ${issueId} hit the model's context-window limit, so you are starting a fresh session. This freed tokens; it did not reset your filesystem work.`,
    'Do NOT start over and do NOT expect the prior conversation to be available.',
  ];
  if (summary) {
    lines.push('', 'Summary of the archived session:', '', summary, '');
  } else {
    lines.push('');
  }
  lines.push(
    'Reconstruct your exact work-in-progress from durable artifacts:',
    '1. Read .pan/continue.json for resumePoint, decisions, hazards, feedback, and sessionHistory.',
    '2. Run `bd ready` for your open beads and `bd show <id>` for the bead you are working on.',
    '3. Inspect `git status` and `git diff` for uncommitted work already on disk.',
    'Then continue from that reconstructed state and complete the next required bead — do not wait for further instructions.',
  );
  return lines.join('\n');
}
