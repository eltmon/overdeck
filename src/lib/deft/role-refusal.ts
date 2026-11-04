/**
 * The backstop that keeps Overdeck's review and test agents off a Deft issue
 * (PAN-4820 WI-8, AD-6). Deft runs its own review cycle and gates (AD-22);
 * every review and test spawn ends in `spawnRun`, which calls this first, so
 * no entry point (webhook, lifecycle, Deacon, convoy, direct) can start one.
 */
import { isDeftPipelineIssue } from './issue-pipeline.js';

const REFUSED_ROLES = new Set(['review', 'test']);

export class DeftPipelineRoleRefusedError extends Error {
  constructor(readonly issueId: string, readonly role: string) {
    super(`${issueId.toUpperCase()} runs on Deft; Overdeck does not spawn a ${role} agent for it`);
    this.name = 'DeftPipelineRoleRefusedError';
  }
}

export async function assertRoleRunsOnPipeline(
  issueId: string,
  role: string,
  isDeft: (issueId: string) => Promise<boolean> = isDeftPipelineIssue,
): Promise<void> {
  if (REFUSED_ROLES.has(role) && (await isDeft(issueId))) throw new DeftPipelineRoleRefusedError(issueId, role);
}
