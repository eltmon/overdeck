import type { SessionNodeType } from '@panctl/contracts';

export interface RestartRouteInput {
  projectKey?: string | null;
  issueId: string;
  sessionType?: SessionNodeType | string;
  role?: string;
  model?: string;
}

export interface RestartRequestDescriptor {
  endpoint: string;
  body: Record<string, unknown>;
  successMessage: string;
  errorMessage: string;
}

const reviewRestartTypes = new Set(['review', 'reviewer']);

export function getReviewRestartRequest(input: RestartRouteInput): RestartRequestDescriptor | null {
  if (!input.sessionType || !reviewRestartTypes.has(input.sessionType)) return null;
  if (!input.projectKey) throw new Error(`Cannot find project for ${input.issueId}`);

  return {
    endpoint: `/api/specialists/${encodeURIComponent(input.projectKey)}/${encodeURIComponent(input.issueId)}/review/restart`,
    body: input.model ? { model: input.model } : {},
    successMessage: 'Review restarted',
    errorMessage: 'Failed to restart review',
  };
}
