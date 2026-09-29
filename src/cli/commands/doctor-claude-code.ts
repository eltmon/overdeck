/**
 * `pan doctor` check for the Claude Code CLI itself (PAN-4359 WI-9): the
 * launch binary's version and install method, whether it meets every
 * configured model's minimum, and any shadow `claude` binary on PATH that
 * could confuse an operator's shell.
 */

import { getClaudeCodeStatus } from '../../lib/claude-code/status.js';
import type { ClaudeInstallMethod } from '../../lib/claude-code/version.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export interface ClaudeCodeDoctorDeps {
  getStatus?: typeof getClaudeCodeStatus;
}

function installMethodLabel(method: ClaudeInstallMethod): string {
  switch (method) {
    case 'npm': return 'npm global';
    case 'native': return 'native';
    case 'homebrew': return 'Homebrew';
    case 'unknown': return 'unknown install';
  }
}

export async function checkClaudeCode(deps: ClaudeCodeDoctorDeps = {}): Promise<CheckResult[]> {
  const getStatus = deps.getStatus ?? getClaudeCodeStatus;
  const status = await getStatus();
  const results: CheckResult[] = [];

  if (!status.found) {
    return [{
      name: 'Claude Code',
      status: 'error',
      message: 'Not found on PATH',
      fix: 'Install Claude Code, then restart Overdeck.',
    }];
  }

  if (status.version === null) {
    results.push({
      name: 'Claude Code',
      status: 'warn',
      message: `Version unreadable at ${status.binaryPath}`,
    });
  } else {
    const method = installMethodLabel(status.install?.method ?? 'unknown');
    results.push({
      name: 'Claude Code',
      status: 'ok',
      message: `${status.version} (${method}, ${status.binaryPath})`,
    });
  }

  for (const requirement of status.requirements) {
    const sources = requirement.sources.length > 0 ? ` (${requirement.sources.join(', ')})` : '';
    if (requirement.satisfied === null) {
      results.push({
        name: `Claude Code for ${requirement.displayName}`,
        status: 'warn',
        message: `needs ${requirement.minVersion}; installed version unreadable${sources}`,
      });
      continue;
    }
    results.push({
      name: `Claude Code for ${requirement.displayName}`,
      status: requirement.satisfied ? 'ok' : 'error',
      message: `needs ${requirement.minVersion}; have ${status.version}${sources}`,
      ...(requirement.satisfied ? {} : { fix: status.upgrade?.display }),
    });
  }

  for (const shadow of status.shadows) {
    results.push({
      name: 'Claude Code shadow',
      status: 'warn',
      message: `${shadow.path} is Claude Code ${shadow.version ?? 'unknown'}; Overdeck launches ${status.binaryPath} (${status.version ?? 'unknown'}). A shell that runs \`claude\` may get the older one.`,
      fix: 'Remove or upgrade the other binary so your shell and Overdeck run the same Claude Code.',
    });
  }

  return results;
}
