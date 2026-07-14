/**
 * Verification gate artifact — the durable record of the most recent
 * quality-gate run for a workspace, written by the verification runner and
 * served to the dashboard's issue-tree Lint node.
 *
 * Lives at `<workspace>/.overdeck/verification-latest.json` (workspace runtime
 * plane, gitignored alongside continue.json). Each run overwrites the previous
 * artifact; history is not kept here — review-status history remains the
 * canonical timeline.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { QualityGateResult } from './validation.js';

export interface VerificationGateRecord {
  name: string;
  passed: boolean;
  required: boolean;
  durationMs: number;
  /** Gate stdout+stderr (already tail-truncated by runQualityGates). */
  output?: string;
  error?: string;
}

export interface VerificationArtifact {
  issueId: string;
  ranAt: string;
  outcome: 'running' | 'passed' | 'failed';
  /** Gate currently executing — only present while outcome is 'running'. */
  currentGate?: string;
  /** Rolling tail of the running gate's stdout/stderr (ANSI-stripped). */
  currentGateOutput?: string;
  failedCheck?: string;
  gates: VerificationGateRecord[];
}

const ARTIFACT_RELATIVE_PATH = join('.overdeck', 'verification-latest.json');

export function verificationArtifactPath(workspacePath: string): string {
  return join(workspacePath, ARTIFACT_RELATIVE_PATH);
}

export function writeVerificationArtifact(
  workspacePath: string,
  issueId: string,
  gateResults: QualityGateResult[],
  progress?: { currentGate?: string; currentGateOutput?: string },
): VerificationArtifact {
  const failed = gateResults.find((r) => !r.passed && r.required !== false);
  const running = progress !== undefined;
  const artifact: VerificationArtifact = {
    issueId,
    ranAt: new Date().toISOString(),
    outcome: running ? 'running' : failed ? 'failed' : 'passed',
    ...(running && progress.currentGate ? { currentGate: progress.currentGate } : {}),
    ...(running && progress.currentGateOutput ? { currentGateOutput: progress.currentGateOutput } : {}),
    ...(!running && failed ? { failedCheck: failed.name } : {}),
    gates: gateResults.map((r) => ({
      name: r.name,
      passed: r.passed,
      required: r.required !== false,
      durationMs: r.durationMs,
      // Keep full output only where it matters: failures. Passing gates get a
      // clean record without megabytes of build noise.
      ...(r.passed ? {} : { output: r.output }),
      ...(r.error ? { error: r.error } : {}),
    })),
  };
  const path = verificationArtifactPath(workspacePath);
  mkdirSync(join(workspacePath, '.overdeck'), { recursive: true });
  writeFileSync(path, JSON.stringify(artifact, null, 2));
  return artifact;
}

export function readVerificationArtifact(workspacePath: string): VerificationArtifact | null {
  const path = verificationArtifactPath(workspacePath);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as VerificationArtifact;
    if (!parsed || !Array.isArray(parsed.gates)) return null;
    return parsed;
  } catch {
    return null;
  }
}
