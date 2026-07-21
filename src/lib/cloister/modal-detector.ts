import { Effect } from 'effect';
import { capturePane, sendKeysAsync } from '../tmux.js';

export interface KnownModal {
  id: string;
  matches: (pane: string) => boolean;
  keys: readonly string[];
}

export const KNOWN_AGENT_MODALS: readonly KnownModal[] = [{
  id: 'codex-rate-limit-model-nudge',
  matches: pane => /rate limit/i.test(pane) && /keep current model/i.test(pane),
  keys: ['Down', 'Enter'],
}];

// Claude Code boot-blocking TUI screens: first-run onboarding (theme picker,
// login-method picker, OAuth paste prompt) and the folder-trust dialog. A
// session parked on one never starts its JSONL transcript, so the conversation
// chat view has nothing to render and its composer cannot answer the screen —
// only the terminal can. These must never be auto-answered: the login picker
// starts an OAuth flow, and completing a spurious onboarding can rewrite the
// real ~/.claude.json (conv-20260714-4261: a transient config read race at
// spawn made a fully-configured machine boot into fresh-install onboarding).
const CLAUDE_BOOT_SCREEN_PATTERNS: readonly RegExp[] = [
  /Choose the text style that looks best with your terminal/i,
  /Select login method:/i,
  /Do you trust the files in this (?:folder|directory)\?/i,
  /Paste code here if prompted/i,
];

export function paneShowsClaudeBootBlockingScreen(pane: string): boolean {
  return CLAUDE_BOOT_SCREEN_PATTERNS.some(pattern => pattern.test(pane));
}

/** Rollout JSONL is launch/turn attribution only until a captured switch proves otherwise. */
// A "switched/switching to <token>" phrase only counts as a model switch when
// the phrase names a model or the token is plausibly a model id. Without this
// guard, git's "Switched to branch 'feature/x'" (printed by every checkout)
// captured "branch" and halted the agent as model_divergence — this killed
// PAN-1491's review convoy twice.
const MODEL_SHAPED_TOKEN = /^(?:gpt|o\d|claude|kimi|glm|gemini|deepseek|qwen|minimax|grok)[\w.-]*$/i;

export function paneShowsModelSwitch(pane: string, launchModel: string): boolean {
  const modelPhrase = pane.match(/model\s+(?:switched|switching)\s+to\s+([\w.-]+)|(?:switched|switching)\s+model\s+to\s+([\w.-]+)/i);
  let target = modelPhrase?.[1] ?? modelPhrase?.[2];
  if (!target) {
    const generic = pane.match(/(?:switched|switching)\s+to\s+([\w.-]+)/i)?.[1];
    if (generic && MODEL_SHAPED_TOKEN.test(generic)) target = generic;
  }
  return Boolean(target && target.toLowerCase() !== launchModel.toLowerCase());
}

export interface ModalHandlerDeps {
  capturePane: (agentId: string) => Promise<string>;
  sendKey: (agentId: string, key: string) => Promise<void>;
  settle: () => Promise<void>;
}

const defaultDeps: ModalHandlerDeps = {
  capturePane: agentId => Effect.runPromise(capturePane(agentId, 100)),
  sendKey: (agentId, key) => sendKeysAsync(agentId, key, 'known-modal-handler'),
  settle: () => new Promise(resolve => setTimeout(resolve, 300)),
};

export async function handleKnownAgentModal(agentId: string, deps: ModalHandlerDeps = defaultDeps, initialPane?: string): Promise<'none' | 'handled' | 'needs-you'> {
  const pane = initialPane ?? await deps.capturePane(agentId);
  const modal = KNOWN_AGENT_MODALS.find(candidate => candidate.matches(pane));
  if (!modal) return 'none';
  for (const key of modal.keys) await deps.sendKey(agentId, key);
  await deps.settle();
  return modal.matches(await deps.capturePane(agentId)) ? 'needs-you' : 'handled';
}
