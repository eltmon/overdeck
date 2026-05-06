import { describe, expect, it } from 'vitest';

import {
  compareSessionTreeSessionIds,
  getSessionTreeWorkspacePath,
  getSlotWorkSessionNumber,
} from '../routes/projects';
import { extractIssueIdFromSession } from '../ws-rpc';

describe('swarm slot session mapping', () => {
  it('extracts the slot number only for matching swarm work sessions', () => {
    expect(getSlotWorkSessionNumber('agent-pan-969-2', 'pan-969')).toBe(2);
    expect(getSlotWorkSessionNumber('agent-pan-969', 'pan-969')).toBeNull();
    expect(getSlotWorkSessionNumber('agent-pan-970-2', 'pan-969')).toBeNull();
  });

  it('derives slot workspace paths from slot session ids', () => {
    expect(
      getSessionTreeWorkspacePath(
        'pan-969',
        '/repo/workspaces/feature-pan-969',
        '/repo',
        'agent-pan-969-2',
      ),
    ).toBe('/repo/workspaces/feature-pan-969-slot-2');

    expect(
      getSessionTreeWorkspacePath(
        'pan-969',
        '/repo/workspaces/feature-pan-969',
        '/repo',
        'agent-pan-969',
      ),
    ).toBe('/repo/workspaces/feature-pan-969');
  });

  it('orders planning, base work, then slot sessions', () => {
    const sessions = [
      'agent-pan-969-2',
      'agent-pan-969',
      'planning-pan-969',
      'agent-pan-969-1',
    ];

    expect(
      [...sessions].sort((a, b) => compareSessionTreeSessionIds(a, b, 'pan-969')),
    ).toEqual([
      'planning-pan-969',
      'agent-pan-969',
      'agent-pan-969-1',
      'agent-pan-969-2',
    ]);
  });

  it('maps swarm slot tmux sessions back to the parent issue id', () => {
    expect(extractIssueIdFromSession('agent-pan-969-2')).toBe('PAN-969');
    expect(extractIssueIdFromSession('planning-pan-969')).toBe('PAN-969');
    expect(extractIssueIdFromSession('review-PAN-969-1746555555')).toBe('PAN-969');
    expect(extractIssueIdFromSession('unknown-session')).toBeNull();
  });
});
