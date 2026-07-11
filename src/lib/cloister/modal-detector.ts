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
export function paneShowsModelSwitch(pane: string, launchModel: string): boolean {
  const match = pane.match(/(?:switched|switching)\s+(?:model\s+)?to\s+([\w.-]+)/i);
  return Boolean(match?.[1] && match[1].toLowerCase() !== launchModel.toLowerCase());
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
