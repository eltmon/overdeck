import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfluenceData } from '../useConfluenceData';

const mocks = vi.hoisted(() => ({
  emitRing: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: [
      {
        id: 'event-issue',
        issueId: 'PAN-3447',
        timestamp: '2026-08-02T12:34:56.000Z',
        source: 'review',
        level: 'success',
        message: 'Full issue event message without truncation',
      },
      {
        id: 'event-system',
        timestamp: '2026-08-02T12:35:56.000Z',
        source: 'system',
        level: 'info',
        message: 'Issue-less system heartbeat',
      },
    ],
  }),
}));

vi.mock('../../../../lib/store', () => {
  const state = { recentActivity: [], observationsByIssueId: {}, agentsById: {} };
  return {
    selectAgents: (value: typeof state) => Object.values(value.agentsById),
    useDashboardStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

vi.mock('../../Sidebar', () => ({
  GodViewSidebar: ({
    onIssueHover,
    onIssueSelect,
  }: {
    onIssueHover?: (issueId: string) => void;
    onIssueSelect?: (issueId: string) => void;
  }) => (
    <aside>
      <button type="button" onMouseEnter={() => onIssueHover?.('PAN-3447')}>Hover feed issue</button>
      <button type="button" onClick={() => onIssueSelect?.('PAN-3447')}>Select feed issue</button>
    </aside>
  ),
}));

vi.mock('../useConfluenceChoreography', () => ({ useConfluenceChoreography: vi.fn(), useSweepChoreography: vi.fn() }));

vi.mock('../RiverCanvas', async () => {
  const React = await import('react');
  return {
    RiverCanvas: React.forwardRef(function RiverCanvasMock(_props, ref) {
      React.useImperativeHandle(ref, () => ({
        emitSparks: vi.fn(),
        emitRing: mocks.emitRing,
        emitTicker: vi.fn(),
        playTide: vi.fn(),
        playMerge: vi.fn(),
        playThaw: vi.fn(),
        playSweep: vi.fn(),
        playFlare: vi.fn(),
        pulseSun: vi.fn(),
        spawnFromSun: vi.fn(),
        gateFlash: vi.fn(),
        resize: vi.fn(),
      }));
      return <div aria-label="River canvas" />;
    }),
  };
});

import { ActivityFeed } from '../../ActivityFeed';
import { GodViewConfluence } from '../GodViewConfluence';

const data = {
  orbs: [{
    id: 'PAN-3447',
    project: 'overdeck',
    role: 'work',
    stage: 'WORK',
    title: 'God View Confluence',
    state: 'active',
    labels: [],
    staleMin: 0,
    yieldReason: null,
    warn: null,
    broken: false,
  }],
  hookStream: {
    entries: [],
    eventTimes: [],
    eventsPerMin: 0,
    eventsPerSec: 0,
    specRates: {},
    energy: 0,
    microStatesByAgentId: {},
    costEvents: [],
  },
  meta: {
    conversations: 0,
    mergeQ: 0,
    roleCounts: {},
  },
} as unknown as ConfluenceData;

describe('Confluence feed and orb linking', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.emitRing.mockClear();
    window.history.replaceState({}, '', '/god-view');
  });

  it('shows complete event provenance and emits the issue hover callback', () => {
    const onIssueHover = vi.fn();
    const { container } = render(
      <ActivityFeed onIssueHover={onIssueHover} onIssueSelect={vi.fn()} />,
    );
    const issueRow = container.querySelector('[data-issue="PAN-3447"]');
    expect(issueRow).not.toBeNull();

    fireEvent.mouseEnter(issueRow!);

    expect(onIssueHover).toHaveBeenCalledWith('PAN-3447');
    const tooltip = screen.getByRole('tooltip', { name: 'PAN-3447 activity details' });
    expect(within(tooltip).getByText('PAN-3447')).toBeInTheDocument();
    expect(within(tooltip).getByText('review')).toBeInTheDocument();
    expect(within(tooltip).getByText('Full issue event message without truncation')).toBeInTheDocument();
    expect(tooltip.querySelector('time')).toHaveAttribute('dateTime', '2026-08-02T12:34:56.000Z');

    fireEvent.mouseLeave(issueRow!);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('selects only issue-linked rows', () => {
    const onIssueSelect = vi.fn();
    const { container } = render(
      <ActivityFeed onIssueHover={vi.fn()} onIssueSelect={onIssueSelect} />,
    );

    fireEvent.click(container.querySelector('[data-issue="PAN-3447"]')!);
    expect(onIssueSelect).toHaveBeenCalledWith('PAN-3447');

    fireEvent.click(container.querySelector('[data-issue=""]')!);
    expect(onIssueSelect).toHaveBeenCalledTimes(1);
  });

  it('flashes the matching orb white and opens the in-canvas issue rail', () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    render(
      <GodViewConfluence
        data={data}
        helpOpen={false}
        onHelpOpenChange={vi.fn()}
        onToggleFullscreen={vi.fn()}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Hover feed issue' }));
    expect(mocks.emitRing).toHaveBeenCalledWith('PAN-3447', '#ffffff');

    fireEvent.click(screen.getByRole('button', { name: 'Select feed issue' }));
    expect(screen.getByLabelText('Issue rail for PAN-3447')).toBeInTheDocument();
    expect(pushState).not.toHaveBeenCalled();
  });
});
