import type { IssueState, PipelineBucket, SessionNode } from '@overdeck/contracts';

export type FeatureStateTone = 'rest' | 'machine' | 'specialist' | 'human' | 'outcome';

export interface FeatureStateBadge {
  /** Stable key: an IssueState, or 'planning' / 'merged-closeout' / 'closed-tracker'. */
  key: string;
  label: string;
  tone: FeatureStateTone;
  /** Full-sentence tooltip. */
  title: string;
}

export interface FeatureStateBadgeInput {
  storeState?: IssueState | null;   // useDerivedIssueState(id)?.state
  restState?: IssueState | null;    // feature.state
  sessions?: readonly SessionNode[];
  pipelineBucket?: PipelineBucket;
  rawTrackerState?: string;
}

const STATE_BADGES: Record<IssueState, Omit<FeatureStateBadge, 'key'>> = {
  backlog: { label: 'Backlog', tone: 'rest', title: 'Open issue with no plan yet.' },
  parked: { label: 'Parked', tone: 'rest', title: 'Parked by the operator; the pipeline will not pick it up.' },
  planned: { label: 'Planned', tone: 'rest', title: 'Planned and waiting for a work agent.' },
  working: { label: 'Working', tone: 'machine', title: 'A work agent owns this issue.' },
  'in-review': { label: 'In review', tone: 'human', title: 'The pull request is in review.' },
  'changes-requested': { label: 'Changes requested', tone: 'human', title: 'Review asked for changes.' },
  ready: { label: 'Ready', tone: 'human', title: 'Approved, green and mergeable — awaiting your merge.' },
  merged: { label: 'Merged', tone: 'outcome', title: 'The pull request is merged.' },
  closed: { label: 'Closed', tone: 'rest', title: 'The tracker issue is closed.' },
};

function hasActivePlanningSession(sessions?: readonly SessionNode[]): boolean {
  if (!sessions) return false;
  return sessions.some(
    (session) => session.type === 'planning' && (session.presence === 'active' || session.presence === 'idle'),
  );
}

export function resolveFeatureStateBadge(input: FeatureStateBadgeInput): FeatureStateBadge | null {
  const state = input.storeState ?? input.restState ?? null;

  if ((state === 'planned' || state === 'backlog' || state === null) && hasActivePlanningSession(input.sessions)) {
    return {
      key: 'planning',
      label: 'Planning',
      tone: 'specialist',
      title: 'A planning agent is writing the plan for this issue.',
    };
  }

  if (state !== null) {
    return { key: state, ...STATE_BADGES[state] };
  }

  if (input.pipelineBucket === 'post_merge_limbo') {
    return { key: 'merged-closeout', label: 'Merged', tone: 'outcome', title: 'Merged; close-out has not run yet.' };
  }

  const rawTrackerState = input.rawTrackerState?.toLowerCase();
  if (rawTrackerState && (rawTrackerState.includes('closed') || rawTrackerState.includes('done') || rawTrackerState.includes('canceled'))) {
    return { key: 'closed-tracker', label: 'Closed', tone: 'rest', title: 'The tracker issue is closed.' };
  }

  return null;
}
