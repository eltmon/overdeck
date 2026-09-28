/**
 * PAN-4268: the single conversation read carries inputTarget only when the
 * read-model helper returned a value.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

const TEST_HOME = mkdtempSync(join(tmpdir(), 'pan-4268-conv-read-'));
process.env.OVERDECK_HOME = TEST_HOME;

const readInputTarget = vi.hoisted(() => vi.fn());
vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));
vi.mock('../conversation-input-target.js', () => ({ readConversationInputTarget: readInputTarget }));

const { createConversation } = await import('../conversations.js');
const { closeOverdeckDatabase } = await import('../infra.js');
const { getConversationRead } = await import('../conversation-reads.js');

const deps = { resolveSessionFile: async () => null, tmuxSessionExists: async () => false };

afterAll(() => {
  closeOverdeckDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('getConversationRead inputTarget', () => {
  it('includes inputTarget when the helper answers and omits it otherwise', async () => {
    createConversation({ name: 'read-target', tmuxSession: 'conv-read-target', cwd: TEST_HOME, title: 'read-target' });

    readInputTarget.mockResolvedValueOnce({ subagent: 'Counter run' });
    const withTarget = (await getConversationRead('read-target', deps)).body as Record<string, unknown>;
    expect(withTarget.inputTarget).toEqual({ subagent: 'Counter run' });

    readInputTarget.mockResolvedValueOnce(undefined);
    const withoutTarget = (await getConversationRead('read-target', deps)).body as Record<string, unknown>;
    expect(withoutTarget).not.toHaveProperty('inputTarget');
    expect(readInputTarget).toHaveBeenCalledWith(expect.objectContaining({ tmuxSession: 'conv-read-target' }), false, null);
  });
});
