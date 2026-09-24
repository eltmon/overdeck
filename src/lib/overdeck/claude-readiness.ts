import { CONVERSATION_SESSION_ENDED_MARKER } from '../launcher-generator.js';
import { capturePane, isHarnessProcessAlive } from '../tmux.js';

/**
 * The error for a harness that exited before its conversation started, with
 * the last pane lines the harness printed (its exit reason, when it gave one).
 * The launcher's own "session ended" line is not part of the reason.
 */
function harnessEarlyExitError(paneText: string): Error {
  const lines = paneText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== CONVERSATION_SESSION_ENDED_MARKER);
  const tail = lines.slice(-5).join(' | ').slice(-500);
  return new Error(
    tail
      ? `Claude Code exited before writing a transcript. Last output: ${tail}`
      : 'Claude Code exited before writing a transcript, with no output in its pane.',
  );
}

/**
 * Wait for Claude Code's prompt. A harness that exits first leaves only the
 * launcher's keep-alive loop holding the pane, which reads as a live, empty
 * conversation (PAN-3827), so that exit is thrown as a spawn error.
 */
export async function waitForClaudeReady(tmuxSession: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let output = '';
  while (Date.now() < deadline) {
    output = await capturePane(tmuxSession, 200);
    if (output.includes(CONVERSATION_SESSION_ENDED_MARKER)) throw harnessEarlyExitError(output);
    if (output.includes('❯')) {
      console.log(`[conversations] Claude Code ready in ${tmuxSession}`);
      return;
    }
    await new Promise<void>((r) => setTimeout(r, 500));
  }
  if (!(await isHarnessProcessAlive(tmuxSession))) throw harnessEarlyExitError(output);
  console.warn(`[conversations] Timed out waiting for Claude Code prompt in ${tmuxSession}`);
}
