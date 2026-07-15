import { renameSync, writeFileSync } from 'node:fs';

import { Effect } from 'effect';

import {
  runVerificationForIssueInProcess,
  type VerificationRunnerOptions,
  type WorkspaceInfo,
} from './verification-runner.js';

type WorkerRequest = {
  issueId: string;
  workspacePath: string;
  workspaceInfo: WorkspaceInfo;
  logPrefix: string;
  options: Pick<VerificationRunnerOptions, 'syncTargetBranch'>;
  resultPath: string;
};

function writeResult(path: string, value: unknown): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value)}\n`);
  renameSync(temp, path);
}

const raw = process.argv[2];
if (!raw) throw new Error('Verification worker request is required');
const request = JSON.parse(raw) as WorkerRequest;

try {
  const result = await Effect.runPromise(runVerificationForIssueInProcess(
    request.issueId,
    request.workspacePath,
    request.workspaceInfo,
    request.logPrefix,
    request.options,
  ));
  writeResult(request.resultPath, result);
} catch (error) {
  writeResult(request.resultPath, {
    outcome: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}
