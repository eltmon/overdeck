import { describe, expect, it } from 'vitest';
import type { BackendPane } from '../../../types';
import type { ActivitySection } from '../../CommandDeck/ZoneCOverviewTabs/queries';

import { cockpitSessions, paneToSession } from './IssueTreeLane';

function pane(overrides: Partial<BackendPane> = {}): BackendPane {
  return {
    id: 'w1:p1',
    role: 'work',
    harness: 'claude-code',
    model: 'claude-sonnet-5',
    state: 'done',
    ...overrides,
  } as BackendPane;
}

function section(overrides: Partial<ActivitySection> = {}): ActivitySection {
  return {
    type: 'work',
    sessionId: 'agent-pan-4841',
    model: 'claude-sonnet-5',
    startedAt: new Date(0).toISOString(),
    duration: null,
    status: 'running',
    ...overrides,
  };
}

describe('paneToSession', () => {
  it('reads a done work pane as status running, presence idle (PAN-5011)', () => {
    const session = paneToSession(pane({ state: 'done' }));
    expect(session).toMatchObject({ status: 'running', presence: 'idle' });
  });

  it('reads an unknown pane as presence idle', () => {
    const session = paneToSession(pane({ state: 'unknown' }));
    expect(session?.presence).toBe('idle');
  });

  it('reads an exited pane as status stopped, presence ended', () => {
    const session = paneToSession(pane({ state: 'exited' }));
    expect(session).toMatchObject({ status: 'stopped', presence: 'ended' });
  });

  it('returns null for a conversation-role pane', () => {
    const session = paneToSession(pane({ role: 'conversation' }));
    expect(session).toBeNull();
  });

  it('uses agentId as sessionId when present (PAN-5011)', () => {
    const session = paneToSession(pane({ id: 'w1JA:p3', agentId: 'agent-pan-4841' }));
    expect(session?.sessionId).toBe('agent-pan-4841');
  });

  it('falls back to pane.id as sessionId when agentId is absent', () => {
    const session = paneToSession(pane({ id: 'w1JA:p3', agentId: undefined }));
    expect(session?.sessionId).toBe('w1JA:p3');
  });
});

describe('cockpitSessions', () => {
  it('enriches a pane row with hasJsonl from the matching activity section', () => {
    const herdrPane = pane({ id: 'w1JA:p3', agentId: 'agent-pan-4841', role: 'work', state: 'done' });
    const sessions = cockpitSessions([herdrPane], [section({ sessionId: 'agent-pan-4841', hasJsonl: true })]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      type: 'work',
      sessionId: 'agent-pan-4841',
      hasJsonl: true,
      presence: 'idle',
    });
  });

  it('dedupes a restarted agent\'s exited pane against its live pane (CodeRabbit PAN-5011)', () => {
    const exited = pane({ id: 'w1JA:p1', agentId: 'agent-pan-4841', state: 'exited' });
    const live = pane({ id: 'w1JA:p2', agentId: 'agent-pan-4841', state: 'working' });
    const sessions = cockpitSessions([exited, live], []);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ sessionId: 'agent-pan-4841', presence: 'active' });
  });
});
