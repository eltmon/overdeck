/**
 * Claude Permission Mode doctor check (PAN-5151).
 *
 * Under resolved mode 'auto', an unregistered auto-approve hook leaves every
 * tool call prompting on a machine nobody is watching — this surfaces that
 * before it becomes a stuck agent.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolvePermissionMode } from '../../lib/claude-permissions.js';
import { isAutoApproveHookRegistered, type ClaudeSettings } from '../../lib/claude-hooks-registration.js';
import type { ClaudePermissionMode } from '../../lib/config.js';
import { BIN_DIR } from '../../lib/paths.js';

// CheckResult re-declared locally (doctor.ts import would create a cycle — see doctor-hooks-drift.ts).
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export function checkClaudePermissionMode(deps: {
  mode: ClaudePermissionMode;
  settingsText: string | null;
  binDir: string;
  hookFileExists: boolean;
}): CheckResult {
  const name = 'Claude Permission Mode';

  if (deps.mode === 'bypass') {
    return { name, status: 'ok', message: 'bypass — tool calls are not gated; the auto-approve hook is not needed' };
  }

  const registered = deps.hookFileExists && isRegistered(deps.settingsText, deps.binDir);
  if (registered) {
    return { name, status: 'ok', message: 'auto — auto-approve hook registered' };
  }

  return {
    name,
    status: 'error',
    message: "auto — Overdeck's auto-approve hook is not registered in ~/.claude/settings.json; every tool call will prompt",
    fix: 'Run: pan sync (needs jq), or set claude.permissionMode: bypass',
  };
}

function isRegistered(settingsText: string | null, binDir: string): boolean {
  if (settingsText === null) return false;
  try {
    const settings = JSON.parse(settingsText) as ClaudeSettings;
    return isAutoApproveHookRegistered(settings, binDir);
  } catch {
    return false;
  }
}

export async function checkClaudePermissionModeLive(): Promise<CheckResult> {
  const mode = resolvePermissionMode();
  const binDir = BIN_DIR;
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  const settingsText = await readFile(settingsPath, 'utf-8').catch(() => null);
  const hookFileExists = existsSync(join(binDir, 'auto-approve-hook'));
  return checkClaudePermissionMode({ mode, settingsText, binDir, hookFileExists });
}
