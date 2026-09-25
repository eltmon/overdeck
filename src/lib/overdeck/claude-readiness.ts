import { CONVERSATION_SESSION_ENDED_MARKER } from '../launcher-generator.js';
import { LEGACY_TMUX_PROBE_TIMEOUT_MS, queryTmuxSession } from '../agents/tmux-session-query.js';
import { readAgentPaneText } from '../terminal-backends/agent-pane-io.js';
import { hostTerminalBackendName } from '../terminal-backends/select.js';
import { exactPaneTarget, tmuxExecAsync } from '../tmux.js';
import { paneTreeHasHarnessProcess, readProcessTable } from '../tmux-process-tree.js';

/**
 * The head of the launcher's "session ended" line. The full marker is 84
 * characters and soft-wraps in a narrower pane (a dashboard client attached
 * during the wait resizes it), so the match uses this prefix, which fits on
 * one line at any usable width (review of #4137).
 */
const SESSION_ENDED_PREFIX = CONVERSATION_SESSION_ENDED_MARKER.slice(0, CONVERSATION_SESSION_ENDED_MARKER.indexOf('.') + 1);

/**
 * The error for a harness that exited before its conversation started, with
 * the last pane lines the harness printed (its exit reason, when it gave one).
 * The launcher's own "session ended" line, wrapped or not, is not part of the
 * reason: everything from its prefix on is dropped.
 */
function harnessEarlyExitError(paneText: string, sessionGone = false): Error {
  const markerAt = paneText.lastIndexOf(SESSION_ENDED_PREFIX);
  const lines = (markerAt === -1 ? paneText : paneText.slice(0, markerAt))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const tail = lines.slice(-5).join(' | ').slice(-500);
  // Neutral wording: the launcher can exit before Claude Code ever starts (an
  // unreadable launch-context file), and then the session is gone too.
  const what = sessionGone
    ? 'The conversation process exited before it was ready; its tmux session is gone, so the launcher itself exited'
    : 'The conversation process exited before it was ready';
  return new Error(tail ? `${what}. Last output: ${tail}` : `${what}, with no output in its pane.`);
}

/**
 * What the deadline probe could establish about the pane. Only `session-gone`
 * and `harness-gone` are answers; `unknown` means a tmux or `ps` call failed
 * (a server hiccup, a socket race during a reload), which says nothing about
 * the harness, so it must never become a spawn error (review of #4137).
 */
type HarnessExitProbe = 'alive' | 'session-gone' | 'harness-gone' | 'unknown';

/**
 * The deadline probe on the host's backend. On Herdr (PAN-3921) the
 * backend-aware liveness module answers; the tmux path below keeps its
 * three-part session query, so a tmux error stays `unknown`.
 */
async function probeHarnessExit(tmuxSession: string): Promise<HarnessExitProbe> {
  if ((await hostTerminalBackendName()) === 'herdr') return probeHarnessExitOnHerdr(tmuxSession);
  return probeHarnessExitOnTmux(tmuxSession);
}

/**
 * A Herdr conversation execs its harness with no keep-alive loop, so a harness
 * that exited leaves no pane (`no-session`) or an exited agent: both are
 * `harness-gone` (the tmux wording about a launcher exit does not apply). Only
 * a confirmed answer counts; an indeterminate probe is `unknown`.
 */
async function probeHarnessExitOnHerdr(agentId: string): Promise<HarnessExitProbe> {
  const { isAlive } = await import('../agents/liveness.js');
  const verdict = await isAlive(agentId, { backend: 'herdr' }).catch(() => null);
  if (!verdict) return 'unknown';
  if (verdict.alive) return 'alive';
  if (verdict.reason === 'no-session' || verdict.reason === 'pane-dead' || verdict.reason === 'runtime-missing') return 'harness-gone';
  return 'unknown';
}

async function probeHarnessExitOnTmux(tmuxSession: string): Promise<HarnessExitProbe> {
  const session = await queryTmuxSession(tmuxSession);
  if (session === 'missing') return 'session-gone';
  if (session === 'error') return 'unknown';
  let panePids: number[];
  try {
    const { stdout } = await tmuxExecAsync(['list-panes', '-t', exactPaneTarget(tmuxSession), '-F', '#{pane_pid}'], {
      encoding: 'utf-8',
      timeout: LEGACY_TMUX_PROBE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    panePids = String(stdout)
      .split('\n')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return 'unknown';
  }
  if (panePids.length === 0) return 'unknown';
  let psTable: string;
  try {
    psTable = await readProcessTable();
  } catch {
    return 'unknown';
  }
  return paneTreeHasHarnessProcess(panePids, psTable) ? 'alive' : 'harness-gone';
}

/**
 * Wait for Claude Code's prompt. A harness that exits first leaves only the
 * launcher's keep-alive loop holding the pane, which reads as a live, empty
 * conversation (PAN-3827), so that exit is thrown as a spawn error.
 */
export async function waitForClaudeReady(tmuxSession: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  // The last non-empty capture: once the session is gone, captures come back
  // empty, and the launcher's last words are in the capture before that.
  let output = '';
  while (Date.now() < deadline) {
    // The host's backend (PAN-3921): tmux `capture-pane`, or Herdr `pane.read`
    // of the visible screen. A pane that cannot be read yet polls on.
    const capture = await readAgentPaneText(tmuxSession, 200, undefined, 'visible').catch(() => '');
    if (capture.trim()) output = capture;
    if (capture.includes(SESSION_ENDED_PREFIX)) throw harnessEarlyExitError(capture);
    if (capture.includes('❯')) {
      console.log(`[conversations] Claude Code ready in ${tmuxSession}`);
      return;
    }
    await new Promise<void>((r) => setTimeout(r, 500));
  }
  const probe = await probeHarnessExit(tmuxSession);
  if (probe === 'session-gone' || probe === 'harness-gone') throw harnessEarlyExitError(output, probe === 'session-gone');
  console.warn(`[conversations] Timed out waiting for Claude Code prompt in ${tmuxSession} (harness probe: ${probe})`);
}
