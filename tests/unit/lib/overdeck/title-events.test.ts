import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-title-events-test-'));
  process.env.OVERDECK_HOME = testHome;
});

afterEach(async () => {
  const { closeOverdeckDatabaseSync } = await import('../../../../src/lib/overdeck/infra.js');
  closeOverdeckDatabaseSync();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('updateConversationTitle event emission', () => {
  it('emits conversation.title_changed when the event store is initialized', async () => {
    const emitted: unknown[] = [];
    vi.doMock('../../../../src/dashboard/server/event-store.js', () => ({
      getEventStore: () => ({
        emitOnly: (event: unknown) => {
          emitted.push(event);
        },
      }),
    }));

    const { createConversation, getConversationByName, updateConversationTitle } = await import(
      '../../../../src/lib/overdeck/conversations.js'
    );

    createConversation({ name: 'evented', tmuxSession: 'conv-evented', cwd: '/tmp' });
    updateConversationTitle('evented', 'New title', 'auto');

    expect(getConversationByName('evented')?.title).toBe('New title');
    expect(getConversationByName('evented')?.titleSource).toBe('auto');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: 'conversation.title_changed',
      payload: { conversationName: 'evented', title: 'New title', titleSource: 'auto' },
    });

    vi.doUnmock('../../../../src/dashboard/server/event-store.js');
  });

  it('persists the title without throwing when the event store is uninitialized', async () => {
    vi.doMock('../../../../src/dashboard/server/event-store.js', () => ({
      getEventStore: () => {
        throw new Error('[event-store] getEventStore() called before initEventStore() resolved.');
      },
    }));

    const { createConversation, getConversationByName, updateConversationTitle } = await import(
      '../../../../src/lib/overdeck/conversations.js'
    );

    createConversation({ name: 'no-event-store', tmuxSession: 'conv-no-event-store', cwd: '/tmp' });
    expect(() => updateConversationTitle('no-event-store', 'Fallback title', 'manual')).not.toThrow();
    expect(getConversationByName('no-event-store')?.title).toBe('Fallback title');
    expect(getConversationByName('no-event-store')?.titleSource).toBe('manual');

    vi.doUnmock('../../../../src/dashboard/server/event-store.js');
  });
});
