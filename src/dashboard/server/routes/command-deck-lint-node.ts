/**
 * Lint tree node builder (PAN-2665) — synthesizes the issue tree's 'lint'
 * SessionNode from the per-workspace verification artifact plus the live
 * review-status verificationStatus. The node sits between Work and Review
 * (TYPE_PRIORITY) and its transcript carries the quality-gate table and the
 * failing gate's output.
 */
import type { SessionNodePresence } from '@overdeck/contracts';

import { readVerificationArtifact } from '../../../lib/cloister/verification-artifact.js';
import type { ReviewStatus } from '../../../lib/review-status.js';

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
  centralStatus: ReviewStatus | null;
}): LintSessionNode | null {
  const { workspacePath, issueLower, includeTranscripts, centralStatus } = options;

  const artifact = readVerificationArtifact(workspacePath);
  const verificationStatus = centralStatus?.verificationStatus;
  if (!artifact && (!verificationStatus || verificationStatus === 'skipped')) return null;

  const isRunning = verificationStatus === 'running';
  const status = isRunning
    ? 'running'
    : artifact
      ? (artifact.outcome === 'passed' ? 'completed' : 'failed')
      : verificationStatus === 'passed'
        ? 'completed'
        : verificationStatus === 'failed'
          ? 'failed'
          : 'running';

  const transcriptParts: string[] = [];
  if (isRunning) transcriptParts.push('QUALITY GATES RUNNING...');
  if (artifact) {
    if (!isRunning) transcriptParts.push(`QUALITY GATES ${artifact.outcome.toUpperCase()}`);
    transcriptParts.push(`Last run: ${artifact.ranAt}`, '');
    for (const gate of artifact.gates) {
      const mark = gate.passed ? '✓' : '✗';
      const secs = (gate.durationMs / 1000).toFixed(1);
      transcriptParts.push(`${mark} ${gate.name} (${secs}s)${gate.passed ? '' : ' FAILED'}`);
    }
    for (const gate of artifact.gates) {
      if (!gate.passed && (gate.output || gate.error)) {
        transcriptParts.push('', `--- ${gate.name} output ---`, (gate.output || gate.error || '').trim());
      }
    }
  } else if (centralStatus?.verificationNotes) {
    transcriptParts.push(centralStatus.verificationNotes);
  } else if (!isRunning) {
    // No artifact yet (verification last ran before the artifact writer
    // shipped) — show the status rather than an empty panel.
    transcriptParts.push(
      `QUALITY GATES ${String(verificationStatus ?? 'unknown').toUpperCase()}`,
      '',
      'No gate details recorded for the last run. Details are captured from the next verification run onward.',
    );
  }

  const gateDurationMs = artifact
    ? artifact.gates.reduce((total, gate) => total + gate.durationMs, 0)
    : null;

  return {
    type: 'lint',
    sessionId: `lint-${issueLower}`,
    model: 'quality-gates',
    startedAt: artifact?.ranAt || new Date().toISOString(),
    ...(artifact && !isRunning ? { endedAt: artifact.ranAt } : {}),
    duration: gateDurationMs !== null ? Math.floor(gateDurationMs / 1000) : null,
    status,
    presence: isRunning ? 'active' : 'ended',
    ...(includeTranscripts && transcriptParts.length > 0
      ? { transcript: transcriptParts.join('\n') }
      : {}),
  };
}
