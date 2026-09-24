/**
 * Companion terminals (PAN-3974): the process-wide lifecycle wired to the
 * managed tmux socket and the registered adapters, plus the owner-teardown
 * hook the conversation runtime calls. OpenCode (PAN-3974) and Codex (PAN-3835)
 * each register one adapter in `defaultAdapters()`; nothing else changes.
 */
import type { CompanionTerminalKind } from '@overdeck/contracts';
import { createTmuxCompanionHost } from './host.js';
import {
  createCompanionTerminalLifecycle,
  type CompanionTerminalAdapter,
  type CompanionTerminalLifecycle,
} from './lifecycle.js';
import { createOpenCodeCompanionAdapter } from './opencode-adapter.js';
import { createCodexCompanionAdapter } from './codex-adapter.js';

export {
  companionSessionName,
  companionGeneration,
  createCompanionTerminalLifecycle,
  type CompanionOwner,
  type CompanionTerminalAdapter,
  type CompanionTerminalLifecycle,
  type CompanionCloseOutcome,
  type CompanionTargetResolution,
} from './lifecycle.js';
export { createTmuxCompanionHost, type CompanionTerminalHost } from './host.js';
export { createOpenCodeCompanionAdapter } from './opencode-adapter.js';
export { createCodexCompanionAdapter } from './codex-adapter.js';

let lifecycle: CompanionTerminalLifecycle | undefined;

function defaultAdapters(): Partial<Record<CompanionTerminalKind, CompanionTerminalAdapter>> {
  return {
    'opencode-attach': createOpenCodeCompanionAdapter(),
    'codex-resume-remote': createCodexCompanionAdapter(),
  };
}

export function getCompanionTerminalLifecycle(): CompanionTerminalLifecycle {
  lifecycle ??= createCompanionTerminalLifecycle({ host: createTmuxCompanionHost(), adapters: defaultAdapters() });
  return lifecycle;
}

/**
 * Owner teardown: kill the owner's companion terminal, if any. Called before
 * the owner session is stopped or respawned; never throws, so it can never
 * block a stop, delete, archive, or restart.
 */
export async function closeCompanionTerminalForOwner(ownerSession: string): Promise<void> {
  try {
    await getCompanionTerminalLifecycle().closeForOwner(ownerSession);
  } catch (error) {
    console.warn(`[companion-terminal] teardown for ${ownerSession} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
