import { describe, expect, it, vi } from 'vitest';
import type { BackendPane } from '@overdeck/contracts';

vi.mock('../../../../../src/lib/agents.js', () => ({
  getAgentDir: vi.fn(),
  getAgentState: vi.fn(() => null),
}));

vi.mock('../../../../../src/dashboard/server/routes/jsonl-resolver.js', () => ({
  resolveJsonlPath: vi.fn(async () => null),
}));

vi.mock('../../../../../src/dashboard/server/routes/reviewer-tree.js', () => ({
  buildReviewerNodes: vi.fn(async () => []),
  readSynthesisRounds: vi.fn(async () => []),
}));

vi.mock('../../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

import { buildSpecialistSessionNodes } from '../../../../../src/dashboard/server/routes/session-tree-specialists.js';

function pane(overrides: Partial<BackendPane> = {}): BackendPane {
  return {
    id: 'w1:p1',
    role: 'review',
    harness: 'claude-code',
    model: 'claude-sonnet-5',
    state: 'working',
    ...overrides,
  };
}

describe('buildSpecialistSessionNodes', () => {
  it('reads a done review pane as presence idle (PAN-5011, was active)', async () => {
    const sections = await buildSpecialistSessionNodes({
      issueId: 'PAN-5011',
      fallbackProjectKey: 'overdeck',
      workspacePath: '/tmp/overdeck/workspaces/feature-pan-5011',
      projectPath: '/tmp/overdeck',
      tmuxSessionNames: new Set(),
      derived: null,
      panes: [pane({ role: 'review', state: 'done' })],
    });

    const review = sections.find((s) => s.type === 'review');
    expect(review?.presence).toBe('idle');
  });

  it('reads a working test pane as presence active', async () => {
    const sections = await buildSpecialistSessionNodes({
      issueId: 'PAN-5011',
      fallbackProjectKey: 'overdeck',
      workspacePath: '/tmp/overdeck/workspaces/feature-pan-5011',
      projectPath: '/tmp/overdeck',
      tmuxSessionNames: new Set(),
      derived: null,
      panes: [pane({ role: 'test', state: 'working' })],
    });

    const test = sections.find((s) => s.type === 'test');
    expect(test?.presence).toBe('active');
  });
});
