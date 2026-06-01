/**
 * pendingInput — shared vocabulary for the unified "agent awaiting input"
 * subsystem (PAN-1520). Every blocking surface (AskUserQuestion,
 * PermissionRequest, ExitPlanMode, EnterPlanMode, session-resume) is folded into
 * one `pendingInputKinds: string[]` on agents and conversations. This module is
 * the single source of truth for how those kinds are labelled in the UI, so the
 * indicator / tooltip / notification all read the same text instead of each
 * re-declaring its own map (which had already drifted across AgentCard,
 * ConversationRow, etc.).
 */

export type PendingInputKind =
  | 'askUserQuestion'
  | 'permissionRequest'
  | 'exitPlanMode'
  | 'enterPlanMode'
  | 'sessionResume';

/** Short label for a single kind (used in tooltips, joined by comma). */
export const PENDING_INPUT_KIND_LABEL: Record<string, string> = {
  askUserQuestion: 'Question waiting',
  permissionRequest: 'Permission pending',
  exitPlanMode: 'Plan approval pending',
  enterPlanMode: 'Plan being drafted',
  sessionResume: 'Session resume waiting',
};

/**
 * Human tooltip for a set of pending kinds. Falls back to a generic phrase when
 * the kinds array is empty (e.g. an agent flagged via the legacy
 * `hasPendingQuestion` boolean with no kinds populated yet).
 */
export function describePendingInput(kinds: ReadonlyArray<string> | undefined): string {
  if (!kinds || kinds.length === 0) return 'Waiting on your input';
  return kinds.map((k) => PENDING_INPUT_KIND_LABEL[k] ?? k).join(', ');
}

/**
 * The single "is this agent waiting on the operator?" predicate. PAN-1520.
 *
 * The server's `hasPendingQuestion` is the SUPERSET signal — it's true whenever
 * any blocking surface is detected (AskUserQuestion, plan-mode, pane-detected
 * wait, runtime waiting-on-human), even when `pendingInputKinds` is empty
 * (pane/runtime detections aren't JSONL-derived so they carry no kind). Surfaces
 * that branched on only one of these drifted; everyone should use this.
 */
export function isAwaitingInput(
  agent: { hasPendingQuestion?: boolean; pendingInputCount?: number } | null | undefined,
): boolean {
  if (!agent) return false;
  return agent.hasPendingQuestion === true || (agent.pendingInputCount ?? 0) > 0;
}
