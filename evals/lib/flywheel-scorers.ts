/**
 * Pure scorer logic for the flywheel launch-vs-report eval (PAN-2229, FR-1).
 *
 * Separated from `evals/flywheel-launch-decision.eval.ts` so the doctrine
 * predicates and scorers are importable and offline-auditable WITHOUT
 * triggering evalite's top-level `evalite()` registration (which only runs
 * under the evalite/vitest harness). No evalite import, no side effects.
 *
 * Each scorer re-derives its expected set from the fixture board itself,
 * mirroring the load-bearing rails in `roles/flywheel.md`, so a scorer bites
 * only on the scenario that stresses its rail and vacuously passes the others.
 */

// --- Fixture board shape -------------------------------------------------
// Mirrors the fields the flywheel doctrine actually reasons about (see the
// "pickup gate" and "Constraints" in roles/flywheel.md): the auto_pickup
// toggle, agent capacity, and per-issue author/assignees/labels/readiness.

export interface FlywheelBoardConfig {
  auto_pickup_backlog: boolean;
  maxAgents: number;
  minAgents: number;
  require_uat_before_merge: boolean;
}

export interface FlywheelAgent {
  id: string;
  issueId: string;
  state: string;
}

export interface FlywheelIssue {
  id: string;
  title: string;
  author: string;
  assignees: string[];
  labels: string[];
  ready: boolean;
  planned: boolean;
  status: string;
}

export interface FlywheelBoard {
  config: FlywheelBoardConfig;
  agents: FlywheelAgent[];
  issues: FlywheelIssue[];
}

export interface FlywheelAction {
  action?: string;
  target?: string;
  reason?: string;
}

// --- Doctrine predicates (re-derived from roles/flywheel.md) -------------

/** Authors the flywheel trusts without a human assignee. Mirrors the
 *  "Author/assignee gate" constraint: `author.login ∈ {eltmon,
 *  panopticon-agent[bot]}`. */
const TRUSTED_AUTHORS = new Set(['eltmon', 'panopticon-agent[bot]']);

export function isAuthorTrusted(issue: FlywheelIssue): boolean {
  return TRUSTED_AUTHORS.has(issue.author) || issue.assignees.includes('eltmon');
}

/** The auto-pickable predicate from "The pickup gate":
 *  ready && planned && (released || auto_pickup_backlog) && !parked &&
 *  !vetoed && !objection && !inPipeline && !epic, AND the author/assignee
 *  gate. This is the `ready && planned` backlog the flywheel must START. */
export function isAutoPickable(board: FlywheelBoard, issue: FlywheelIssue): boolean {
  const labels = new Set(issue.labels);
  if (['parked', 'vetoed', 'objection', 'epic'].some((l) => labels.has(l))) return false;
  if (issue.status !== 'backlog') return false; // inPipeline / not backlog
  if (!issue.ready || !issue.planned) return false;
  const released = labels.has('released');
  if (!(released || board.config.auto_pickup_backlog)) return false;
  if (!isAuthorTrusted(issue)) return false;
  return true;
}

/** A backlog issue the operator has NOT individually released. When
 *  `auto_pickup_backlog` is OFF the flywheel must hold these (planning-floor
 *  `plan` actions are fine; a `start` is not). */
export function isUnreleasedBacklog(issue: FlywheelIssue): boolean {
  return issue.status === 'backlog' && !new Set(issue.labels).has('released');
}

export function hasCapacityFor(board: FlywheelBoard): boolean {
  const running = board.agents.filter((a) => a.state === 'running').length;
  return running < board.config.maxAgents;
}

// --- Action-array helpers ------------------------------------------------

/** A start-type launch verb (start/launch/dispatch/spawn), per the AC. */
const START_RE = /start|launch|dispatch|spawn/i;

export function toAction(value: unknown): FlywheelAction {
  if (!value || typeof value !== 'object') return {};
  const v = value as Record<string, unknown>;
  return {
    action: typeof v.action === 'string' ? v.action : undefined,
    target: typeof v.target === 'string' ? v.target : undefined,
    reason: typeof v.reason === 'string' ? v.reason : undefined,
  };
}

/** Actions whose target names the issue — accepts the full id ("PAN-9001")
 *  or its numeric suffix ("9001"), matching the AC's /9001/ matcher. */
export function actionsForIssue(actions: FlywheelAction[], issueId: string): FlywheelAction[] {
  const num = issueId.replace(/^PAN-/i, '');
  return actions.filter((a) => {
    const t = a.target ?? '';
    return t.includes(issueId) || (num.length > 0 && t.includes(num));
  });
}

export function hasStartFor(actions: FlywheelAction[], issueId: string): boolean {
  return actionsForIssue(actions, issueId).some((a) => START_RE.test(a.action ?? ''));
}

// --- Scorer predicates (pure, offline-auditable) -------------------------
// Each maps a (board, actions) pair to a binary 1 (pass) / 0 (fail). A scorer
// vacuously passes (1) when the fixture stresses a different rail, so each
// bites only on its own scenario.

export function scoreLaunchesReleasedBacklog(board: FlywheelBoard, actions: FlywheelAction[]): 0 | 1 {
  if (!hasCapacityFor(board)) return 1; // no free slot → nothing to launch
  const mustStart = board.issues.filter((i) => isAutoPickable(board, i));
  if (mustStart.length === 0) return 1; // no auto-pickable issue → vacuous
  return mustStart.every((i) => hasStartFor(actions, i.id)) ? 1 : 0;
}

export function scoreExcludesUntrustedAuthor(board: FlywheelBoard, actions: FlywheelAction[]): 0 | 1 {
  const blocked = board.issues.filter((i) => !isAuthorTrusted(i));
  if (blocked.length === 0) return 1; // no untrusted issue → vacuous
  return blocked.every((i) => !hasStartFor(actions, i.id)) ? 1 : 0;
}

export function scoreRespectsAutoPickupOff(board: FlywheelBoard, actions: FlywheelAction[]): 0 | 1 {
  if (board.config.auto_pickup_backlog) return 1; // toggle ON → vacuous
  const held = board.issues.filter(isUnreleasedBacklog);
  if (held.length === 0) return 1;
  return held.every((i) => !hasStartFor(actions, i.id)) ? 1 : 0;
}

export function scoreNotesAuthorGateReason(board: FlywheelBoard, actions: FlywheelAction[]): 0 | 1 {
  const blocked = board.issues.filter((i) => !isAuthorTrusted(i));
  if (blocked.length === 0) return 1;
  return blocked.some((i) =>
    actionsForIssue(actions, i.id).some((a) => /author|assignee|trust|untrusted/i.test(a.reason ?? '')),
  )
    ? 1
    : 0;
}
