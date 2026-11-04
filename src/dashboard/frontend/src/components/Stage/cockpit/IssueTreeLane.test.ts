import { describe, expect, it } from 'vitest';
import type { BackendPane } from '../../../types';

import { paneToSession } from './IssueTreeLane';

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
});
