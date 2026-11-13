/**
 * `pan doctor` row for optional host tools (PAN-5168). Kept beside
 * doctor-grok.ts so doctor.ts stays under the file-size ceiling.
 */
import { refreshHostTools, resolveHostTool, type HostToolDeps, type HostToolName } from '../../lib/host-tools.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-grok.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

const HOST_TOOL_NAMES: readonly HostToolName[] = ['docker', 'tmux', 'systemctl', 'journalctl', 'brew'];

export function checkHostTools(deps: HostToolDeps = {}): CheckResult {
  refreshHostTools();
  let anyMissing = false;
  const parts = HOST_TOOL_NAMES.map((name) => {
    const path = resolveHostTool(name, deps);
    if (path === null) {
      anyMissing = true;
      return `${name} missing`;
    }
    return `${name} ${path}`;
  });
  const message = parts.join(', ')
    + (anyMissing ? ' — dashboard pollers skip missing tools and look again every 60 s.' : '');
  return { name: 'Host tools', status: 'ok', message };
}
