import type { RuntimeName } from '../runtimes/types.js';
import { sessionRotationRefused } from '../session-rotation.js';

export interface ResumeSpawnPlanInput {
  harness: RuntimeName;
  compactSeed: boolean;
  driftReasons: readonly string[];
  piProcessWasAlive: boolean;
  transcriptExists: boolean;
  allowExplicitRecovery: boolean;
}

export interface ResumeSpawnPlan {
  mode: 'resume-saved' | 'fresh';
  freshReason?: 'compact' | 'drift' | 'pi-dead-recovery' | 'claude-jsonl-missing';
  clearSessionPointers: boolean;
  rotationRefused: boolean;
}

export function decideResumeSpawnPlan(input: ResumeSpawnPlanInput): ResumeSpawnPlan {
  const rotationRefused = sessionRotationRefused({
    compactSeed: input.compactSeed,
    driftReasons: input.driftReasons,
    allowExplicitRecovery: input.allowExplicitRecovery,
  });

  if (input.compactSeed) {
    return {
      mode: 'fresh',
      freshReason: 'compact',
      clearSessionPointers: false,
      rotationRefused,
    };
  }

  if (input.driftReasons.length > 0) {
    return {
      mode: 'fresh',
      freshReason: 'drift',
      clearSessionPointers: false,
      rotationRefused,
    };
  }

  if (input.harness === 'ohmypi' && !input.piProcessWasAlive) {
    return {
      mode: 'fresh',
      freshReason: 'pi-dead-recovery',
      clearSessionPointers: false,
      rotationRefused: false,
    };
  }

  if (input.harness === 'claude-code' && !input.transcriptExists) {
    return {
      mode: 'fresh',
      freshReason: 'claude-jsonl-missing',
      clearSessionPointers: true,
      rotationRefused: false,
    };
  }

  return {
    mode: 'resume-saved',
    clearSessionPointers: false,
    rotationRefused: false,
  };
}
