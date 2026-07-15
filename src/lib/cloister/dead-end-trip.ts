import { resolveProjectFromIssueSync } from '../projects.js';
import { recordRecoveryFailure } from './recovery-trip.js';

export async function recordDeadEndNeedsYou(issueId: string, recoveryPath: string, generation: string, message: string): Promise<string | undefined> {
  const project = resolveProjectFromIssueSync(issueId);
  if (!project) return undefined;
  return (await recordRecoveryFailure(project.projectPath, issueId, recoveryPath, generation, 1)).emitNeedsYou ? message : undefined;
}
