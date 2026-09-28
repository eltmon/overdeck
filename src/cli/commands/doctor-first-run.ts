/**
 * `pan doctor` core-command and first-run login rows (PAN-4282 D9, FR-24).
 *
 * `checkCoreCommands` emits the rows the old `requiredCommands` loop in
 * doctor.ts emitted (git, tmux, Node.js, Claude CLI), except tmux becomes a
 * `warn` — not an `error` — when the host terminal backend is Herdr, where
 * agents don't need tmux (it still hosts plain terminals in the dashboard
 * terminal drawer). `checkFirstRunLogins` adds Claude and GitHub CLI login
 * rows; both are skipped when their CLI isn't installed, because the CLI's
 * own presence row already reports that.
 *
 * `CheckResult` is structurally identical to doctor.ts's; re-declared (like
 * doctor-herdr.ts and doctor-inotify.ts) to avoid a module cycle.
 */

import type { ClaudeLoginCheck, GhLoginCheck } from '../../lib/first-run-checks.js';
import type { TerminalBackendName } from '../../lib/terminal-backends/types.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export interface FirstRunDoctorDeps {
  backend: TerminalBackendName;
  has: (cmd: string) => boolean;
  claudeLogin: () => Promise<ClaudeLoginCheck>;
  ghLogin: () => Promise<GhLoginCheck>;
}

export function checkCoreCommands(deps: Pick<FirstRunDoctorDeps, 'backend' | 'has'>): CheckResult[] {
  const checks: CheckResult[] = [];

  checks.push(
    deps.has('git')
      ? { name: 'Git', status: 'ok', message: 'Installed' }
      : { name: 'Git', status: 'error', message: 'Not found', fix: 'Install git' },
  );

  if (deps.has('tmux')) {
    checks.push({ name: 'tmux', status: 'ok', message: 'Installed' });
  } else if (deps.backend === 'herdr') {
    checks.push({
      name: 'tmux',
      status: 'warn',
      message: 'Not found (optional under Herdr: plain terminals need it)',
      fix: 'Install tmux: apt install tmux / brew install tmux',
    });
  } else {
    checks.push({
      name: 'tmux',
      status: 'error',
      message: 'Not found',
      fix: 'Install tmux: apt install tmux / brew install tmux',
    });
  }

  checks.push(
    deps.has('node')
      ? { name: 'Node.js', status: 'ok', message: 'Installed' }
      : { name: 'Node.js', status: 'error', message: 'Not found', fix: 'Install Node.js 18+' },
  );

  checks.push(
    deps.has('claude')
      ? { name: 'Claude CLI', status: 'ok', message: 'Installed' }
      : {
        name: 'Claude CLI',
        status: 'error',
        message: 'Not found',
        fix: 'Install: npm install -g @anthropic-ai/claude-code',
      },
  );

  return checks;
}

export async function checkFirstRunLogins(
  deps: Pick<FirstRunDoctorDeps, 'claudeLogin' | 'ghLogin' | 'has'>,
): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  if (deps.has('claude')) {
    const claude = await deps.claudeLogin();
    checks.push(
      claude.ok
        ? { name: 'Claude login', status: 'ok', message: claude.detail }
        : { name: 'Claude login', status: 'warn', message: claude.detail, fix: 'Run: claude, then /login' },
    );
  }

  if (deps.has('gh')) {
    const gh = await deps.ghLogin();
    checks.push(
      gh.ok
        ? { name: 'GitHub login', status: 'ok', message: 'Signed in' }
        : { name: 'GitHub login', status: 'warn', message: 'Not signed in', fix: 'Run: gh auth login' },
    );
  }

  return checks;
}
