import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  getConversationByName: vi.fn(),
}));

vi.mock('../../../../src/lib/overdeck/conversations.js', () => ({
  listConversations: vi.fn(() => []),
  getConversationByName: mocks.getConversationByName,
  createConversation: mocks.createConversation,
  markConversationEnded: vi.fn(),
  markConversationActive: vi.fn(),
  updateLastAttached: vi.fn(),
  setConversationModel: vi.fn(),
  setConversationHarness: vi.fn(),
  backfillConversationModel: vi.fn(),
  archiveConversation: vi.fn(),
  removeFavorite: vi.fn(),
  updateSpawnError: vi.fn(),
  hasOtherActiveConversationOnTmuxSession: vi.fn(() => false),
}));

vi.mock('../../../../src/lib/overdeck/conversation-release.js', () => ({
  conversationWriteRefusal: vi.fn(() => null),
}));

vi.mock('../../../../src/dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));

vi.mock('../../../../src/lib/harness-binary.js', () => ({
  prepareHarnessLaunch: vi.fn().mockRejectedValue(new Error('no launch in this test')),
}));

import { handleConversationCreate, handleConversationResume } from '../../../../src/lib/overdeck/conversation-runtime.js';

async function bodyOf(response: { body: unknown }): Promise<Record<string, unknown>> {
  const body = response.body as { body: string | Uint8Array };
  const text = typeof body.body === 'string' ? body.body : new TextDecoder().decode(body.body);
  return JSON.parse(text) as Record<string, unknown>;
}

describe('conversation doors refuse while a shutdown drains (PAN-5342 WI-1)', () => {
  let previousHome: string | undefined;
  let home: string;

  beforeEach(() => {
    vi.clearAllMocks();
    previousHome = process.env.OVERDECK_HOME;
    home = mkdtempSync(join(tmpdir(), 'pan-5342-conv-refusal-'));
    process.env.OVERDECK_HOME = home;
    writeFileSync(join(home, 'shutdown.json'), '{}');
    mocks.getConversationByName.mockReturnValue({ id: 1, name: 'conv-a', status: 'ended' });
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('create answers 409 shutdown-draining and creates nothing', async () => {
    const response = await handleConversationCreate({ message: 'hello' }, { generateAiTitle: vi.fn() });
    expect(response.status).toBe(409);
    expect((await bodyOf(response)).code).toBe('shutdown-draining');
    expect(mocks.createConversation).not.toHaveBeenCalled();
  });

  it('resume answers 409 shutdown-draining', async () => {
    const response = await handleConversationResume('conv-a', {}, { resolveSessionFile: async () => null });
    expect(response.status).toBe(409);
    expect((await bodyOf(response)).code).toBe('shutdown-draining');
  });
});
