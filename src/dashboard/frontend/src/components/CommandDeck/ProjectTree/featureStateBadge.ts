import type { DerivedWorkStart, IssueState, PipelineBucket, SessionNode } from '@overdeck/contracts';

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
  /** PAN-4399: the workspace journal's read on a post-planning auto-start. */
  workStart?: DerivedWorkStart | null;
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
    if (input.workStart?.status === 'not-started') {
      return {
        key: 'work-not-started',
        label: 'Work agent not started',
        tone: 'human',
        title: 'Planning finished but the work agent never started. Start it from Needs you or run pan start.',
      };
    }
    if (input.workStart?.status === 'retrying' && input.workStart.held) {
      return {
        key: 'work-start-held',
        label: 'Work start held',
        tone: 'machine',
        title: 'The automatic work-agent start is deferred and held while the Deacon is frozen — unfreeze it, or run pan start.',
      };
    }
    if (input.workStart?.status === 'retrying') {
      return {
        key: 'work-start-retrying',
        label: 'Work start retrying',
        tone: 'machine',
        title: 'The automatic work-agent start was refused and is being retried.',
      };
    }
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
