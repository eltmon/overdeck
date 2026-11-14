import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FlywheelInFlightRow } from '@overdeck/contracts';

import { FlywheelStatusPane, freshnessLabel } from '../FlywheelStatusPane';
import { formatDuration } from '../../../lib/flywheelApi';
import { NOW, flywheelStatus } from './fixtures';

describe('formatDuration (PAN-4199 WI-11)', () => {
  it.each([
    [0, '0m'],
    [42 * 60_000, '42m'],
    [2 * 3_600_000, '2h 0m'],
    [25 * 3_600_000, '1d 1h'],
    [-5_000, '0m'],
  ])('%d ms reads %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('FlywheelStatusPane (PAN-3964 FR-9)', () => {
  it('renders the last tick, its freshness, and no needs-you callout when null', () => {
    render(<FlywheelStatusPane status={flywheelStatus()} unreachable={false} nowMs={NOW} />);
    expect(screen.getByTestId('flywheel-last-tick')).toHaveTextContent('tick 3 · watch · PAN-3964');
    expect(screen.getByTestId('flywheel-freshness')).toHaveTextContent('live');
    expect(screen.getByTestId('flywheel-freshness')).toHaveAttribute('data-tone', 'info');
    expect(screen.queryByTestId('flywheel-needs-you')).toBeNull();
  });

  it('renders one row per needs-you item, in order, inside a div (PAN-5198)', () => {
    const status = flywheelStatus({
      lastTick: { tick: 4, pick: null, phase: 'park', inFlight: [], needsYou: 'waive PAN-5095 test removal; PR #7 merge; upload AAB', at: '2026-09-23T09:59:50.000Z' },
    });
    render(<FlywheelStatusPane status={status} unreachable={false} nowMs={NOW} />);
    expect(screen.getByTestId('flywheel-needs-you').tagName).toBe('DIV');
    const rows = screen.getAllByTestId('flywheel-needs-you-item');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('waive PAN-5095 test removal');
    expect(rows[1]).toHaveTextContent('PR #7 merge');
    expect(rows[2]).toHaveTextContent('upload AAB');
    expect(screen.queryAllByTestId('flywheel-needs-you-jump')).toHaveLength(0);
    for (const row of rows) {
      expect(row).not.toHaveAttribute('role');
      expect(row).not.toHaveAttribute('tabindex');
    }
  });

  it('an issue button navigates to the issue and does not jump (PAN-5217)', () => {
    const onNavigateIssue = vi.fn();
    const onNeedsYouClick = vi.fn();
    const status = flywheelStatus({
      lastTick: { tick: 4, pick: null, phase: 'park', inFlight: [], needsYou: 'waive PAN-5095 test removal', at: '2026-09-23T09:59:50.000Z' },
    });
    render(<FlywheelStatusPane status={status} unreachable={false} nowMs={NOW} onNavigateIssue={onNavigateIssue} onNeedsYouClick={onNeedsYouClick} />);
    fireEvent.click(screen.getByTestId('flywheel-needs-you-issue'));
    expect(onNavigateIssue).toHaveBeenCalledWith('PAN-5095');
    expect(onNeedsYouClick).not.toHaveBeenCalled();
  });

  it('links a PR item only when an in-flight row carries that PR number (PAN-5198)', () => {
    const status = flywheelStatus({
      lastTick: { tick: 4, pick: null, phase: 'park', inFlight: [], needsYou: 'PR #4001 merge; PR #7 merge', at: '2026-09-23T09:59:50.000Z' },
    });
    render(<FlywheelStatusPane status={status} unreachable={false} nowMs={NOW} />);
    const links = screen.getAllByTestId('flywheel-needs-you-pr');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://github.com/eltmon/overdeck/pull/4001');
  });

  it('jumps to the item\'s first-raised message when needsYouItems is present (PAN-5198)', () => {
    const onNeedsYouClick = vi.fn();
    const status = flywheelStatus({
      lastTick: {
        tick: 4, pick: null, phase: 'park', inFlight: [], needsYou: 'PR #7 merge', at: '2026-09-23T09:59:50.000Z', messageId: 'm9',
        needsYouItems: [{ text: 'PR #7 merge', firstRaisedTick: 2, firstRaisedAt: '2026-09-23T09:30:00.000Z', firstRaisedMessageId: 'm2' }],
      },
    });
    render(<FlywheelStatusPane status={status} unreachable={false} nowMs={NOW} onNeedsYouClick={onNeedsYouClick} />);
    fireEvent.click(screen.getByTestId('flywheel-needs-you-jump'));
    expect(onNeedsYouClick).toHaveBeenCalledWith('m2');
  });

  it('renders no jump button when the item has no first-raised id (PAN-5239)', () => {
    const onNeedsYouClick = vi.fn();
    const status = flywheelStatus({
      lastTick: { tick: 4, pick: null, phase: 'park', inFlight: [], needsYou: 'PR #7 merge', at: '2026-09-23T09:59:50.000Z', messageId: 'm9' },
    });
    render(<FlywheelStatusPane status={status} unreachable={false} nowMs={NOW} onNeedsYouClick={onNeedsYouClick} />);
    expect(screen.queryByTestId('flywheel-needs-you-jump')).toBeNull();
  });

  it('renders exactly one jump button, on the row with a first-raised id (PAN-5239)', () => {
    const onNeedsYouClick = vi.fn();
    const status = flywheelStatus({
      lastTick: {
        tick: 4, pick: null, phase: 'park', inFlight: [], needsYou: 'PR #7 merge; upload AAB', at: '2026-09-23T09:59:50.000Z', messageId: 'm9',
        needsYouItems: [
          { text: 'PR #7 merge', firstRaisedTick: 2, firstRaisedAt: '2026-09-23T09:30:00.000Z', firstRaisedMessageId: 'm2' },
          { text: 'upload AAB', firstRaisedTick: 3, firstRaisedAt: '2026-09-23T09:40:00.000Z' },
        ],
      },
    });
    render(<FlywheelStatusPane status={status} unreachable={false} nowMs={NOW} onNeedsYouClick={onNeedsYouClick} />);
    const rows = screen.getAllByTestId('flywheel-needs-you-item');
    expect(rows[0]!.querySelector('[data-testid="flywheel-needs-you-jump"]')).not.toBeNull();
    expect(rows[1]!.querySelector('[data-testid="flywheel-needs-you-jump"]')).toBeNull();
    fireEvent.click(screen.getByTestId('flywheel-needs-you-jump'));
    expect(onNeedsYouClick).toHaveBeenCalledWith('m2');
  });

  it('the jump button renders and does not throw without onNeedsYouClick (PAN-5217)', () => {
    const status = flywheelStatus({
      lastTick: {
        tick: 4, pick: null, phase: 'park', inFlight: [], needsYou: 'decide the PAN-3920 scope', at: '2026-09-23T09:59:50.000Z',
        needsYouItems: [{ text: 'decide the PAN-3920 scope', firstRaisedTick: 2, firstRaisedAt: '2026-09-23T09:30:00.000Z', firstRaisedMessageId: 'm2' }],
      },
    });
    render(<FlywheelStatusPane status={status} unreachable={false} nowMs={NOW} />);
    expect(screen.getByTestId('flywheel-needs-you-jump')).toBeInTheDocument();
    expect(() => fireEvent.click(screen.getByTestId('flywheel-needs-you-jump'))).not.toThrow();
  });

  it('no button-role element contains another button or link (PAN-5217, ACT 307n5z)', () => {
    const status = flywheelStatus({
      lastTick: { tick: 4, pick: null, phase: 'park', inFlight: [], needsYou: 'waive PAN-5095 test removal; PR #4001 merge', at: '2026-09-23T09:59:50.000Z' },
    });
    render(<FlywheelStatusPane status={status} unreachable={false} nowMs={NOW} />);
    // The fixture must actually render nested candidates, or the check is vacuous.
    expect(screen.getByTestId('flywheel-needs-you-issue')).toBeInTheDocument();
    expect(screen.getByTestId('flywheel-needs-you-pr')).toBeInTheDocument();
    for (const button of screen.getAllByRole('button')) {
      expect(button.querySelector('button, a, [role="button"], [role="link"]')).toBeNull();
    }
  });

  describe('Needs-you targets and link styling (PAN-5239)', () => {
    it('renders one link for an item with a target, and plain text for an item without one (ac1)', () => {
      const status = flywheelStatus({
        lastTick: { tick: 4, pick: null, phase: 'park', inFlight: [], needsYou: 'upload AAB <https://play.google.com/console/x>; store fields', at: '2026-09-23T09:59:50.000Z' },
      });
      render(<FlywheelStatusPane status={status} unreachable={false} nowMs={NOW} />);
      const rows = screen.getAllByTestId('flywheel-needs-you-item');
      const link = screen.getByTestId('flywheel-needs-you-link');
      expect(rows[0]).toContainElement(link);
      expect(link).toHaveAttribute('href', 'https://play.google.com/console/x');
      expect(link).toHaveTextContent('upload AAB');
      expect(link).toHaveAttribute('target', '_blank');
      expect(rows[1]).toHaveTextContent('store fields');
      expect(rows[1]!.querySelector('a')).toBeNull();
    });

    it('renders no anchor for a non-http(s) scheme in angle brackets (ac2)', () => {
      const status = flywheelStatus({
        lastTick: { tick: 4, pick: null, phase: 'park', inFlight: [], needsYou: 'run it <javascript:alert(1)>', at: '2026-09-23T09:59:50.000Z' },
      });
      render(<FlywheelStatusPane status={status} unreachable={false} nowMs={NOW} />);
      const row = screen.getByTestId('flywheel-needs-you-item');
      expect(row).toHaveTextContent('run it <javascript:alert(1)>');
      expect(screen.queryByTestId('flywheel-needs-you-link')).toBeNull();
    });

    it('links a qualified PR ref with its "PR " prefix in the link text (ac3)', () => {
      const status = flywheelStatus({
        lastTick: { tick: 4, pick: null, phase: 'park', inFlight: [], needsYou: 'PR eltmon/overdeck-landing#7 merge', at: '2026-09-23T09:59:50.000Z' },
      });
      render(<FlywheelStatusPane status={status} unreachable={false} nowMs={NOW} />);
      const link = screen.getByTestId('flywheel-needs-you-pr');
      expect(link).toHaveAttribute('href', 'https://github.com/eltmon/overdeck-landing/pull/7');
      expect(link).toHaveTextContent('PR eltmon/overdeck-landing#7');
    });

    it('gives issue, PR and item-target links the same link styling (ac4)', () => {
      const status = flywheelStatus({
        lastTick: {
          tick: 4, pick: null, phase: 'park', inFlight: [],
          needsYou: 'waive PAN-5095 test removal; eltmon/overdeck-landing#7 merge; upload AAB <https://a.test>',
          at: '2026-09-23T09:59:50.000Z',
        },
      });
      render(<FlywheelStatusPane status={status} unreachable={false} nowMs={NOW} />);
      for (const testId of ['flywheel-needs-you-issue', 'flywheel-needs-you-pr', 'flywheel-needs-you-link']) {
        const el = screen.getByTestId(testId);
        expect(el.className).toContain('underline');
        expect(el.className).toContain('cursor-pointer');
        expect(el.className).toContain('focus-visible:ring-2');
      }
    });

    it('does not segment a targeted item: one link, no issue button, nothing nested inside it (ac5)', () => {
      const status = flywheelStatus({
        lastTick: { tick: 4, pick: null, phase: 'park', inFlight: [], needsYou: 'waive PAN-5095 <https://a.test>', at: '2026-09-23T09:59:50.000Z' },
      });
      render(<FlywheelStatusPane status={status} unreachable={false} nowMs={NOW} />);
      expect(screen.getAllByTestId('flywheel-needs-you-link')).toHaveLength(1);
      expect(screen.queryByTestId('flywheel-needs-you-issue')).toBeNull();
      expect(screen.getByTestId('flywheel-needs-you-link').querySelector('a, button')).toBeNull();
    });
  });

  it('renders in-flight rows with state, attention, PR, and last journal; issue ids navigate', () => {
    const onNavigateIssue = vi.fn();
    render(<FlywheelStatusPane status={flywheelStatus()} unreachable={false} nowMs={NOW} onNavigateIssue={onNavigateIssue} />);
    const row = screen.getByTestId('flywheel-inflight-PAN-3964');
    expect(row).toHaveTextContent('in-review');
    expect(row).toHaveTextContent('needs-you');
    expect(row).toHaveTextContent('#4001 · review-requested · pending');
    expect(row).toHaveTextContent('review.dispatched · 5m ago');
    expect(screen.getByTestId('flywheel-inflight-PAN-3920')).toHaveTextContent('working');
    // The Live agents list also links PAN-3964, so scope to this row's button.
    fireEvent.click(row.querySelector('button')!);
    expect(onNavigateIssue).toHaveBeenCalledWith('PAN-3964');
  });

  describe('row title and tracker-unknown marker (PAN-4199 FR-3)', () => {
    /** One in-flight row, with everything but the fields under test defaulted. */
    function rowStatus(row: Partial<FlywheelInFlightRow>) {
      const base = flywheelStatus().inFlight[1]!;
      return flywheelStatus({ inFlight: [{ ...base, issueId: 'PAN-1', title: null, ...row }] });
    }

    it('renders the title with the full text as its tooltip (ac1)', () => {
      render(<FlywheelStatusPane status={rowStatus({ title: 'Fix the thing' })} unreachable={false} nowMs={NOW} />);
      const title = screen.getByTestId('flywheel-title-PAN-1');
      expect(title).toHaveTextContent('Fix the thing');
      expect(title).toHaveAttribute('title', 'Fix the thing');
    });

    it('marks a row no tracker answered for (ac2)', () => {
      render(<FlywheelStatusPane status={rowStatus({ trackerUnknown: true })} unreachable={false} nowMs={NOW} />);
      expect(screen.getByTestId('flywheel-tracker-unknown-PAN-1')).toHaveTextContent('tracker unknown');
    });

    it('renders neither marker for a titleless row the tracker knows (ac3)', () => {
      render(<FlywheelStatusPane status={rowStatus({})} unreachable={false} nowMs={NOW} />);
      expect(screen.queryByTestId('flywheel-title-PAN-1')).toBeNull();
      expect(screen.queryByTestId('flywheel-tracker-unknown-PAN-1')).toBeNull();
    });

    it('marks a row that folds a strike workspace onto its base issue (PAN-4752)', () => {
      render(<FlywheelStatusPane status={rowStatus({ strike: true })} unreachable={false} nowMs={NOW} />);
      expect(screen.getByTestId('flywheel-strike-PAN-1')).toHaveTextContent('strike');
    });

    it('renders no strike marker for a plain row (PAN-4752)', () => {
      render(<FlywheelStatusPane status={rowStatus({})} unreachable={false} nowMs={NOW} />);
      expect(screen.queryByTestId('flywheel-strike-PAN-1')).toBeNull();
    });
  });

  describe('no-agent and loop markers (PAN-4199 FR-5, FR-6)', () => {
    function rowsStatus(rows: Array<Partial<FlywheelInFlightRow>>, overrides: Partial<Parameters<typeof flywheelStatus>[0]> = {}) {
      const base = flywheelStatus().inFlight[1]!;
      return flywheelStatus({
        inFlight: rows.map((row, i) => ({ ...base, issueId: `PAN-${i + 1}`, state: 'working', ...row })),
        ...overrides,
      });
    }

    it('marks a working row with no live pane, and only that row (ac1)', () => {
      render(<FlywheelStatusPane status={rowsStatus([{ liveAgents: 0 }, { liveAgents: 1 }])} unreachable={false} nowMs={NOW} />);
      expect(screen.getByTestId('flywheel-no-agent-PAN-1')).toHaveTextContent('no agent');
      expect(screen.queryByTestId('flywheel-no-agent-PAN-2')).toBeNull();
    });

    it('leaves a non-working row alone however few agents it has', () => {
      render(<FlywheelStatusPane status={rowsStatus([{ state: 'in-review', liveAgents: 0 }])} unreachable={false} nowMs={NOW} />);
      expect(screen.queryByTestId('flywheel-no-agent-PAN-1')).toBeNull();
    });

    it('marks the rows the loop named in its tick (ac2)', () => {
      render(<FlywheelStatusPane status={rowsStatus([{ inTick: true }, { inTick: false }])} unreachable={false} nowMs={NOW} />);
      expect(screen.getByTestId('flywheel-in-tick-PAN-1')).toHaveTextContent('flywheel');
      expect(screen.queryByTestId('flywheel-in-tick-PAN-2')).toBeNull();
    });

    it('exposes each row\'s attention so the reveal can scroll to it', () => {
      render(<FlywheelStatusPane status={rowsStatus([{ attention: 'needs-you' }])} unreachable={false} nowMs={NOW} />);
      expect(screen.getByTestId('flywheel-inflight-PAN-1')).toHaveAttribute('data-attention', 'needs-you');
    });

    it('heads the section with the loop count or the census count', () => {
      const { unmount } = render(
        <FlywheelStatusPane status={rowsStatus([{ inTick: true }, { inTick: false }], { inFlightSource: 'tick' })} unreachable={false} nowMs={NOW} />,
      );
      expect(screen.getByRole('region', { name: 'In-flight issues' })).toHaveTextContent('1 in flight (loop)');
      unmount();

      render(<FlywheelStatusPane status={rowsStatus([{}, {}], { inFlightSource: 'census' })} unreachable={false} nowMs={NOW} />);
      expect(screen.getByRole('region', { name: 'In-flight issues' })).toHaveTextContent('2 feature workspaces');
    });
  });

  describe('live agents (PAN-4199 WI-14)', () => {
    const AGENTS = [
      { issueId: 'PAN-3964', role: 'work', harness: 'claude-code', model: 'claude-opus-5-5', state: 'working' },
      { issueId: 'PAN-3920', role: 'review', harness: 'codex', model: 'gpt-5.5', state: 'blocked' },
    ];

    it('lists every agent with its issue, role, model, and pane state (ac1)', () => {
      render(<FlywheelStatusPane status={flywheelStatus({ agents: AGENTS })} unreachable={false} nowMs={NOW} />);
      const section = screen.getByRole('region', { name: 'Live agents' });
      expect(section).toHaveTextContent('Agents · 2');
      for (const agent of AGENTS) {
        const row = screen.getByTestId(`flywheel-agent-${agent.issueId}-${agent.role}`);
        expect(row).toHaveTextContent(agent.issueId);
        expect(row).toHaveTextContent(agent.role);
        expect(row).toHaveTextContent(agent.model);
        expect(row).toHaveTextContent(agent.state);
      }
    });

    it('navigates to the issue from an agent row (ac2)', () => {
      const onNavigateIssue = vi.fn();
      render(
        <FlywheelStatusPane status={flywheelStatus({ agents: [AGENTS[1]!] })} unreachable={false} nowMs={NOW} onNavigateIssue={onNavigateIssue} />,
      );
      const row = screen.getByTestId('flywheel-agent-PAN-3920-review');
      fireEvent.click(row.querySelector('button')!);
      expect(onNavigateIssue).toHaveBeenCalledWith('PAN-3920');
    });

    it('says so plainly when no pane is live (ac3)', () => {
      render(<FlywheelStatusPane status={flywheelStatus({ agents: [] })} unreachable={false} nowMs={NOW} />);
      expect(screen.getByText('No agent panes are live for these issues.')).toBeInTheDocument();
    });
  });

  it.each([
    ['live', '2026-09-23T09:59:40.000Z', 'live', 'info'],
    ['breathing', '2026-09-23T09:50:00.000Z', 'last tick 10m ago', 'neutral'],
    ['stalled', '2026-09-23T09:00:00.000Z', 'stalled — last tick 60m ago', 'destructive'],
  ] as const)('freshness %s reads "%s"', (freshness, at, label, tone) => {
    expect(freshnessLabel(freshness, at, NOW)).toBe(label);
    const status = flywheelStatus({ freshness, lastTick: { ...flywheelStatus().lastTick!, at } });
    render(<FlywheelStatusPane status={status} unreachable={false} nowMs={NOW} />);
    expect(screen.getByTestId('flywheel-freshness')).toHaveTextContent(label);
    expect(screen.getByTestId('flywheel-freshness')).toHaveAttribute('data-tone', tone);
  });

  it('idle empty state points at the conversation pane toolbar, not a button below (PAN-4199 ac1, ac2)', () => {
    render(<FlywheelStatusPane status={flywheelStatus({ run: 'idle', conversation: null, lastTick: null, freshness: null, inFlight: [] })} unreachable={false} nowMs={NOW} />);
    const title = screen.getByText(/No flywheel running/);
    expect(title).toHaveTextContent("conversation pane's toolbar");
    expect(title).toHaveTextContent('pan flywheel start');
    expect(title).not.toHaveTextContent('Start below');
  });

  it('paused empty state points at Resume', () => {
    render(<FlywheelStatusPane status={flywheelStatus({ run: 'paused', freshness: 'stalled' })} unreachable={false} nowMs={NOW} />);
    expect(screen.getByText('Paused — Resume to continue')).toBeInTheDocument();
    expect(screen.queryByTestId('flywheel-freshness')).toBeNull();
  });

  it('running without a tick waits for the first tick', () => {
    render(<FlywheelStatusPane status={flywheelStatus({ lastTick: null, freshness: null })} unreachable={false} nowMs={NOW} />);
    expect(screen.getByText('Running — waiting for the first tick')).toBeInTheDocument();
  });

  it('an unreachable server never reads as idle', () => {
    render(<FlywheelStatusPane status={undefined} unreachable nowMs={NOW} />);
    expect(screen.getByText("Can't reach the server — retrying")).toBeInTheDocument();
    expect(screen.queryByText(/No flywheel running/)).toBeNull();
  });
});
