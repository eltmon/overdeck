import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { provisionClaudeHooks } from '../claude-hooks-provision.js';
import { isAutoApproveHookRegistered, type ClaudeSettings } from '../claude-hooks-registration.js';
import { resolvePermissionMode } from '../claude-permissions.js';
import type { ClaudePermissionMode } from '../config.js';
import { BIN_DIR } from '../paths.js';
import { logAgentLifecycle } from '../persistent-logger.js';
import type { RuntimeName } from '../runtimes/types.js';

/**
 * Ensure Claude's global lifecycle hooks are registered before the process can
 * emit SessionStart. This must be awaited: provisioning after launch races the
 * one event that writes ready.json and acknowledges kickoff delivery.
 */
export async function ensureLifecycleHooksBeforeLaunch(
  agentId: string,
  harness: RuntimeName,
): Promise<void> {
  if (harness !== 'claude-code') return;

  const result = await provisionClaudeHooks();
  if (!result.ok) {
    const reason = result.reason ?? 'unknown provisioning failure';
    logAgentLifecycle(agentId, `hook provisioning: failed harness=${harness} reason=${reason}`);
    throw new Error(
      `Claude Code lifecycle hooks are unavailable: ${reason}. `
        + 'Run `pan up` to install host prerequisites, then `pan sync` and retry.',
    );
  }

  logAgentLifecycle(
    agentId,
    `hook provisioning: ready harness=${harness} changed=${result.changed} `
      + `binariesSynced=${result.binariesSynced} registered=${result.registered.length} pruned=${result.pruned.length}`,
  );
}

async function isRegisteredOnDisk(settingsPath: string, binDir: string): Promise<boolean> {
  if (!existsSync(join(binDir, 'auto-approve-hook'))) return false;
  try {
    const settings = JSON.parse(await readFile(settingsPath, 'utf-8')) as ClaudeSettings;
    return isAutoApproveHookRegistered(settings, binDir);
  } catch {
    return false;
  }
}

/**
 * Under resolved mode 'auto', make sure Overdeck's PreToolUse auto-approve
 * hook is registered before a Claude Code launch — otherwise every tool call
 * prompts on a machine nobody is watching (PAN-5151). Under 'bypass' this is
 * a no-op.
 */
export async function ensureAutoApproveHookReady(
  opts: { settingsPath?: string; binDir?: string; mode?: ClaudePermissionMode } = {},
): Promise<void> {
  const mode = opts.mode ?? resolvePermissionMode();
  if (mode !== 'auto') return;
  if (!opts.settingsPath && process.env.VITEST) return;
  const settingsPath = opts.settingsPath ?? join(homedir(), '.claude', 'settings.json');
  const binDir = opts.binDir ?? BIN_DIR;
  if (await isRegisteredOnDisk(settingsPath, binDir)) return;
  const result = await provisionClaudeHooks({ settingsPath, binDir });
  if (result.ok && await isRegisteredOnDisk(settingsPath, binDir)) return;
  throw new Error(
    `Claude Code permission mode is auto, but Overdeck's auto-approve hook is not registered in ${settingsPath}`
      + `${result.ok ? '' : ` (${result.reason})`}. Without it every tool call prompts. `
      + 'Run `pan sync` to register it (it needs jq), or set claude.permissionMode: bypass in Settings → Permissions.',
  );
}
