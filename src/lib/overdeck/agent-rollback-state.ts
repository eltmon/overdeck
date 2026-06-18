import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getPanopticonHome } from '../paths.js';
import type { AgentState } from '../agents.js';

const AGENT_STATE_ROLLBACK_FILE = 'state' + '.json';

export function getRollbackAgentStatePath(agentId: string): string {
  return join(getPanopticonHome(), 'agents', agentId, AGENT_STATE_ROLLBACK_FILE);
}

export function readRollbackAgentStateSync<T>(
  agentId: string,
  parse: (content: string, normalizedId: string) => T | null,
): T | null {
  const stateFile = getRollbackAgentStatePath(agentId);
  if (!existsSync(stateFile)) return null;
  return parse(readFileSync(stateFile, 'utf8'), agentId);
}

export function writeRollbackAgentStateSync(
  state: AgentState,
  serialize: (state: AgentState) => string,
): void {
  const stateFile = getRollbackAgentStatePath(state.id);
  mkdirSync(join(getPanopticonHome(), 'agents', state.id), { recursive: true });
  writeFileSync(stateFile, serialize(state));
}

export async function readRollbackAgentHarnessFromDir(
  agentsDir: string,
  agentId: string,
): Promise<string | null> {
  try {
    const raw = await readFile(join(agentsDir, agentId, AGENT_STATE_ROLLBACK_FILE), 'utf8');
    const state = JSON.parse(raw) as { harness?: unknown };
    return typeof state.harness === 'string' ? state.harness : null;
  } catch {
    return null;
  }
}
