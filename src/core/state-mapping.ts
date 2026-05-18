/**
 * Panopticon State Mapping System
 *
 * Maps Panopticon's canonical workflow states to various issue tracker states.
 * Supports auto-creation of missing states where possible, and label fallbacks.
 */

// Panopticon's canonical workflow states
export type CanonicalState =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'verifying_on_main'
  | 'done'
  | 'canceled';

// State type categories (Linear terminology)
export type StateType = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

// Canonical state definitions
export interface CanonicalStateDefinition {
  name: CanonicalState;
  type: StateType;
  description: string;
  color: string;
}

export const CANONICAL_STATES: CanonicalStateDefinition[] = [
  { name: 'backlog', type: 'backlog', description: 'Ideas and future work', color: '#6b7280' },
  { name: 'todo', type: 'unstarted', description: 'Prioritized and ready', color: '#3b82f6' },
  { name: 'in_progress', type: 'started', description: 'Agent executing', color: '#eab308' },
  { name: 'in_review', type: 'started', description: 'PR awaiting review', color: '#ec4899' },
  { name: 'verifying_on_main', type: 'started', description: 'Merged and awaiting verification on main', color: '#f59e0b' },
  { name: 'done', type: 'completed', description: 'Work complete', color: '#22c55e' },
  { name: 'canceled', type: 'canceled', description: "Won't do", color: '#71717a' },
];

export const STATE_TYPE_MAP: Record<CanonicalState, StateType> = {
  backlog: 'backlog',
  todo: 'unstarted',
  in_progress: 'started',
  in_review: 'started',
  verifying_on_main: 'started',
  done: 'completed',
  canceled: 'canceled',
};

// Strategy for handling missing states
export type MissingStateStrategy = 'auto_create' | 'error';

// Auto-create configuration for a specific state
export interface AutoCreateStateConfig {
  type: StateType;
  color: string;
  positionAfter?: string;     // State name to position after
}

// Tracker-specific state mapping
export interface TrackerStateMapping {
  stateMap: Record<CanonicalState, string | { status: string; label?: string | null }>;
  missingStateStrategy: MissingStateStrategy;
  autoCreateConfig?: Record<string, AutoCreateStateConfig>;
  // Tracker-specific options
  projectBoard?: {
    enabled: boolean;
    name: string;
    columnMap: Record<CanonicalState, string>;
  };
}

// Supported trackers
export type SupportedTracker = 'linear' | 'github' | 'gitlab' | 'jira' | 'trello';

// Full state mapping configuration
export interface StateMappingConfig {
  canonicalStates: CanonicalStateDefinition[];
  trackers: Record<SupportedTracker, TrackerStateMapping>;
}

// Default state mappings for supported trackers
export const DEFAULT_STATE_MAPPINGS: StateMappingConfig = {
  canonicalStates: CANONICAL_STATES,
  trackers: {
    linear: {
      stateMap: {
        backlog: 'Backlog',
        todo: 'Todo',
        in_progress: 'In Progress',
        in_review: 'In Review',
        verifying_on_main: 'In Review',
        done: 'Done',
        canceled: 'Canceled',
      },
      missingStateStrategy: 'auto_create',
    },

    github: {
      stateMap: {
        backlog: { status: 'open', label: null },
        todo: { status: 'open', label: null },
        in_progress: { status: 'open', label: 'in-progress' },
        in_review: { status: 'open', label: 'in-review' },
        verifying_on_main: { status: 'open', label: 'verifying-on-main' },
        done: { status: 'closed', label: null },
        canceled: { status: 'closed', label: 'wontfix' },
      },
      missingStateStrategy: 'error',
      projectBoard: {
        enabled: true,
        name: 'Panopticon',
        columnMap: {
          backlog: 'Backlog',
          todo: 'Todo',
          in_progress: 'In Progress',
          in_review: 'Review',
          verifying_on_main: 'Verifying',
          done: 'Done',
          canceled: 'Done',
        },
      },
    },

    gitlab: {
      stateMap: {
        backlog: { status: 'opened', label: 'backlog' },
        todo: { status: 'opened', label: 'todo' },
        in_progress: { status: 'opened', label: 'in-progress' },
        in_review: { status: 'opened', label: 'in-review' },
        verifying_on_main: { status: 'opened', label: 'in-review' },
        done: { status: 'closed', label: null },
        canceled: { status: 'closed', label: 'wontfix' },
      },
      missingStateStrategy: 'error',
    },

    jira: {
      stateMap: {
        backlog: 'Backlog',
        todo: 'To Do',
        in_progress: 'In Progress',
        in_review: 'In Review',
        verifying_on_main: 'In Review',
        done: 'Done',
        canceled: 'Canceled',
      },
      missingStateStrategy: 'error', // Can't auto-create in Jira
    },

    trello: {
      stateMap: {
        backlog: 'Backlog',
        todo: 'To Do',
        in_progress: 'Doing',
        in_review: 'Review',
        verifying_on_main: 'Review',
        done: 'Done',
        canceled: 'Archived',
      },
      missingStateStrategy: 'auto_create', // Trello lists are easy to create
    },
  },
};

