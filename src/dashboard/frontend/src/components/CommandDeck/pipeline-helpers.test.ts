import { describe, expect, it } from 'vitest';
import type { SessionNode } from '@overdeck/contracts';
import { sessionRoleLabel, whoLineFor, type BucketedFeature } from './pipeline-helpers';

function session(overrides: Partial<SessionNode>): SessionNode {
  return {
    type: 'knowledge',
    sessionId: 'agent-pan-2468-knowledge',
    model: 'claude-opus-4-7',
    startedAt: '2026-07-07T00:00:00.000Z',
    duration: 60,
    status: 'running',
    presence: 'active',
    ...overrides,
  } as SessionNode;
}

function entry(sessions: SessionNode[]): BucketedFeature {
  return {
    feature: {
      issueId: 'PAN-2468',
      title: 'Knowledge role',
      stateLabel: 'In Progress',
      sessions,
    },
    reviewStatus: undefined,
    phase: 'work',
  } as BucketedFeature;
}

describe('Command Deck pipeline helpers', () => {
  it('renders a distinct label for knowledge role sessions', () => {
    expect(sessionRoleLabel('knowledge')).toBe('knowledge agent');
  });

  it('includes knowledge agents in the active session summary without making them a phase', () => {
    expect(whoLineFor(entry([session({})]))).toBe('opus-4-7 knowledge agent · active now');
  });
});
