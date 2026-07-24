/**
 * PAN-3002: supervisor-delivered agents (pty-supervisor, deliveryMethod:
 * supervisor) keep working after their tmux session dies — the worker holds
 * the pty and detaches. A tmux-only liveness check then declares a healthy
 * agent dead and marks it stopped, splitting state from reality: MIN-882 ran
 * 36h untracked ($166, 35MB transcript) while the pipeline showed "Planned
 * idle", and PAN-2997 was killed 41s after a healthy resume.
 *
 * A live pty-supervisor process carrying `--name <agentId>` is positive proof
 * of life regardless of tmux. The deacon's liveness arbiter consults this
 * before declaring an agent orphaned.
 */
import { execFileSync } from 'node:child_process';

type Pgrep = (pattern: string) => boolean;

const defaultPgrep: Pgrep = (pattern) => {
  try {
    execFileSync('pgrep', ['-f', pattern], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
};

/**
 * True when a pty-supervisor process for this agent is alive. `--name` is
 * boundary-anchored so `agent-min-882` does not match `agent-min-882-review`.
 * Agent ids are `[a-z0-9-]` by construction, so the pattern needs no escaping.
 */
export function supervisorProcessAliveSync(agentId: string, pgrep: Pgrep = defaultPgrep): boolean {
  if (!agentId) return false;
  return pgrep(`pty-supervisor\\.js.*--name ${agentId}(\\s|$)`);
}
