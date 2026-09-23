import type { Role } from './role.js';
import {
  answerSessionPaneChoice,
  captureSessionPaneChoice,
  PANE_CAPTURE_LINES,
  paneChoiceFromText,
  type PendingPaneChoice,
  type SessionPaneChoiceDeps,
} from '../session-pane-choice.js';
import type { AgentPaneRef } from '../terminal-backends/types.js';

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

export interface AgentResumePaneDeps extends SessionPaneChoiceDeps {
  /**
   * The pane the resume just launched. A pane on a backend other than tmux is
   * read and keyed through that backend (review of #3992, M2); without one, or
   * for a tmux pane, the tmux pane-choice door runs as before.
   */
  pane?: AgentPaneRef;
}

/**
 * Pane I/O for a pane that is not a tmux session: the backend's own read, and
 * raw keys. Herdr's `agent.prompt` refuses an agent blocked on a dialog
 * (`agent_blocked`), so the gate can only be crossed with keys.
 */
async function backendPaneChoiceDeps(pane: AgentPaneRef): Promise<SessionPaneChoiceDeps> {
  const { readHerdrPaneText } = await import('../terminal-backends/herdr.js');
  const { sendHerdrPaneKeys } = await import('../terminal-backends/agent-pane-io.js');
  return {
    capture: (_agentId, lines) => readHerdrPaneText(pane.paneId, lines),
    sendKey: (_agentId, key) => sendHerdrPaneKeys(pane.paneId, [key]),
    // The pane was just launched and every step reads it directly; a read
    // that fails is what reports it gone.
    sessionExists: async () => true,
  };
}

/**
 * Cross only Claude Code's known resume-summary gate before autonomous agent
 * continuation delivery. Every other pane choice remains untouched.
 *
 * On tmux an unreadable pane reads as an empty screen (`capture-pane` answers
 * `''` for a missing session), and the delivery that follows fails on its own.
 * On any other backend an unreadable pane FAILS SAFE: `ready: false`, so the
 * continuation is never typed blind into a screen that may hold the gate.
 */
export async function prepareAutonomousAgentResumePane(
  agentId: string,
  role: Role,
  deps: AgentResumePaneDeps = {},
): Promise<AgentResumePanePreparation> {
  const { pane, ...overrides } = deps;
  const onOtherBackend = pane !== undefined && pane.backend !== 'tmux';
  const paneDeps: SessionPaneChoiceDeps = onOtherBackend
    ? { ...(await backendPaneChoiceDeps(pane)), ...overrides }
    : overrides;

  let choice: PendingPaneChoice | null;
  if (onOtherBackend) {
    let screen: string;
    try {
      screen = await paneDeps.capture!(agentId, PANE_CAPTURE_LINES);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ready: false,
        reason: `could not read ${pane.backend} pane ${pane.paneId} to check for a resume menu: ${detail}`,
      };
    }
    choice = paneChoiceFromText(screen);
  } else {
    choice = paneDeps.capture
      ? await captureSessionPaneChoice(agentId, paneDeps.capture)
      : await captureSessionPaneChoice(agentId);
  }
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
  }, paneDeps);
  if (result.body.ok === true) {
    return { ready: true, action: 'resumed-from-summary' };
  }

  const error = typeof result.body.error === 'string' ? result.body.error : 'unknown pane-choice failure';
  return { ready: false, reason: `could not select Resume from summary: ${error}` };
}
