/**
 * The kickoff failure for a harness that never signalled ready while its pane
 * is still alive (PAN-3905).
 *
 * A blocking prompt (Claude Code's folder-trust dialog, a login screen) is
 * exactly that case, so the last non-blank pane lines ride along, capped, and
 * the operator sees the prompt in the error instead of a bare
 * `ready-signal-timeout`. The failure always starts with that token.
 */

/** Pane lines read when the ready signal times out. */
export const READY_TIMEOUT_PANE_LINES = 20;
/** How many of those lines, and how many characters, reach the failure. */
const TAIL_LINES = 6;
const TAIL_LINE_CHARS = 160;
const TAIL_CHARS = 600;

export function readySignalTimeoutFailure(paneText: string | null): string {
  const lines = (paneText ?? '')
    .split('\n')
    // eslint-disable-next-line no-control-regex
    .map((line) => line.replace(/[\u0000-\u001f\u007f]/g, '').trim())
    .filter((line) => line.length > 0)
    .slice(-TAIL_LINES)
    .map((line) => (line.length > TAIL_LINE_CHARS ? `${line.slice(0, TAIL_LINE_CHARS)}…` : line));
  if (lines.length === 0) return 'ready-signal-timeout';
  let tail = lines.join(' | ');
  if (tail.length > TAIL_CHARS) tail = `…${tail.slice(-TAIL_CHARS)}`;
  return `ready-signal-timeout (last pane lines: ${tail})`;
}

/**
 * Read the agent's pane on the host's backend and build the failure. A pane
 * that cannot be read (Herdr throws when it holds no pane) gives the bare
 * token: it still says what failed.
 */
export async function readySignalTimeoutFailureFor(agentId: string): Promise<string> {
  try {
    const { readAgentPaneText } = await import('../terminal-backends/agent-pane-io.js');
    return readySignalTimeoutFailure(await readAgentPaneText(agentId, READY_TIMEOUT_PANE_LINES));
  } catch {
    return readySignalTimeoutFailure(null);
  }
}
