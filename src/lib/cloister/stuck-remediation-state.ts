import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getPanopticonHome } from '../paths.js';

export type StuckRemediationStage = 0 | 1 | 2 | 3;

export interface StuckRemediationState {
  lastStage: StuckRemediationStage;
  lastStageAt: string;
  firstStuckAt: string;
}

function agentStateDir(agentId: string): string {
  return join(getPanopticonHome(), 'agents', agentId);
}

function statePath(agentId: string): string {
  return join(agentStateDir(agentId), 'stuck-remediation.json');
}

export function readStuckRemediationState(agentId: string): StuckRemediationState | null {
  const filePath = statePath(agentId);
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as StuckRemediationState;
  } catch (error) {
    console.warn(`Failed to read stuck-remediation state for ${agentId}:`, error);
    return null;
  }
}

export function writeStuckRemediationState(agentId: string, state: StuckRemediationState): void {
  mkdirSync(agentStateDir(agentId), { recursive: true });
  writeFileSync(statePath(agentId), `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

export function clearStuckRemediationState(agentId: string): void {
  const filePath = statePath(agentId);
  if (!existsSync(filePath)) return;
  unlinkSync(filePath);
}
