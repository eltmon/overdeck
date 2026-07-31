import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';

const drawerData = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock('../drawer/useDrawerData', () => ({
  useIssueData: () => drawerData.value,
}));

vi.mock('../../lib/store', () => ({
  useDashboardStore: (selector: (state: { drawer: { issueId: null } }) => unknown) => selector({ drawer: { issueId: null } }),
}));

import IssuePhaseRail from './IssuePhaseRail';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-31T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('IssuePhaseRail truthful sublabels', () => {
  it('renders done date and duration while advancing the live counter with fake timers', async () => {
    drawerData.value = {
      issue: { identifier: 'PAN-3356', hasPlan: true, hasTasks: true, state: 'in_progress' },
      agents: [
        {
          id: 'agent-pan-3356-plan', issueId: 'PAN-3356', role: 'plan', model: 'sonnet-5', runtime: 'claude-code',
          status: 'stopped', startedAt: '2026-07-31T09:00:00Z', lastActivity: '2026-07-31T10:00:00Z',
        },
        {
          id: 'agent-pan-3356', issueId: 'PAN-3356', role: 'work', model: 'sonnet-5', runtime: 'claude-code',
          status: 'running', startedAt: '2026-07-31T11:55:00Z',
        },
      ],
      reviewStatus: { issueId: 'PAN-3356', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false, updatedAt: '2026-07-31T11:00:00Z' },
      phaseTimeline: [
        { id: 'planned', state: 'done', when: '07/31' },
        { id: 'implemented', state: 'current', when: '—' },
      ],
    };

    const { container } = render(<IssuePhaseRail issueId="PAN-3356" />);
    const plan = container.querySelector('[data-phase="plan"]') as HTMLElement;
    const work = container.querySelector('[data-phase="work"]') as HTMLElement;

    expect(plan).toHaveTextContent('07/31 · 1h 0m');
    expect(work).toHaveTextContent('Live · 5m');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(work).toHaveTextContent('Live · 6m');
  });

  it('links an explicit no-suite skip reason and embeds compact merge progress in Ship', () => {
    drawerData.value = {
      issue: { identifier: 'PAN-3356', hasPlan: true, hasTasks: true, state: 'in_progress' },
      agents: [],
      reviewStatus: {
        issueId: 'PAN-3356', reviewStatus: 'passed', testStatus: 'skipped', mergeStatus: 'merging',
        mergeStep: 'rebasing', readyForMerge: false, updatedAt: '2026-07-31T11:00:00Z',
      },
      phaseTimeline: [],
    };

    const { container } = render(<IssuePhaseRail issueId="PAN-3356" />);
    const testStep = container.querySelector('[data-phase="test"]') as HTMLElement;
    const shipStep = container.querySelector('[data-phase="ship"]') as HTMLElement;

    expect(testStep).toHaveAttribute('data-skipped', 'true');
    expect(within(testStep).getByRole('link', { name: 'Skipped · no suite configured' })).toHaveAttribute(
      'href',
      'https://overdeck.ai/configuration/projects',
    );
    expect(shipStep.querySelector('[data-section="ship-progress-compact"]')).toBeInTheDocument();
    expect(screen.getByText('Rebase onto main')).toBeInTheDocument();
  });
});
