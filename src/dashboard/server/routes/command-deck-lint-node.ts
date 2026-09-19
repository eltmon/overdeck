/**
 * Lint tree node builder (PAN-2665) — synthesizes the issue tree's 'lint'
 * SessionNode from the per-workspace verification artifact. The node sits
 * between Work and Review (TYPE_PRIORITY) and its transcript carries the
 * quality-gate table and the failing gate's output.
 *
 * PAN-3917 FR-8: the artifact IS the verification result. Nothing writes a
 * stored verification status any more, so there is no second source to reconcile
 * against — no artifact means the gates have not run in this workspace.
 */
import type { SessionNodePresence } from '@overdeck/contracts';

import { readVerificationArtifact } from '../../../lib/cloister/verification-artifact.js';

export interface LintSessionNode {
  type: 'lint';
  sessionId: string;
  model: string;
  startedAt: string;
  endedAt?: string;
  duration: number | null;
  status: string;
  presence: SessionNodePresence;
  transcript?: string;
}

export function buildLintSessionNode(options: {
  workspacePath: string;
  issueLower: string;
  includeTranscripts: boolean;
}): LintSessionNode | null {
  const { workspacePath, issueLower, includeTranscripts } = options;

  const artifact = readVerificationArtifact(workspacePath);
  if (!artifact) return null;

  const isRunning = artifact.outcome === 'running';
  const status = isRunning ? 'running' : artifact.outcome === 'passed' ? 'completed' : 'failed';

  const transcriptParts: string[] = [
    isRunning ? 'QUALITY GATES RUNNING...' : `QUALITY GATES ${artifact.outcome.toUpperCase()}`,
    `Last run: ${artifact.ranAt}`,
    '',
  ];
  for (const gate of artifact.gates) {
    const mark = gate.passed ? '✓' : '✗';
    const secs = (gate.durationMs / 1000).toFixed(1);
    transcriptParts.push(`${mark} ${gate.name} (${secs}s)${gate.passed ? '' : ' FAILED'}`);
  }
  if (isRunning && artifact.currentGate) {
    transcriptParts.push(`▶ ${artifact.currentGate} running…`);
  }
  for (const gate of artifact.gates) {
    if (!gate.passed && (gate.output || gate.error)) {
      transcriptParts.push('', `--- ${gate.name} output ---`, (gate.output || gate.error || '').trim());
    }
  }

  const gateDurationMs = artifact.gates.reduce((total, gate) => total + gate.durationMs, 0);

  return {
    type: 'lint',
    sessionId: `lint-${issueLower}`,
    model: 'quality-gates',
    startedAt: artifact.ranAt,
    ...(isRunning ? {} : { endedAt: artifact.ranAt }),
    duration: Math.floor(gateDurationMs / 1000),
    status,
    presence: isRunning ? 'active' : 'ended',
    ...(includeTranscripts && transcriptParts.length > 0
      ? { transcript: transcriptParts.join('\n') }
      : {}),
  };
}
