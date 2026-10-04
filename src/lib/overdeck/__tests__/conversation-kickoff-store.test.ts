/** PAN-4499 WI-3: the held-kickoff store is atomic claim-once storage. */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let testHome: string;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-4499-kickoff-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('conversation kickoff store', () => {
  it('holds and reads a kickoff', async () => {
    const { createConversation } = await import('../conversations.js');
    const { holdKickoff, readHeldKickoff } = await import('../conversation-kickoff-store.js');
    createConversation({ name: 'conv-a', tmuxSession: 'conv-a', cwd: testHome, harness: 'claude-code' });
    expect(readHeldKickoff('conv-a')).toBeNull();
    holdKickoff('conv-a', 'do the thing');
    expect(readHeldKickoff('conv-a')).toBe('do the thing');
  });

  it('claim returns the text once and null the second time', async () => {
    const { createConversation } = await import('../conversations.js');
    const { holdKickoff, claimHeldKickoff } = await import('../conversation-kickoff-store.js');
    createConversation({ name: 'conv-b', tmuxSession: 'conv-b', cwd: testHome, harness: 'claude-code' });
    holdKickoff('conv-b', 'do the thing');
    expect(claimHeldKickoff('conv-b')).toBe('do the thing');
    expect(claimHeldKickoff('conv-b')).toBeNull();
  });

  it('claim on a never-held conversation returns null', async () => {
    const { createConversation } = await import('../conversations.js');
    const { claimHeldKickoff } = await import('../conversation-kickoff-store.js');
    createConversation({ name: 'conv-c', tmuxSession: 'conv-c', cwd: testHome, harness: 'claude-code' });
    expect(claimHeldKickoff('conv-c')).toBeNull();
  });

  it('restore puts the text back only when nothing is held', async () => {
    const { createConversation } = await import('../conversations.js');
    const { holdKickoff, readHeldKickoff, restoreHeldKickoff } = await import('../conversation-kickoff-store.js');
    createConversation({ name: 'conv-d', tmuxSession: 'conv-d', cwd: testHome, harness: 'claude-code' });
    restoreHeldKickoff('conv-d', 'restored text');
    expect(readHeldKickoff('conv-d')).toBe('restored text');

    restoreHeldKickoff('conv-d', 'should not overwrite');
    expect(readHeldKickoff('conv-d')).toBe('restored text');

    holdKickoff('conv-d', 'other text');
    restoreHeldKickoff('conv-d', 'ignored');
    expect(readHeldKickoff('conv-d')).toBe('other text');
  });
});
