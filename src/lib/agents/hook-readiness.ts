import { provisionClaudeHooks } from '../claude-hooks-provision.js';
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
