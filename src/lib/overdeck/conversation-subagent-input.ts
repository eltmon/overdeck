/** Direct child input only; no parent relay, terminal fallback, or thread resume. */
import { getConversationByName } from './conversations.js';
import { postCodexAppServerOp } from './conversation-delivery.js';
import { resolveCodexSubagentTranscript } from '../../dashboard/server/services/conversation/codex-subagents.js';
import type { ConversationReadDependencies, ConversationReadResult } from './conversation-reads.js';

export async function conversationSubagentInput(
  name: string,
  agentId: string,
  deps: Pick<ConversationReadDependencies, 'resolveSessionFile'>,
  body?: Record<string, unknown>,
): Promise<ConversationReadResult> {
  const conversation = getConversationByName(name);
  if (!conversation) return { status: 404, body: { error: 'Conversation not found' } };
  if (!agentId || !/^[a-zA-Z0-9_-]{1,128}$/.test(agentId)) {
    return { status: 400, body: { error: 'Invalid subagent id' } };
  }
  const unavailable = { status: body ? 409 : 200, body: { direct: false, error: 'Direct input is unavailable for this subagent.' } };
  if (conversation.harness !== 'codex' || conversation.status === 'ended' || conversation.endedAt) return unavailable;
  const parentFile = await deps.resolveSessionFile(conversation);
  if (!parentFile || !await resolveCodexSubagentTranscript(parentFile, agentId)) {
    return { status: 404, body: { error: 'Subagent does not belong to this conversation' } };
  }
  if (body && (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 50_000)) {
    return { status: 400, body: { error: 'A message of at most 50000 characters is required' } };
  }
  try {
    const response = await postCodexAppServerOp(conversation.tmuxSession, {
      op: body ? 'subagent-message' : 'subagent-input',
      threadId: agentId,
      ...(body ? { content: body.message } : {}),
    });
    return { body: response };
  } catch {
    // A capability probe is fail-closed. A send failure is never retried or
    // reported as successful: the UI retains the draft for the operator.
    return body
      ? { status: 409, body: { error: 'Could not confirm delivery to this subagent. Check its transcript before retrying.' } }
      : unavailable;
  }
}
