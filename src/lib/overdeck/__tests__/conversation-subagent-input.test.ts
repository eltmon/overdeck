import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getConversationByName: vi.fn(), postCodexAppServerOp: vi.fn(), resolveCodexSubagentTranscript: vi.fn() }));
vi.mock('../conversations.js', () => ({ getConversationByName: mocks.getConversationByName }));
vi.mock('../conversation-delivery.js', () => ({ postCodexAppServerOp: mocks.postCodexAppServerOp }));
vi.mock('../../../dashboard/server/services/conversation/codex-subagents.js', () => ({ resolveCodexSubagentTranscript: mocks.resolveCodexSubagentTranscript }));
import { conversationSubagentInput } from '../conversation-subagent-input.js';
const deps = { resolveSessionFile: vi.fn(async () => '/parent.jsonl') };

describe('conversation child input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConversationByName.mockReturnValue({ harness: 'codex', status: 'active', tmuxSession: 'conv-parent' });
    mocks.resolveCodexSubagentTranscript.mockResolvedValue('/child.jsonl');
    mocks.postCodexAppServerOp.mockResolvedValue({ direct: true });
  });
  it('probes the parent host without sending input', async () => {
    expect(await conversationSubagentInput('parent', 'child', deps)).toEqual({ body: { direct: true } });
    expect(mocks.postCodexAppServerOp).toHaveBeenCalledWith('conv-parent', { op: 'subagent-input', threadId: 'child' });
  });
  it('sends unchanged child text to only the direct host operation', async () => {
    await conversationSubagentInput('parent', 'child', deps, { message: '/pan close is literal child input' });
    expect(mocks.postCodexAppServerOp).toHaveBeenCalledWith('conv-parent', { op: 'subagent-message', threadId: 'child', content: '/pan close is literal child input' });
  });
  it('rejects unrelated children before calling the host', async () => {
    mocks.resolveCodexSubagentTranscript.mockResolvedValue(null);
    expect((await conversationSubagentInput('parent', 'outsider', deps, { message: 'hello' })).status).toBe(404);
    expect(mocks.postCodexAppServerOp).not.toHaveBeenCalled();
  });
  it.each(['claude-code', 'pi'])('does not offer a composer or relay for %s', async harness => {
    mocks.getConversationByName.mockReturnValue({ harness, status: 'active' });
    expect((await conversationSubagentInput('parent', 'child', deps)).body).toMatchObject({ direct: false });
    expect((await conversationSubagentInput('parent', 'child', deps, { message: 'hello' })).status).toBe(409);
    expect(mocks.postCodexAppServerOp).not.toHaveBeenCalled();
  });
  it('fails closed for old hosts and never retries an uncertain send', async () => {
    mocks.postCodexAppServerOp.mockRejectedValue(new Error('socket unavailable'));
    expect((await conversationSubagentInput('parent', 'child', deps)).body).toMatchObject({ direct: false });
    expect((await conversationSubagentInput('parent', 'child', deps, { message: 'hello' })).status).toBe(409);
    expect(mocks.postCodexAppServerOp).toHaveBeenCalledTimes(2);
  });
  it('rejects ended sessions and invalid input', async () => {
    expect((await conversationSubagentInput('parent', '../child', deps)).status).toBe(400);
    expect((await conversationSubagentInput('parent', 'child', deps, { message: ' ' })).status).toBe(400);
    mocks.getConversationByName.mockReturnValue({ harness: 'codex', status: 'ended' });
    expect((await conversationSubagentInput('parent', 'child', deps, { message: 'hello' })).status).toBe(409);
    expect(mocks.postCodexAppServerOp).not.toHaveBeenCalled();
  });
});
