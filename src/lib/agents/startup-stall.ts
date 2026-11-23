/**
 * PAN-4242: a Claude Code agent that never got past a startup menu.
 *
 * Claude Code shows some dialogs (folder trust, its "backstop" for project
 * permission grants) before the session writes a single transcript line. On a
 * Herdr host the pane read through `detectAwaitingInputForAgent` sees nothing,
 * so a planning or work agent could sit at such a menu for hours while every
 * surface reported it running.
 *
 * The signal is narrow on purpose. It needs all of: a harness that declares
 * `startupMenuStallSignal` (Claude Code), at
 * least STARTUP_TRANSCRIPT_GRACE_MS since launch, no transcript written since
 * launch, and a blocking menu on the pane. An idle resumed agent shows no
 * menu, so it is never flagged.
 */

import {
  normalizeAwaitingInputPrompt,
  type AwaitingInputDetection,
} from '../agent-input-detection.js';
import { parsePaneChoiceMenu } from '../pane-choice-menu.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import type { RuntimeName } from '../runtimes/types.js';
import { getAgentState } from './agent-state-read.js';

export const STARTUP_TRANSCRIPT_GRACE_MS = 180_000;

const PANE_READ_LINES = 90;
const MAX_EXTRA_CONTEXT_LINES = 3;

export interface StartupStallDeps {
  /**
   * The agent's transcript mtime (`getAgentJsonlMtime`). Passed in by the caller:
   * agent-enrichment imports this module, so importing it back would be a cycle.
   */
  transcriptMtime: (agentId: string) => Promise<number | null>;
  now?: () => number;
  /** The agent's recorded harness; undefined (an older agent) is Claude Code. */
  harness?: (agentId: string) => RuntimeName | undefined;
  readPane?: (agentId: string) => Promise<string>;
}

async function defaultReadPane(agentId: string): Promise<string> {
  const { readAgentPaneText } = await import('../terminal-backends/agent-pane-io.js');
  return readAgentPaneText(agentId, PANE_READ_LINES, undefined, 'visible');
}

/** PAN-4242: a Claude Code agent waiting at a startup menu with no transcript since launch. */
export async function detectStartupStall(
  agentId: string,
  startedAt: string | undefined,
  deps: StartupStallDeps,
): Promise<AwaitingInputDetection | null> {
  const harness = (deps.harness ?? ((id: string) => getAgentState(id)?.harness))(agentId);
  if (!getHarnessBehavior(harness).capabilities.startupMenuStallSignal) return null;

  const startedAtMs = Date.parse(startedAt ?? '');
  if (!Number.isFinite(startedAtMs)) return null;
  const elapsedMs = (deps.now ?? Date.now)() - startedAtMs;
  if (elapsedMs < STARTUP_TRANSCRIPT_GRACE_MS) return null;

  const mtime = await deps.transcriptMtime(agentId);
  if (mtime !== null && mtime >= startedAtMs) return null;

  let screen: string;
  try {
    screen = await (deps.readPane ?? defaultReadPane)(agentId);
  } catch {
    return null;
  }
  const menu = parsePaneChoiceMenu(screen, { mode: 'guard' });
  if (!menu) return null;

  const minutes = Math.floor(elapsedMs / 60_000);
  const extraContext = menu.contextLines.filter((line) => line !== menu.title).slice(0, MAX_EXTRA_CONTEXT_LINES);
  return {
    reason: 'startup_blocked',
    prompt: normalizeAwaitingInputPrompt([
      `Claude Code has written no transcript ${minutes} min after launch and is waiting at a menu:`,
      menu.title,
      ...extraContext,
      ...menu.options.map((option) => `${option.number}. ${option.label}`),
      `Answer it with: pan answer ${agentId} <number> (or in the Terminal tab).`,
    ].join('\n')),
  };
}
