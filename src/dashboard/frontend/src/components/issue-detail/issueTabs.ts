export type IssueTabEntryId = 'session' | 'tasks' | 'plan' | 'changes' | 'activity' | 'decisions' | 'discussion' | 'skills' | 'overview';
export type IssueTabView = 'conversation' | 'terminal' | 'map' | 'prd' | 'files' | 'checks' | 'artifacts' | 'feed' | 'history';
/** Canonical tab values: what onSelectTab emits and what a new link carries. */
export type IssueTabValue =
  | 'conversation' | 'terminal' | 'tasks' | 'plan' | 'prd' | 'files' | 'checks' | 'artifacts'
  | 'activity' | 'history' | 'decisions' | 'discussion' | 'skills' | 'overview';

// PAN-5253: one tab set. Ids are stable; labels and order are not.
export const ISSUE_DETAIL_TABS = [
  { id: 'session', label: 'Conversation' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'plan', label: 'Plan' },
  { id: 'changes', label: 'Changes' },
  { id: 'activity', label: 'Activity' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'discussion', label: 'Discussion' },
  { id: 'skills', label: 'Skills' },
  { id: 'overview', label: 'Details' },
] as const;

export interface ResolvedIssueTab { entry: IssueTabEntryId; view: IssueTabView | null; value: IssueTabValue }

const at = (entry: IssueTabEntryId, view: IssueTabView | null, value: IssueTabValue): ResolvedIssueTab => ({ entry, view, value });

/** Every tab value the drawer or the cockpit has ever accepted. Never delete a key: old links must keep resolving. */
const TAB_TABLE: Record<string, ResolvedIssueTab> = {
  conversation: at('session', 'conversation', 'conversation'),
  session: at('session', 'conversation', 'conversation'),
  terminal: at('session', 'terminal', 'terminal'),
  tasks: at('tasks', null, 'tasks'),
  plan: at('plan', 'map', 'plan'),
  prd: at('plan', 'prd', 'prd'),
  files: at('changes', 'files', 'files'),
  changes: at('changes', 'files', 'files'),
  code: at('changes', 'checks', 'checks'),
  checks: at('changes', 'checks', 'checks'),
  artifacts: at('changes', 'artifacts', 'artifacts'),
  activity: at('activity', 'feed', 'activity'),
  timeline: at('activity', 'feed', 'activity'),
  history: at('activity', 'history', 'history'),
  decisions: at('decisions', null, 'decisions'),
  discussion: at('discussion', null, 'discussion'),
  skills: at('skills', null, 'skills'),
  overview: at('overview', null, 'overview'),
  costs: at('overview', null, 'overview'),
  ship: at('overview', null, 'overview'),
};

export function resolveIssueTab(raw: string | null | undefined): ResolvedIssueTab | null {
  // Own keys only: a plain lookup would resolve "constructor" or "toString".
  return raw && Object.prototype.hasOwnProperty.call(TAB_TABLE, raw) ? TAB_TABLE[raw]! : null;
}

/** The views of an entry, in order. The first is the entry's default. */
export const ISSUE_TAB_VIEWS: Partial<Record<IssueTabEntryId, ReadonlyArray<{ value: IssueTabValue; label: string }>>> = {
  session: [{ value: 'conversation', label: 'Conversation' }, { value: 'terminal', label: 'Terminal' }],
  plan: [{ value: 'plan', label: 'Map' }, { value: 'prd', label: 'PRD' }],
  changes: [{ value: 'files', label: 'Files' }, { value: 'checks', label: 'Checks' }, { value: 'artifacts', label: 'Artifacts' }],
  activity: [{ value: 'activity', label: 'Feed' }, { value: 'history', label: 'Status history' }],
};

/** What a click on a tab entry emits: the current view when already inside the entry, else its default. */
export function entryClickValue(entry: IssueTabEntryId, current: string): IssueTabValue {
  const now = resolveIssueTab(current);
  if (now?.entry === entry) return now.value;
  return ISSUE_TAB_VIEWS[entry]?.[0]?.value ?? (entry as IssueTabValue);
}
