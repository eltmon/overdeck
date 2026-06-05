/**
 * Context-window overflow is NOT a transient error. It surfaces as e.g.
 * "API Error: 400 Your input exceeds the context window of this model." and
 * nudging "continue" only re-sends the same oversized context for the same 400.
 */
export const CONTEXT_OVERFLOW_PATTERNS = [
  'input exceeds the context window',
  'exceeds the context window of this model',
];

export const CONTEXT_OVERFLOW_TAIL_LINES = 40;

export function isContextOverflowTail(output: string): boolean {
  const recentTail = output.split('\n').slice(-CONTEXT_OVERFLOW_TAIL_LINES).join('\n');
  return CONTEXT_OVERFLOW_PATTERNS.some(pattern => recentTail.includes(pattern));
}

export function buildContextOverflowReseedMessage(): string {
  return [
    'Your prior conversation was cleared to recover from a context-window overflow. This freed tokens; it did not reset your filesystem work.',
    'Do NOT start over and do NOT expect the prior conversation to be available.',
    'Reconstruct your exact work-in-progress from durable artifacts only:',
    '1. Read .pan/continue.json for resumePoint, decisions, hazards, feedback, and sessionHistory.',
    '2. Run `bd ready` for your open beads and `bd show <id>` for the bead you are working on.',
    '3. Inspect `git status` and `git diff` for uncommitted work already on disk.',
    'Then continue from that reconstructed state and complete the next required bead.',
  ].join('\n');
}
