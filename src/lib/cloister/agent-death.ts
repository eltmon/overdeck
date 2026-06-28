/**
 * Agent death diagnostics (PAN-2108).
 *
 * When an ohmypi/pi agent process dies, the launcher records its exit code +
 * timestamp to `<agentDir>/exit-status` (see buildOhmypiCommand in
 * launcher-generator.ts), and omp's stdout/stderr is captured to
 * `<agentDir>/output.log`. This module turns those into a one-line death reason
 * the deacon can log, replacing the opaque "session is dead" with an actual
 * cause — the gap that made the flywheel orchestrator's silent death
 * undiagnosable in RUN-30.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getOverdeckHome } from '../paths.js';
import { listPaneValuesSync, sessionExistsSync } from '../tmux.js';

function agentDir(agentId: string): string {
  return join(getOverdeckHome(), 'agents', agentId);
}

/** Read the launcher-recorded exit code + UTC timestamp, or null if absent. */
export function readAgentExitStatus(agentId: string): { code: string; at: string } | null {
  try {
    const p = join(agentDir(agentId), 'exit-status');
    if (!existsSync(p)) return null;
    const raw = readFileSync(p, 'utf-8').trim();
    if (!raw) return null;
    const [code, at = ''] = raw.split(/\s+/);
    return { code: code ?? '?', at };
  } catch {
    return null;
  }
}

/**
 * Best-effort one-line description of why an agent process died: the
 * launcher-recorded exit status (preferred), the tmux pane exit status (fallback
 * when the dead pane corpse still exists), and the tail of output.log.
 */
export function describeAgentDeath(agentId: string): string {
  const parts: string[] = [];

  const exit = readAgentExitStatus(agentId);
  if (exit) {
    parts.push(`exit=${exit.code}${exit.at ? ` at ${exit.at}` : ''}`);
  } else if (sessionExistsSync(agentId)) {
    // No exit-status file (e.g. the launcher bash was SIGKILLed before it could
    // write) but the dead pane survives via remain-on-exit — tmux still knows the
    // exit code.
    const paneExit = listPaneValuesSync(agentId, '#{pane_exit_status}').find((v) => v !== '');
    if (paneExit) parts.push(`pane_exit=${paneExit}`);
  }

  try {
    const logPath = join(agentDir(agentId), 'output.log');
    if (existsSync(logPath)) {
      const tail = readFileSync(logPath, 'utf-8')
        .slice(-1500)
        .trim()
        .split('\n')
        .slice(-6)
        .join(' | ')
        .trim();
      if (tail) parts.push(`output.log tail: ${tail}`);
    }
  } catch {
    /* best effort */
  }

  return parts.length ? parts.join('; ') : 'no exit trace (exit-status + output.log empty)';
}
