/**
 * Conversation search indexes every transcript under ~/.claude/projects/, but
 * only a minority of them are dashboard conversations — the rest are work-agent
 * and plain terminal sessions with no conversations-table row. Opening such a
 * palette hit used to 404 on both read paths; these lock the by-id fallback that
 * serves the transcript instead.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    default: actual,
    homedir: () => process.env['OVERDECK_TEST_FAKE_HOMEDIR'] ?? actual.homedir(),
  };
});

import {
  getConversationMessageLocator,
  getConversationMessagesRead,
} from '../../../../src/lib/overdeck/conversation-reads.js';

const SESSION_ID = '3f2b1a4c-5d6e-4f70-8a91-b2c3d4e5f607';

let fakeHome: string;
let sessionFile: string;

/** Fails the test if the registered-conversation path is taken instead. */
const deps = {
  resolveSessionFile: async () => {
    throw new Error('resolveSessionFile must not be called for an unregistered session');
  },
  shouldReportUnresolvedLiveSession: () => false,
};

function jsonlLine(uuid: string, text: string): string {
  return `${JSON.stringify({
    type: 'user',
    uuid,
    timestamp: '2026-07-28T06:30:59.690Z',
    message: { role: 'user', content: [{ type: 'text', text }] },
  })}\n`;
}

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'overdeck-unregistered-session-'));
  process.env['OVERDECK_TEST_FAKE_HOMEDIR'] = fakeHome;
  const projectDir = join(fakeHome, '.claude', 'projects', '-home-user-scratch');
  await mkdir(projectDir, { recursive: true });
  sessionFile = join(projectDir, `${SESSION_ID}.jsonl`);
  await writeFile(sessionFile, jsonlLine('u-1', 'first message') + jsonlLine('u-2', 'second message'));
});

afterEach(async () => {
  delete process.env['OVERDECK_TEST_FAKE_HOMEDIR'];
  await rm(fakeHome, { recursive: true, force: true });
});

describe('reads for an indexed Claude session with no conversation row', () => {
  it('locates a message by byte offset instead of 404ing', async () => {
    const secondLineOffset = jsonlLine('u-1', 'first message').length;

    const response = await getConversationMessageLocator(SESSION_ID, secondLineOffset, deps);

    expect(response.status).toBeUndefined();
    expect(response.body).toMatchObject({ messageIndex: 1, byteOffset: secondLineOffset });
  });

  it('serves the transcript messages', async () => {
    const response = await getConversationMessagesRead(SESSION_ID, deps);

    expect(response.status).toBeUndefined();
    const body = response.body as { messages: Array<{ text: string }> };
    expect(body.messages.map((message) => message.text)).toEqual(['first message', 'second message']);
  });

  it('still 404s a session id with no transcript anywhere', async () => {
    const missing = '00000000-1111-4222-8333-444444444444';

    expect(await getConversationMessageLocator(missing, 0, deps)).toMatchObject({ status: 404 });
    expect(await getConversationMessagesRead(missing, deps)).toMatchObject({ status: 404 });
  });

  it('does not sweep for names that are not Claude session ids', async () => {
    const response = await getConversationMessagesRead('not-a-session-id', deps);

    expect(response).toMatchObject({ status: 404 });
  });
});
