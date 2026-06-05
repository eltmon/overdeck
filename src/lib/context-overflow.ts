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
