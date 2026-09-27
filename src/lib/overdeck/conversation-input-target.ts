/**
 * PAN-4268: where a live Claude Code conversation sends typed input, for the
 * conversation read model. Reads the pane's agent selector only when the
 * session has a `subagents/` directory — without one Claude Code draws no
 * selector, and input goes to main — so list enrichment never reads a pane
 * for dead sessions, other harnesses, or conversations without subagents.
 */

import { stat } from 'node:fs/promises';

import { inputTargetFromSelector, parseAgentSelector, type InputTarget } from '../agents/input-target.js';
import { resolveAgentPaneIo } from '../terminal-backends/agent-pane-io.js';
import { subagentsDirFor } from '../transcript-landing.js';

const PANE_READ_LINES = 60;

async function sessionHasSubagentsDir(sessionFile: string): Promise<boolean> {
  try {
    return (await stat(subagentsDirFor(sessionFile))).isDirectory();
  } catch {
    return false;
  }
}

/** The read-model value for one conversation, or undefined when there is nothing to check (PAN-4268). */
export async function readConversationInputTarget(
  conv: { tmuxSession: string; harness?: string | null },
  sessionAlive: boolean,
  sessionFile: string | null,
  deps: { read?: (agentId: string) => Promise<string>; hasSubagentsDir?: (sessionFile: string) => Promise<boolean> } = {},
): Promise<InputTarget | undefined> {
  if (!sessionAlive || (conv.harness ?? 'claude-code') !== 'claude-code' || !sessionFile) return undefined;
  const hasSubagentsDir = deps.hasSubagentsDir ?? sessionHasSubagentsDir;
  if (!(await hasSubagentsDir(sessionFile))) return undefined;
  const read = deps.read ?? (async (agentId: string) => (await resolveAgentPaneIo(agentId)).read(PANE_READ_LINES));
  try {
    return inputTargetFromSelector(parseAgentSelector(await read(conv.tmuxSession)));
  } catch {
    return 'unknown';
  }
}
