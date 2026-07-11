import { resolveProjectFromIssueSync } from '../projects.js';
import { recordRecoveryFailure } from './recovery-trip.js';

export function recordDeadEndNeedsYou(issueId: string, recoveryPath: string, generation: string, message: string): string | undefined {
  const project = resolveProjectFromIssueSync(issueId);
  if (!project) return undefined;
  return recordRecoveryFailure(project.projectPath, issueId, recoveryPath, generation, 1).emitNeedsYou ? message : undefined;
}
