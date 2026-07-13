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
