/** PAN-5091, PAN-5673: deliberate conversation stops, stored on the conversation row. */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testHome: string;

async function freshModules() {
  const infra = await import('../infra.js');
  const conversations = await import('../conversations.js');
  const marks = await import('../conversation-stop-marks.js');
  return { infra, conversations, marks };
}

function cwd(): string {
  const dir = join(testHome, 'projects', 'fixture');
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(async () => {
  vi.resetModules();
  testHome = join(tmpdir(), `pan-5673-stop-marks-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('conversation stop marks', () => {
  it('the conversations table has the stopped_on_purpose_at column', async () => {
    const { infra } = await freshModules();
    const columns = infra.getOverdeckDatabase()
      .prepare('PRAGMA table_info(conversations)')
      .all<{ name: string }>()
      .map((c) => c.name);
    expect(columns).toContain('stopped_on_purpose_at');
  });

  it('answers true only for a stop at or after the given time', async () => {
    const { conversations, marks } = await freshModules();
    conversations.createConversation({ name: 'a', tmuxSession: 'conv-a', cwd: cwd(), harness: 'claude-code' });
    marks.recordConversationStop('a', 1_000);
    expect(marks.conversationStoppedSince('a', 1_000)).toBe(true);
    expect(marks.conversationStoppedSince('a', 500)).toBe(true);
    expect(marks.conversationStoppedSince('a', 1_001)).toBe(false);
    expect(marks.conversationStoppedSince('b', 0)).toBe(false);
  });

  it('a later stop replaces an earlier one', async () => {
    const { conversations, marks } = await freshModules();
    conversations.createConversation({ name: 'a', tmuxSession: 'conv-a', cwd: cwd(), harness: 'claude-code' });
    marks.recordConversationStop('a', 1_000);
    marks.recordConversationStop('a', 5_000);
    expect(marks.conversationStoppedSince('a', 4_000)).toBe(true);
  });

  it('a stop of an unknown conversation records nothing and does not throw', async () => {
    const { marks } = await freshModules();
    marks.recordConversationStop('missing', 1_000);
    expect(marks.conversationStoppedSince('missing', 0)).toBe(false);
  });

  it('survives a dashboard restart (fresh module state, reopened database)', async () => {
    const first = await freshModules();
    first.conversations.createConversation({ name: 'conv-flywheel', tmuxSession: 'conv-flywheel', cwd: cwd(), harness: 'claude-code' });
    first.marks.recordConversationStop('conv-flywheel', 2_000);
    first.infra.closeOverdeckDatabase();

    vi.resetModules();
    const second = await freshModules();
    expect(second.marks.conversationStoppedSince('conv-flywheel', 1_000)).toBe(true);
    expect(second.marks.conversationStoppedSince('conv-flywheel', 3_000)).toBe(false);
  });

  it('clearConversationStop forgets the stop', async () => {
    const { conversations, marks } = await freshModules();
    conversations.createConversation({ name: 'a', tmuxSession: 'conv-a', cwd: cwd(), harness: 'claude-code' });
    marks.recordConversationStop('a', 1_000);
    marks.clearConversationStop('a');
    expect(marks.conversationStoppedSince('a', 0)).toBe(false);
  });

  it('starting a new conversation under the same name starts clear', async () => {
    const { conversations, marks } = await freshModules();
    conversations.createConversation({ name: 'a', tmuxSession: 'conv-a', cwd: cwd(), harness: 'claude-code' });
    marks.recordConversationStop('a', 1_000);
    conversations.createConversation({ name: 'a', tmuxSession: 'conv-a', cwd: cwd(), harness: 'claude-code' });
    expect(marks.conversationStoppedSince('a', 0)).toBe(false);
  });

  it('reactivating a row for a new spawn clears the stop', async () => {
    const { conversations, marks } = await freshModules();
    conversations.createConversation({ name: 'a', tmuxSession: 'conv-a', cwd: cwd(), harness: 'claude-code' });
    marks.recordConversationStop('a', 1_000);
    conversations.reactivateConversationForSpawn({ name: 'a', tmuxSession: 'conv-a', cwd: cwd() });
    expect(marks.conversationStoppedSince('a', 0)).toBe(false);
  });

  it('liveness observations do not clear the stop', async () => {
    const { conversations, marks } = await freshModules();
    conversations.createConversation({ name: 'a', tmuxSession: 'conv-a', cwd: cwd(), harness: 'claude-code' });
    marks.recordConversationStop('a', 1_000);
    conversations.markConversationEnded('a');
    conversations.markConversationRunning('a');
    conversations.markConversationActive('a');
    expect(marks.conversationStoppedSince('a', 0)).toBe(true);
  });
});
