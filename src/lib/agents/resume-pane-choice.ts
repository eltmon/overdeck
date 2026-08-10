import type { Role } from './role.js';
import {
  answerSessionPaneChoice,
  captureSessionPaneChoice,
  type SessionPaneChoiceDeps,
} from '../session-pane-choice.js';

const AUTONOMOUS_RESUME_ROLES = new Set<Role>(['work', 'review', 'test', 'strike']);
const RESUME_SUMMARY_LABEL = 'Resume from summary';
const RESUME_GATE_LABELS = [
  RESUME_SUMMARY_LABEL,
  'Resume full session as-is',
  "Don't ask me again",
];

export type AgentResumePanePreparation =
  | { ready: true; action: 'clear' | 'resumed-from-summary' }
  | { ready: false; reason: string };

/**
 * Cross only Claude Code's known resume-summary gate before autonomous agent
 * continuation delivery. Every other pane choice remains untouched.
 */
export async function prepareAutonomousAgentResumePane(
  agentId: string,
  role: Role,
  deps: SessionPaneChoiceDeps = {},
): Promise<AgentResumePanePreparation> {
  const choice = deps.capture
    ? await captureSessionPaneChoice(agentId, deps.capture)
    : await captureSessionPaneChoice(agentId);
  if (!choice) return { ready: true, action: 'clear' };

  if (!AUTONOMOUS_RESUME_ROLES.has(role)) {
    return { ready: false, reason: `pane is blocked on a choice menu that role=${role} may not answer automatically` };
  }

  const labels = choice.options.map((option) => option.label);
  const summaryIndex = choice.options.findIndex((option) => (
    option.label === RESUME_SUMMARY_LABEL && option.recommended
  ));
  const isResumeSummaryGate = choice.options.length === RESUME_GATE_LABELS.length
    && RESUME_GATE_LABELS.every((label) => labels.includes(label))
    && summaryIndex >= 0;
  if (!isResumeSummaryGate) {
    return { ready: false, reason: 'pane is blocked on a choice menu other than the Claude resume-summary gate' };
  }

  const result = await answerSessionPaneChoice(agentId, {
    selectedIndex: summaryIndex,
    signature: choice.signature,
  }, deps);
  if (result.body.ok === true) {
    return { ready: true, action: 'resumed-from-summary' };
  }

  const error = typeof result.body.error === 'string' ? result.body.error : 'unknown pane-choice failure';
  return { ready: false, reason: `could not select Resume from summary: ${error}` };
}
