/**
 * PAN-4485: stop on a superseded /clear row stops the chain head, never
 * the superseded row's own (shared) runtime twice.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `stop-clear-chain-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;

const { closeConversationPane } = vi.hoisted(() => ({ closeConversationPane: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../conversation-liveness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation-liveness.js')>()),
  closeConversationPane,
}));
vi.mock('../companion-terminal/index.js', () => ({ closeCompanionTerminalForOwner: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../dashboard/server/services/conversation-attachments.js', () => ({
  cleanupConversationAttachments: vi.fn().mockResolvedValue(undefined),
  cleanupUnreferencedConversationAttachments: vi.fn().mockResolvedValue(undefined),
}));

const { closeOverdeckDatabase } = await import('../infra.js');
const { createConversation, getConversationByName, markConversationEnded, setClearedToConvId, archiveConversation } = await import('../conversations.js');
const { handleConversationStop } = await import('../conversation-runtime.js');

const CWD = join(TEST_HOME, 'projects', 'fixture');
const PARENT_ENDED_AT_MS = 1_700_000_000_000;

beforeAll(() => {
  mkdirSync(CWD, { recursive: true });
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

function makeChain(suffix: string) {
  const parent = createConversation({ name: `parent-${suffix}`, tmuxSession: `conv-${suffix}`, cwd: CWD, harness: 'claude-code' });
  const sibling = createConversation({ name: `parent-${suffix}-post-clear`, tmuxSession: `conv-${suffix}`, cwd: CWD, harness: 'claude-code' });
  setClearedToConvId(parent.name, sibling.id);
  markConversationEnded(parent.name, PARENT_ENDED_AT_MS);
  return { parent, sibling };
}

describe('handleConversationStop clear-chain redirect', () => {
  it('stopping the sibling (chain head) stops the shared pane once; parent endedAt is unchanged', async () => {
    const { parent, sibling } = makeChain('a');

    await handleConversationStop(sibling.name, {});

    expect(closeConversationPane).toHaveBeenCalledTimes(1);
    expect(closeConversationPane).toHaveBeenCalledWith(`conv-a`);
    expect(getConversationByName(sibling.name)?.status).toBe('ended');
    expect(getConversationByName(parent.name)?.endedAt).toBe(new Date(PARENT_ENDED_AT_MS).toISOString());
  });

  it('stopping the superseded parent redirects to the chain head; parent endedAt is unchanged', async () => {
    const { parent, sibling } = makeChain('b');

    const response = await handleConversationStop(parent.name, {});
    const payload = JSON.parse(new TextDecoder().decode((response as unknown as { body: { body: Uint8Array } }).body.body));

    expect(closeConversationPane).toHaveBeenCalledTimes(1);
    expect(closeConversationPane).toHaveBeenCalledWith('conv-b');
    expect(getConversationByName(sibling.name)?.status).toBe('ended');
    expect(getConversationByName(parent.name)?.endedAt).toBe(new Date(PARENT_ENDED_AT_MS).toISOString());
    expect(payload['stoppedConversation']).toBe(sibling.name);
  });

  it('stopping the parent of a broken chain stops nothing', async () => {
    const { parent, sibling } = makeChain('c');
    archiveConversation(sibling.name);

    await handleConversationStop(parent.name, {});

    expect(closeConversationPane).not.toHaveBeenCalled();
    expect(getConversationByName(parent.name)?.endedAt).toBe(new Date(PARENT_ENDED_AT_MS).toISOString());
  });
});
