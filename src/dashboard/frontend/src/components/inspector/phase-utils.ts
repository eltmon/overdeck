import type { ReviewStatus } from './types';

export type PipelinePhase =
  | 'working'
  | 'verification'
  | 'reviewing'
  | 'testing'
  | 'merging'
  | 'idle';

export interface ActiveSession {
  sessionName: string;
  label: string;
  phase: PipelinePhase;
}

/**
 * Derive the project key from an issue ID.
 * e.g. "pan-509" → "pan", "min-123" → "min"
 */
export function getProjectKey(issueId: string): string {
  return issueId.toLowerCase().split('-')[0];
}

/**
 * Build the specialist tmux session name for a given project and type.
 * Matches the server-side convention in src/lib/cloister/specialists.ts.
 */
export function getSpecialistSessionName(projectKey: string, specialistType: string): string {
  return `specialist-${projectKey}-${specialistType}`;
}

/**
 * Determine the current pipeline phase from review status fields.
 */
export function detectPhase(reviewStatus: ReviewStatus | undefined): PipelinePhase {
  if (!reviewStatus) return 'idle';

  // Verification runs after agent signals completion, before review
  if (reviewStatus.verificationStatus === 'running') return 'verification';

  // Review specialist is actively running
  if (reviewStatus.reviewStatus === 'reviewing') return 'reviewing';

  // Test specialist is actively running
  if (reviewStatus.testStatus === 'testing') return 'testing';

  // Merge specialist is actively running
  if (reviewStatus.mergeStatus === 'merging') return 'merging';

  return 'idle';
}

/**
 * Derive the most relevant terminal session to show based on the current pipeline phase.
 *
 * Returns null when there is no agent and no active specialist (i.e. nothing to show).
 */
export function getActiveSession(
  issueId: string,
  agentId: string | undefined,
  reviewStatus: ReviewStatus | undefined,
): ActiveSession | null {
  const projectKey = getProjectKey(issueId);
  const phase = detectPhase(reviewStatus);

  switch (phase) {
    case 'reviewing':
      return {
        sessionName: getSpecialistSessionName(projectKey, 'review-agent'),
        label: 'Review',
        phase,
      };
    case 'testing':
      return {
        sessionName: getSpecialistSessionName(projectKey, 'test-agent'),
        label: 'Test',
        phase,
      };
    case 'merging':
      return {
        sessionName: getSpecialistSessionName(projectKey, 'merge-agent'),
        label: 'Merge',
        phase,
      };
    case 'verification':
      // Verification output goes through the agent's session (cloister sends feedback there)
      if (agentId) {
        return { sessionName: agentId, label: 'Verification', phase };
      }
      return null;
    default:
      // working or idle — show agent session if available
      if (agentId) {
        return { sessionName: agentId, label: 'Agent', phase: 'working' };
      }
      return null;
  }
}
