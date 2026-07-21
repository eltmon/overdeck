import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  NO_ISSUE_BUCKETS,
  classifySessionBucket,
  type ConversationSessionLookup,
} from '../attribution.js';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../tests/helpers/overdeck-test-db.js';
import { findConversationForCostSessionSync } from '../../overdeck/conversations.js';

describe('classifySessionBucket', () => {
  it('returns FLYWHEEL for the flywheel-orchestrator conversation', () => {
    const lookup: ConversationSessionLookup = () => ({ name: 'flywheel-orchestrator' });

    expect(classifySessionBucket({ sessionId: 'session-1' }, lookup)).toBe(NO_ISSUE_BUCKETS.flywheel);
  });

  it('returns CONVERSATIONS for any other matched conversation', () => {
    const lookup: ConversationSessionLookup = () => ({ name: 'launch-video' });

    expect(classifySessionBucket({ agentId: 'conv-launch-video' }, lookup)).toBe(NO_ISSUE_BUCKETS.conversations);
  });

  it('returns UNATTRIBUTED when no conversation matches and never returns UNKNOWN', () => {
    const lookup: ConversationSessionLookup = () => null;
    const bucket = classifySessionBucket({ sessionId: 'missing-session' }, lookup);

    expect(bucket).toBe(NO_ISSUE_BUCKETS.unattributed);
    expect(bucket).not.toBe('UNKNOWN');
  });
});

describe('findConversationForCostSessionSync', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => {
    odb = setupOverdeckTestDb();
  });

  afterEach(() => {
    teardownOverdeckTestDb(odb);
  });

  it('returns the conversation name for a conversation_files locator match', () => {
    seedConversation(odb, {
      id: 'conv-uuid-1',
      name: 'launch-video',
      tmuxSession: 'conv-launch-video',
      locator: 'session-123',
    });

    expect(findConversationForCostSessionSync({ sessionId: 'session-123' })).toEqual({ name: 'launch-video' });
    expect(findConversationForCostSessionSync({ sessionId: 'missing' })).toBeNull();
  });

  it('returns the conversation name for a conv-* agentId tmux_session match', () => {
    seedConversation(odb, {
      id: 'conv-uuid-2',
      name: 'operator-chat',
      tmuxSession: 'conv-operator-chat',
      locator: 'session-456',
    });

    expect(findConversationForCostSessionSync({ agentId: 'conv-operator-chat' })).toEqual({ name: 'operator-chat' });
    expect(findConversationForCostSessionSync({ agentId: 'agent-pan-2387' })).toBeNull();
  });
});

function seedConversation(
  odb: OverdeckTestDb,
  input: { id: string; name: string; tmuxSession: string; locator: string },
): void {
  const now = Date.parse('2026-07-06T00:00:00.000Z');
  odb.raw()
    .prepare(
      `INSERT INTO conversations (id, name, tmux_session, status, cwd, created_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    )
    .run(input.id, input.name, input.tmuxSession, '/home/eltmon/project', now);
  odb.raw()
    .prepare(
      `INSERT INTO conversation_files (conversation_id, harness, locator, created_at)
       VALUES (?, 'codex', ?, ?)`,
    )
    .run(input.id, input.locator, now);
}
