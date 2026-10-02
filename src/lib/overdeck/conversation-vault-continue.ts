/**
 * The managed-conversation door for Session Vault "Continue here" (PAN-4437
 * D-8, FR-8, FR-9).
 *
 * After the dashboard adopts a record from another machine, the native
 * transcript sits where the harness resumes it. This module creates the
 * conversation row for it and launches `claude --resume` / `codex resume`
 * through the plain-fork tail of `runForkPipeline`: spawn with resume, wait
 * for the session, optionally deliver the drift note as the first turn, then
 * mark the row active and clear the fork status. A failure marks the row
 * failed and ended, like any fork.
 *
 * The row carries `forkStatus: 'spawning'` and no `forkRequest`, so a
 * dashboard restart mid-spawn ends it as failed (D-11); it stays resumable.
 */
import { randomUUID } from 'node:crypto';
import { MODEL_ID_PATTERN } from '../model-validation.js';
import {
  ensureForkSessionReady,
  handleForkPipelineFailure,
  injectForkSummary,
  registerInFlightForkPipeline,
} from './conversation-forks.js';
import {
  createConversation,
  markConversationActive,
  updateForkStatus,
  type LegacyConversation as Conversation,
} from './conversations.js';

export interface VaultContinuedConversationInput {
  name: string;
  tmuxSession: string;
  cwd: string;
  newSessionId: string;
  harness: 'claude-code' | 'codex';
  title: string;
  model: string | null;
  projectKey: string | null;
}

/** `<yyyymmdd>-<4 hex>` and `conv-<name>`: the plain-fork naming rule. */
export function allocateVaultContinueNames(now: Date = new Date()): { name: string; tmuxSession: string } {
  const name = `${now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 4)}`;
  return { name, tmuxSession: `conv-${name}` };
}

export function createVaultContinuedConversation(input: VaultContinuedConversationInput): Conversation {
  const conv = createConversation({
    name: input.name,
    tmuxSession: input.tmuxSession,
    cwd: input.cwd,
    claudeSessionId: input.newSessionId,
    title: input.title,
    titleSource: 'manual',
    titleSeed: 'Continued from Session Vault',
    model: input.model && MODEL_ID_PATTERN.test(input.model) ? input.model : undefined,
    harness: input.harness,
    projectKey: input.projectKey,
    forkStatus: 'spawning',
  });
  markConversationActive(conv.name);
  return conv;
}

/**
 * Spawn the harness resuming `conv.claudeSessionId` and deliver `note` as the
 * first turn when given. Never rejects: a failure is recorded on the row, so
 * callers may fire and forget.
 */
export async function launchVaultContinuedConversation(conv: Conversation, note: string | null): Promise<void> {
  return registerInFlightForkPipeline((async () => {
    try {
      if (!conv.claudeSessionId) throw new Error(`Conversation ${conv.name} has no session id to resume`);
      await ensureForkSessionReady(conv, conv.claudeSessionId, true, true);
      if (note !== null && await injectForkSummary(conv, note, 'vault-continue') === 'stranded') {
        throw new Error(`Drift note was not accepted by ${conv.name}`);
      }
      markConversationActive(conv.name);
      updateForkStatus(conv.name, null);
    } catch (err) {
      handleForkPipelineFailure(conv.name, err);
    }
  })());
}
