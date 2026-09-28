/**
 * `pan install` prerequisite gate (PAN-4282 D14, FR-23).
 *
 * Docker, ast-grep and — under the Herdr terminal backend — tmux are
 * forgiven: their absence prints a warning instead of failing the gate.
 * Node, git, and (under the tmux backend) tmux still block install. Pure and
 * child-process-free so it is testable without importing `inquirer`/`ora`.
 */

import type { TerminalBackendName } from '../../lib/terminal-backends/types.js';

export interface PrereqResult {
  name: string;
  passed: boolean;
  message: string;
  fix?: string;
}

/**
 * Prerequisites whose failure warns instead of failing the gate. `mkcert`,
 * `ttyd`, `jq` and `Herdr` are auto-installed later in `pan install` and
 * already print "will auto-install" in `printPrereqStatus` — no extra
 * warning line. tmux is forgiven only under the Herdr backend, where agents
 * don't need it.
 */
export function forgivenPrereqNames(backend: TerminalBackendName): string[] {
  return ['mkcert', 'ttyd', 'jq', 'Herdr', 'Docker', 'ast-grep', ...(backend === 'herdr' ? ['tmux'] : [])];
}

export function evaluatePrereqGate(
  results: readonly PrereqResult[],
  backend: TerminalBackendName,
  platform: NodeJS.Platform = process.platform,
): { allPassed: boolean; warnings: string[] } {
  const forgiven = new Set(forgivenPrereqNames(backend));
  const allPassed = results.filter((result) => !forgiven.has(result.name)).every((result) => result.passed);

  const warnings: string[] = [];
  for (const result of results) {
    if (result.passed || !forgiven.has(result.name)) continue;
    if (result.name === 'Docker') {
      warnings.push(
        result.message === 'not running'
          ? 'Docker not running — workspace containers are unavailable until it starts.'
          : 'Docker not found — workspace containers are unavailable until it is installed.',
      );
    } else if (result.name === 'ast-grep') {
      warnings.push('ast-grep missing — will be installed later.');
    } else if (result.name === 'tmux') {
      const hint = platform === 'darwin' ? 'brew install tmux' : 'sudo apt install tmux';
      warnings.push(`tmux missing — plain terminals in the dashboard need it (${hint}).`);
    }
  }

  return { allPassed, warnings };
}
