/**
 * PAN-4485: delete and archive of a superseded /clear row stop no runtime —
 * only the chain head owns the shared session.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `archive-clear-chain-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
const { createConversation, getConversationByName, setClearedToConvId } = await import('../conversations.js');
const { handleConversationDelete } = await import('../conversation-runtime.js');
const { archiveConversationByName } = await import('../conversation-archive.js');

const CWD = join(TEST_HOME, 'projects', 'fixture');

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
  const parent = createConversation({ name: `arc-parent-${suffix}`, tmuxSession: `conv-arc-${suffix}`, cwd: CWD, harness: 'claude-code' });
  const sibling = createConversation({ name: `arc-parent-${suffix}-post-clear`, tmuxSession: `conv-arc-${suffix}`, cwd: CWD, harness: 'claude-code' });
  setClearedToConvId(parent.name, sibling.id);
  return { parent, sibling };
}

function archiveDeps() {
  return {
    stopConversationRuntime: vi.fn().mockResolvedValue(undefined),
    invalidateFavoritesCache: vi.fn(),
    cleanupConversationAttachments: vi.fn().mockResolvedValue(undefined),
  };
}

describe('archiveConversationByName clear-chain guard', () => {
  it('archives a superseded parent without stopping any runtime', async () => {
    const { parent } = makeChain('a');
    const deps = archiveDeps();

    const result = await archiveConversationByName(parent.name, deps);

    expect(deps.stopConversationRuntime).not.toHaveBeenCalled();
    expect(result.body).toEqual({ success: true });
    expect(getConversationByName(parent.name)?.archivedAt).toBeTruthy();
  });

  it('archives the chain head and stops its runtime once', async () => {
    const { sibling } = makeChain('b');
    const deps = archiveDeps();

    await archiveConversationByName(sibling.name, deps);

    expect(deps.stopConversationRuntime).toHaveBeenCalledTimes(1);
  });
});

describe('handleConversationDelete clear-chain guard', () => {
  it('deletes a superseded parent without closing any pane; the sibling stays untouched', async () => {
    const { parent, sibling } = makeChain('c');

    await handleConversationDelete(parent.name, { invalidateFavoritesCache: vi.fn() });

    expect(closeConversationPane).not.toHaveBeenCalled();
    expect(getConversationByName(parent.name)?.archivedAt).toBeTruthy();
    expect(getConversationByName(sibling.name)?.archivedAt).toBeFalsy();
  });
});
