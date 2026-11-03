/**
 * Which pipeline an issue runs on (PAN-4820): Overdeck's own, or Deft
 * Directive's. The choice is the `pipeline: deft` key in the issue's
 * skill-override file (`<planHome>/.pan/skill-overrides/<ISSUE>.yaml`);
 * absent means Overdeck. The YAML is parsed only in `skill-overrides/issue-file.ts`.
 *
 * Reads never throw: any error reads as Overdeck's pipeline, so a broken
 * file never moves an issue onto Deft. Writes go through `setIssuePipeline`
 * in the store.
 */
import { readIssuePipelineField } from '../skill-overrides/issue-file.js';

export type IssuePipeline = 'overdeck' | 'deft';

export async function readIssuePipeline(issueId: string): Promise<IssuePipeline> {
  try {
    return (await readIssuePipelineField(issueId)) === 'deft' ? 'deft' : 'overdeck';
  } catch {
    return 'overdeck';
  }
}

export async function isDeftPipelineIssue(issueId: string): Promise<boolean> {
  return (await readIssuePipeline(issueId)) === 'deft';
}