// Virtual state tracking for issues
export interface PanopticonIssueState {
  issueId: string;
  panopticonState: CanonicalState;
  trackerState: string;
  lastSyncedAt: string;
  syncStatus: 'synced' | 'pending' | 'conflict';
  fallbacksUsed: string[];
}

// State transition result
export interface StateTransitionResult {
  success: boolean;
  panopticonState: CanonicalState;
  trackerState: string;
  fallbacksUsed: string[];
  warnings: string[];
  error?: string;
}

// Tracker state check result
export interface TrackerStateCheckResult {
  tracker: SupportedTracker;
  team?: string;
  existingStates: string[];
  missingStates: CanonicalState[];
  recommendations: {
    state: CanonicalState;
    action: 'create' | 'skip';
    details: string;
  }[];
}

/**
 * Map a tracker state name to a canonical state
 */
export function trackerStateToCanonical(
  trackerState: string,
  tracker: SupportedTracker = 'linear'
): CanonicalState {
  const mapping = DEFAULT_STATE_MAPPINGS.trackers[tracker];
  if (!mapping) return 'backlog';

  // Check direct state map
  for (const [canonical, mapped] of Object.entries(mapping.stateMap)) {
    if (typeof mapped === 'string') {
      if (mapped.toLowerCase() === trackerState.toLowerCase()) {
        return canonical as CanonicalState;
      }
    } else if (mapped.label === trackerState.toLowerCase()) {
      return canonical as CanonicalState;
    }
  }

  // Fallback heuristics
  const lower = trackerState.toLowerCase();
  if (lower.includes('backlog') || lower.includes('triage')) return 'backlog';
  if (lower.includes('todo') || lower.includes('ready') || lower.includes('unstarted')) return 'todo';
  if (lower.includes('progress') || lower.includes('started') || lower.includes('active')) return 'in_progress';
  if (lower.includes('review') || lower.includes('qa') || lower.includes('testing')) return 'in_review';
  if (lower.includes('done') || lower.includes('complete') || lower.includes('closed')) return 'done';
  if (lower.includes('cancel') || lower.includes('duplicate') || lower.includes('wontfix')) return 'canceled';

  return 'backlog';
}

/**
 * Get the tracker state name for a canonical state
 */
export function canonicalToTrackerState(
  canonicalState: CanonicalState,
  tracker: SupportedTracker = 'linear'
): string {
  const mapping = DEFAULT_STATE_MAPPINGS.trackers[tracker];
  if (!mapping) return canonicalState;

  const mapped = mapping.stateMap[canonicalState];
  if (typeof mapped === 'string') {
    return mapped;
  } else {
    return mapped.label || mapped.status;
  }
}

/**
 * Workflow labels that should be removed during state transitions
 */
export const WORKFLOW_LABELS = [
  'in-progress',
  'in progress',
  'in-review',
  'in review',
  'review-ready',
  'review ready',
  'planned',
  'planning',
  'done',
  'merged',
  'verifying-on-main',
  'needs-close-out',
  'wontfix',
  'duplicate',
];

/**
 * Get the target workflow label for a canonical state
 */
export function getStateLabel(state: CanonicalState): string | null {
  switch (state) {
    case 'in_progress':
      return 'in-progress';
    case 'in_review':
      return 'in-review';
    case 'verifying_on_main':
      return 'verifying-on-main';
    case 'done':
      return 'done';
    default:
      return null;
  }
}

