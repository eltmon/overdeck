import type { SessionNodeType } from '@panctl/contracts';

export interface RestartRouteInput {
  projectKey?: string | null;
  issueId: string;
  sessionId: string;
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
const directAgentRestartTypes = new Set(['test', 'ship', 'merge']);

export function getDirectRestartRequest(input: RestartRouteInput): RestartRequestDescriptor | null {
  if (!input.sessionType || input.sessionType === 'work') return null;

  if (reviewRestartTypes.has(input.sessionType)) {
    if (!input.projectKey) throw new Error(`Cannot find project for ${input.issueId}`);

    return {
      endpoint: `/api/specialists/${encodeURIComponent(input.projectKey)}/${encodeURIComponent(input.issueId)}/review/restart`,
      body: input.model ? { model: input.model } : {},
      successMessage: 'Review restarted',
      errorMessage: 'Failed to restart review',
    };
  }

  if (directAgentRestartTypes.has(input.sessionType)) {
    const label = input.sessionType.charAt(0).toUpperCase() + input.sessionType.slice(1);

    return {
      endpoint: `/api/agents/${encodeURIComponent(input.sessionId)}/restart`,
      body: input.model ? { model: input.model, graceful: false } : { graceful: false },
      successMessage: `${label} restarted`,
      errorMessage: `Failed to restart ${input.sessionType} agent`,
    };
  }

  return null;
}
