import type { RuntimeName } from '../runtimes/types.js';
import {
  readIssueRecordSync,
  resolveProjectForIssue,
  writeAgentHarnessModelSync,
} from '../pan-dir/record.js';

export function readAgentHarnessModelRecordSync(issueId: string): {
  harness?: RuntimeName;
  model?: string;
} | null {
  const project = resolveProjectForIssue(issueId);
  if (!project) return null;
  const record = readIssueRecordSync(project, issueId);
  return {
    harness: record?.harness,
    model: record?.model,
  };
}

export function writeAgentHarnessModelRecordSync(
  issueId: string,
  harness: RuntimeName,
  model: string,
): void {
  const project = resolveProjectForIssue(issueId);
  if (!project) return;
  writeAgentHarnessModelSync(project, issueId, harness, model);
}

