/**
 * PAN-2356 WI-20: POST /api/triggers { inbox: true } asks the directory for an inbox, stores its
 * handle and returns the URL once; any refusal leaves no trigger behind. A stub directory client.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectoryToMachineFrame, MachineToDirectoryFrame } from '@overdeck/contracts';

vi.mock('../../../../lib/overdeck/conversations.js', () => ({
  getConversationByName: (name: string) => (name === '20261101-0001' ? { name } : null),
  getConversationById: () => null,
}));

const { createTriggerFromBody } = await import('../triggers.js');
const { listTriggers } = await import('../../../../lib/triggers/store.js');
type Port = import('../../services/directory-inbox.js').InboxDirectoryPort;

const INBOX_URL = `https://connect.overdeck.ai/h/${'a'.repeat(64)}.${'b'.repeat(32)}`;
const originalHome = process.env.OVERDECK_HOME;
let home = '';

/** A directory that answers `inbox-create` with `answer`. */
function stubDirectory(answer: (requestId: string) => DirectoryToMachineFrame): Port & { sent: MachineToDirectoryFrame[] } {
  const handlers = new Map<string, Set<(frame: DirectoryToMachineFrame) => void>>();
  const sent: MachineToDirectoryFrame[] = [];
  return {
    sent,
    isOnline: () => true,
    send(frame) {
      sent.push(frame);
      if (frame.type === 'inbox-create') {
        const reply = answer(frame.requestId);
        queueMicrotask(() => {
          for (const handler of handlers.get(reply.type) ?? []) handler(reply);
        });
      }
      return true;
    },
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) handlers.set(type, (set = new Set()));
      set.add(handler as (frame: DirectoryToMachineFrame) => void);
      return () => set.delete(handler as (frame: DirectoryToMachineFrame) => void);
    },
  };
}

const body = { name: 'held', target: { kind: 'conversation', conversation: '20261101-0001' }, inbox: true };

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-2356-triggers-inbox-'));
  process.env.OVERDECK_HOME = home;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('POST /api/triggers with an inbox (PAN-2356 WI-20)', () => {
  it('stores the inbox handle and returns the inbox URL once', async () => {
    const directory = stubDirectory((requestId) => ({ type: 'inbox-created', requestId, inboxId: 'ib_0123456789abcdef', url: INBOX_URL }));
    const answer = await createTriggerFromBody(body, directory);
    expect(answer.status).toBe(201);
    expect(answer.json.inboxUrl).toBe(INBOX_URL);
    expect(String(answer.json.inboxUrl)).toMatch(/^https:\/\/connect\.overdeck\.ai\/h\//);
    const [stored] = await listTriggers();
    expect(stored?.inbox?.id).toBe('ib_0123456789abcdef');
    // The URL (with its secret) is never stored on the machine.
    expect(JSON.stringify(stored)).not.toContain('b'.repeat(32));
  });

  it('answers 409 and leaves no trigger when the plan has no inbox', async () => {
    const directory = stubDirectory((requestId) => ({ type: 'error', code: 'plan_required', message: 'the inbox needs the Anywhere plan', requestId }));
    const answer = await createTriggerFromBody(body, directory);
    expect(answer).toEqual({ status: 409, json: { error: 'the inbox needs the Anywhere plan' } });
    expect(await listTriggers()).toEqual([]);
  });

  it('answers 409 and leaves no trigger when signed out', async () => {
    const answer = await createTriggerFromBody(body, null);
    expect(answer.status).toBe(409);
    expect(String(answer.json.error)).toContain('pan account login');
    expect(await listTriggers()).toEqual([]);
  });

  it('creates a plain trigger without asking the directory', async () => {
    const directory = stubDirectory(() => {
      throw new Error('not asked');
    });
    const answer = await createTriggerFromBody({ ...body, inbox: false }, directory);
    expect(answer.status).toBe(201);
    expect(answer.json.inboxUrl).toBeNull();
    expect(directory.sent).toEqual([]);
  });
});