/**
 * Map GitHub issue state + labels to canonical state.
 * This function handles the GitHub-specific mapping where issues have both
 * a state (open/closed) and workflow labels.
 *
 * @param state - GitHub issue state ('open' or 'closed')
 * @param labels - Array of label names on the issue
 * @returns Canonical state string
 */
export function mapGitHubStateToCanonical(state: string, labels: string[]): CanonicalState {
  // Handle both API lowercase and gh CLI uppercase
  const stateLower = state.toLowerCase();
  const labelNames = labels.map(l => l.toLowerCase());
  const hasCanceledLabel = labelNames.some(
    l => l === 'canceled' || l === 'cancelled' || l === 'duplicate' || l === 'wontfix' || l === "won't do",
  );

  // Closed issues are terminal. Distinguish canceled work from completed work.
  if (stateLower === 'closed') {
    return hasCanceledLabel ? 'canceled' : 'done';
  }

  // Some trackers keep canceled issues open and rely on labels.
  if (hasCanceledLabel) {
    return 'canceled';
  }

  // For open issues, check labels for workflow state.
  // Order matters: more progressed states take precedence.

  // Most progressed states first
  if (labelNames.some(l => l === 'verifying-on-main' || l === 'needs-close-out')) {
    return 'verifying_on_main';
  }
  if (labelNames.some(l => l === 'closed-out')) {
    return 'in_progress';
  }
  // merged = legacy postMergeLifecycle label; issue may still be open if auto-close failed
  if (labelNames.some(l => l === 'merged')) {
    return 'done';
  }
  // "done" label on OPEN issues = work complete, pending merge/closure → in_review
  // (actual "done" status only for CLOSED issues, handled above)
  if (labelNames.some(l => l === 'done' || l.includes('completed'))) {
    return 'in_review';
  }
  if (labelNames.some(l => l.includes('in review') || l.includes('in-review') || l.includes('review') || l.includes('qa'))) {
    return 'in_review';
  }
  if (labelNames.some(l => l.includes('in progress') || l.includes('in-progress') || l.includes('wip'))) {
    return 'in_progress';
  }
  // Early workflow stages
  if (labelNames.some(l => l.includes('backlog') || l.includes('icebox'))) {
    return 'backlog';
  }
  if (labelNames.some(l => l.includes('todo') || l.includes('ready'))) {
    return 'todo';
  }

  // Default open issues to todo
  return 'todo';
}

/**
 * Get the target state name for a Linear team.
 * Uses the DEFAULT_STATE_MAPPINGS to find the Linear state name.
 *
 * @param canonicalState - The canonical state to map
 * @returns The Linear state name (e.g., 'In Review')
 */
export function getLinearStateName(canonicalState: CanonicalState): string {
  const mapping = DEFAULT_STATE_MAPPINGS.trackers.linear;
  const mapped = mapping.stateMap[canonicalState];
  return typeof mapped === 'string' ? mapped : canonicalState;
}

/**
 * Find a Linear workflow state by name in a team.
 * Returns null if not found.
 *
 * @param states - Array of Linear workflow states from the SDK
 * @param stateName - The state name to find
 * @returns The matching state or null
 */
export function findLinearStateByName(states: any[], stateName: string): any | null {
  // Try exact match first
  const exactMatch = states.find(s => s.name === stateName);
  if (exactMatch) return exactMatch;

  // Try case-insensitive match
  const lowerName = stateName.toLowerCase();
  return states.find(s => s.name.toLowerCase() === lowerName) || null;
}

/**
 * Clean up workflow labels during state transitions.
 * Removes all workflow labels, then adds the label matching the target state (if any).
 *
 * @param currentLabels - Array of current label names
 * @param targetState - The canonical state being transitioned to
 * @returns Array of label names after cleanup
 */
export function cleanupWorkflowLabels(
  currentLabels: string[],
  targetState: CanonicalState
): string[] {
  // Remove all workflow labels
  const cleaned = currentLabels.filter(
    label => !WORKFLOW_LABELS.includes(label.toLowerCase())
  );

  // Add the label matching the target state (if applicable)
  const targetLabel = getStateLabel(targetState);
  if (targetLabel && !cleaned.includes(targetLabel)) {
    cleaned.push(targetLabel);
  }

  return cleaned;
}
