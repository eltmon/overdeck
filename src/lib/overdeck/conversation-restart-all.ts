import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { markRespawnPending } from '../../dashboard/server/services/pending-respawn.js';
import type { RuntimeName } from '../runtimes/types.js';
import { sessionOwners } from './conversation-clear-chain.js';
import { resolveConversationDeliveryMethod } from './conversation-delivery.js';
import { conversationLaunchContext } from './conversation-launch-context.js';
import { closeConversationPane, listLiveConversationSessions } from './conversation-liveness.js';
import {
  resolveAllowedHarness,
  spawnConversationSession,
  stopConversationRuntime,
  waitForConversationRuntimeReady,
} from './conversation-runtime.js';
import { listConversations, markConversationActive, setConversationHarness, type LegacyConversation as Conversation } from './conversations.js';
import { deliverMandatoryKimiResumeContext } from './resume-contract-delivery.js';

export async function handleConversationRestartAll(
  deps: { resolveSessionFile: (conv: Conversation) => Promise<string | null> },
): Promise<ReturnType<typeof jsonResponse>> {
  try {
    const allConvs = listConversations();
    const liveSessionNames = await listLiveConversationSessions();
    if (!liveSessionNames) return jsonResponse({ error: 'Terminal backend did not answer; no conversation restarted' }, { status: 503 });
    // PAN-4485: one restart per live session, through its owner
    const convs = sessionOwners(allConvs.filter((c) => liveSessionNames.has(c.tmuxSession)));
    const results: { name: string; model: string | null; status: string }[] = [];
    for (const conv of convs) {
      const respawn = markRespawnPending(conv.tmuxSession);
      let attemptedHarness: RuntimeName = conv.harness ?? 'claude-code';
      try {
        await closeConversationPane(conv.tmuxSession);
        const oldSessionId = conv.claudeSessionId;
        const sessionFileForResume = await deps.resolveSessionFile(conv);
        const canResume = !!oldSessionId && !!sessionFileForResume && existsSync(sessionFileForResume);
        const harness = await resolveAllowedHarness(conv.harness, conv.model);
        attemptedHarness = harness;
        await spawnConversationSession(conv.tmuxSession, conv.cwd, oldSessionId ?? randomUUID(), conv.model ?? undefined, conv.effort ?? undefined, conv.issueId ?? undefined, canResume, harness, false, conversationLaunchContext(conv));
        if (harness === 'acp' || harness === 'opencode' || harness === 'kimi-code' || harness === 'muse' || harness === 'prime-agent') {
          await waitForConversationRuntimeReady(conv.tmuxSession, harness, 'respawn');
        }
        if (harness === 'kimi-code' && !conv.bareContext) {
          await deliverMandatoryKimiResumeContext(
            conv.tmuxSession, conv.cwd, resolveConversationDeliveryMethod(conv),
          );
        }
        setConversationHarness(conv.name, harness);
        markConversationActive(conv.name);
        results.push({ name: conv.name, model: conv.model, status: 'restarted' });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[conversations] Failed to restart ${conv.name}:`, msg);
        // PAN-1837 review fix: kimi-code needs the same teardown-on-failure as
        // acp — a failed capture must not leave a running tmux session with no
        // owned native identity presented as a healthy conversation.
        if (attemptedHarness === 'acp' || attemptedHarness === 'kimi-code' || attemptedHarness === 'opencode' || attemptedHarness === 'muse' || attemptedHarness === 'prime-agent') await stopConversationRuntime(conv, conv.name);
        results.push({ name: conv.name, model: conv.model, status: 'failed' });
      } finally {
        respawn.done();
      }
    }
    console.log(`[conversations] Restarted ${results.filter(r => r.status === 'restarted').length}/${convs.length} conversations`);
    return jsonResponse({ restarted: results.length, results });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[conversations] restart conversations failed:', msg);
    return jsonResponse({ error: 'Internal server error' }, { status: 500 });
  }
}
