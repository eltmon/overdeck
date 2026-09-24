/**
 * Conversation search indexes every transcript under ~/.claude/projects/, but
 * only a minority of them are dashboard conversations. Opening a palette hit on
 * one of the rest must serve the transcript read-only through an exact-UUID
 * lookup (PAN-3982 restores the 5d9ed79423 fallback that PAN-3950 dropped),
 * while `agent-*` and other non-UUID names still never trigger a sweep.
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

/** Fails the test if the registered-conversation path is taken instead. */
const deps = {
  resolveSessionFile: vi.fn(async (): Promise<string | null> => {
    throw new Error('resolveSessionFile must not be called for an unregistered session');
  }),
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
  deps.resolveSessionFile.mockClear();
  fakeHome = await mkdtemp(join(tmpdir(), 'overdeck-unregistered-session-'));
  process.env['OVERDECK_TEST_FAKE_HOMEDIR'] = fakeHome;
  const projectDir = join(fakeHome, '.claude', 'projects', '-home-user-scratch');
  const subagentsDir = join(projectDir, SESSION_ID, 'subagents');
  await mkdir(subagentsDir, { recursive: true });
  await writeFile(
    join(projectDir, `${SESSION_ID}.jsonl`),
    jsonlLine('u-1', 'first message') + jsonlLine('u-2', 'second message'),
  );
  await writeFile(
    join(subagentsDir, 'agent-cafe01.jsonl'),
    jsonlLine('s-1', 'subagent first') + jsonlLine('s-2', 'subagent second'),
  );
});

afterEach(async () => {
  delete process.env['OVERDECK_TEST_FAKE_HOMEDIR'];
  await rm(fakeHome, { recursive: true, force: true });
});

describe('reads for an indexed Claude session with no conversation row', () => {
  it('serves the transcript messages for an unregistered session UUID', async () => {
    const response = await getConversationMessagesRead(SESSION_ID, deps);

    expect(response.status).toBeUndefined();
    const body = response.body as { messages: Array<{ text: string }> };
    expect(body.messages.map((message) => message.text)).toEqual(['first message', 'second message']);
    expect(deps.resolveSessionFile).not.toHaveBeenCalled();
  });

  it('locates a message by byte offset for an unregistered session UUID', async () => {
    const secondLineOffset = jsonlLine('u-1', 'first message').length;

    const response = await getConversationMessageLocator(SESSION_ID, secondLineOffset, deps);

    expect(response.status).toBeUndefined();
    expect(response.body).toMatchObject({ messageIndex: 1, byteOffset: secondLineOffset });
  });

  it('still 404s a UUID with no transcript anywhere', async () => {
    const missing = '00000000-1111-4222-8333-444444444444';

    await expect(getConversationMessagesRead(missing, deps)).resolves.toEqual({
      status: 404,
      body: { error: 'Conversation not found', lookedUp: missing },
    });
    await expect(getConversationMessageLocator(missing, 0, deps)).resolves.toEqual({
      status: 404,
      body: { error: 'Conversation not found', lookedUp: missing },
    });
  });

  it('never sweeps for agent-* or non-UUID names', async () => {
    for (const name of ['agent-pan-3950', 'agent-a8256731048d42b38', 'not-a-session-id']) {
      await expect(getConversationMessagesRead(name, deps)).resolves.toEqual({
        status: 404,
        body: { error: 'Conversation not found', lookedUp: name },
      });
      await expect(getConversationMessageLocator(name, 0, deps)).resolves.toEqual({
        status: 404,
        body: { error: 'Conversation not found', lookedUp: name },
      });
    }
    expect(deps.resolveSessionFile).not.toHaveBeenCalled();
  });
});

describe('message locator for a subagent transcript', () => {
  it('locates a subagent message by byte offset', async () => {
    const secondLineOffset = jsonlLine('s-1', 'subagent first').length;

    const response = await getConversationMessageLocator(SESSION_ID, secondLineOffset, deps, 'cafe01');

    expect(response.status).toBeUndefined();
    expect(response.body).toMatchObject({ messageIndex: 1, byteOffset: secondLineOffset });
  });

  it('rejects an unsafe subagent id', async () => {
    await expect(getConversationMessageLocator(SESSION_ID, 0, deps, '../x')).resolves.toEqual({
      status: 400,
      body: { error: 'Invalid subagent id' },
    });
  });

  it('404s with lookedUp when the parent transcript is missing', async () => {
    const missing = '00000000-1111-4222-8333-555555555555';

    const response = await getConversationMessageLocator(missing, 0, deps, 'cafe01');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ lookedUp: missing });
  });
});
