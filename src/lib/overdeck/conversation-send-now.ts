/**
 * PAN-5353: the conversation-facing `sendNowToConversation` door for Claude
 * Code's send-now chord. Mirrors the refusal order of `deliverConversationMessage`
 * (`conversation-message.ts`): every refusal returns before `press` is ever
 * called.
 */
import type { SendNowResult } from '../agents/send-now.js';
import { ensureMainInputTarget, type EnsureMainResult } from '../agents/input-target.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { pressSendNowChord } from '../terminal-backends/agent-pane-io.js';
import { conversationPendingPermission, type PendingPermission } from './conversation-permission.js';
import { conversationWriteRefusalBody } from './conversation-release.js';
import { getConversationByName, type LegacyConversation as Conversation } from './conversations.js';

export interface ConversationSendNowDeps {
  getConversation: (name: string) => Conversation | null;
  pendingPermission: (conv: Conversation) => Promise<PendingPermission | null>;
  ensureMain: (agentId: string) => Promise<EnsureMainResult>;
  press: (agentId: string) => Promise<void>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Press Claude Code's send-now chord in a conversation's own pane. Each
 * refusal step returns before any later step runs, and `press` is only ever
 * called once all of them pass.
 */
export async function sendNowToConversation(name: string, deps: Partial<ConversationSendNowDeps> = {}): Promise<SendNowResult> {
  const getConversation = deps.getConversation ?? getConversationByName;
  const pendingPermission = deps.pendingPermission ?? conversationPendingPermission;
  const ensureMain = deps.ensureMain ?? ensureMainInputTarget;
  const press = deps.press ?? pressSendNowChord;

  const conv = getConversation(name);
  if (!conv) return { ok: false, status: 404, code: 'not-found', error: 'Conversation not found' };

  const refusal = conversationWriteRefusalBody(conv);
  if (refusal) return { ok: false, status: 409, code: refusal.code, error: refusal.error };

  if (conv.status === 'ended') {
    return { ok: false, status: 409, code: 'not-running', error: 'The conversation has ended — resume it first' };
  }

  const behavior = getHarnessBehavior(conv.harness ?? 'claude-code');
  if (behavior.steerKind !== 'send-now-keys') {
    return { ok: false, status: 422, code: 'steer-unsupported', error: `${behavior.displayName} has no send-now` };
  }

  if (behavior.capabilities.paneInputGuard) {
    const permission = await pendingPermission(conv);
    if (permission?.answerable) {
      return { ok: false, status: 409, code: 'permission-pending', error: 'Waiting: the agent needs a permission answer first' };
    }
    const target = await ensureMain(conv.tmuxSession);
    if (!target.ok) {
      return { ok: false, status: 409, code: 'input-target-not-main', error: target.reason };
    }
  }

  try {
    await press(conv.tmuxSession);
  } catch (error) {
    return { ok: false, status: 502, code: 'press-failed', error: `Could not press send-now in ${conv.tmuxSession}'s pane: ${errorText(error)}` };
  }

  return { ok: true };
}
