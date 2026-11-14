import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlywheelInFlightRow, FlywheelLastTick } from '@overdeck/contracts';

import { FlywheelNeedsYouCards } from '../FlywheelNeedsYouCards';
import { renderWithQuery, stubFetch } from './fixtures';

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: async () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test' }),
}));

const NOW = new Date(2026, 10, 14, 14, 21).getTime();
const raisedAt = new Date(2026, 10, 14, 14, 12).toISOString();

function tick(needsYouItems: NonNullable<FlywheelLastTick['needsYouItems']>): FlywheelLastTick {
  return {
    tick: 41, pick: null, phase: 'watch', inFlight: [], needsYou: needsYouItems.map((item) => item.text).join('; '),
    at: new Date(NOW).toISOString(), needsYouItems,
  };
}

function row(issueId: string, action?: NonNullable<FlywheelInFlightRow['blocker']>['action']): FlywheelInFlightRow {
  return {
    issueId, title: issueId, state: 'working', liveAgents: 0, inTick: true, lastJournal: null,
    ...(action ? { blocker: { kind: 'start-failed', severity: 'needs-you', text: 'auto-start failed: no work agent came up', action } } : {}),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('FlywheelNeedsYouCards (PAN-5283 FR-8)', () => {
  it('a free-text item gets jump and link but no action button', () => {
    stubFetch(() => undefined);
    const onNeedsYouClick = vi.fn();
    renderWithQuery(
      <FlywheelNeedsYouCards
        tick={tick([{ text: 'Approve the Fly image <https://fly.io/x>', firstRaisedTick: 35, firstRaisedAt: raisedAt, firstRaisedMessageId: 'm35' }])}
        inFlight={[]}
        nowMs={NOW}
        onNeedsYouClick={onNeedsYouClick}
      />,
    );
    expect(screen.getByTestId('flywheel-needs-you-link')).toHaveAttribute('href', 'https://fly.io/x');
    fireEvent.click(screen.getByTestId('flywheel-needs-you-jump'));
    expect(onNeedsYouClick).toHaveBeenCalledWith('m35');
    expect(screen.queryByTestId('flywheel-needs-you-start')).toBeNull();
    expect(screen.queryByTestId('flywheel-needs-you-open')).toBeNull();
    expect(screen.queryByTestId('flywheel-needs-you-waiver')).toBeNull();
  });

  it('card shows why and since', () => {
    stubFetch(() => undefined);
    renderWithQuery(
      <FlywheelNeedsYouCards
        tick={tick([{ text: 'Fix main', firstRaisedTick: 12, firstRaisedAt: raisedAt, context: 'CI is red on main.' }])}
        inFlight={[]}
        nowMs={NOW}
      />,
    );
    expect(screen.getByTestId('flywheel-needs-you-why')).toHaveTextContent('CI is red on main.');
    expect(screen.getByTestId('flywheel-needs-you-since')).toHaveTextContent('tick 12 · 14:12 · 9m ago');
  });

  it('start button asks for confirmation before posting /api/agents', async () => {
    const fetchMock = stubFetch((url) => (url === '/api/agents' ? Response.json({ success: true }) : undefined));
    renderWithQuery(
      <FlywheelNeedsYouCards tick={tick([{ text: 'Start PAN-5300', firstRaisedTick: 40, firstRaisedAt: raisedAt }])} inFlight={[row('PAN-5300', 'start-issue')]} nowMs={NOW} />,
    );
    const start = screen.getByTestId('flywheel-needs-you-start');
    expect(start).toHaveTextContent('Start PAN-5300');
    fireEvent.click(start);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(start).toHaveTextContent('Confirm start');
    fireEvent.click(start);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/agents');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ issueId: 'PAN-5300' });
    expect(await screen.findByText('Start requested')).toBeInTheDocument();
  });

  it('waiver action renders the test-removal waiver control', async () => {
    stubFetch((url) => (url.includes('/test-removal-waiver') ? Response.json({ waiver: null }) : undefined));
    renderWithQuery(
      <FlywheelNeedsYouCards
        tick={tick([{ text: 'Waive the test removal on PAN-5095', firstRaisedTick: 38, firstRaisedAt: raisedAt }])}
        inFlight={[{ ...row('PAN-5095'), blocker: { kind: 'test-removal-waiver', severity: 'needs-you', text: 'x', action: 'waive-test-removal' } }]}
        nowMs={NOW}
      />,
    );
    expect(screen.getAllByTestId('flywheel-needs-you-item')).toHaveLength(1);
    expect(screen.getByTestId('flywheel-needs-you-waiver')).toBeInTheDocument();
  });

  it('answer-agent opens the issue', () => {
    stubFetch(() => undefined);
    const onNavigateIssue = vi.fn();
    renderWithQuery(
      <FlywheelNeedsYouCards tick={null} inFlight={[row('PAN-7', 'answer-agent')]} nowMs={NOW} onNavigateIssue={onNavigateIssue} />,
    );
    fireEvent.click(screen.getByTestId('flywheel-needs-you-open'));
    expect(onNavigateIssue).toHaveBeenCalledWith('PAN-7');
  });

  it('clicking an inner link does not jump', () => {
    stubFetch(() => undefined);
    const onNeedsYouClick = vi.fn();
    const onNavigateIssue = vi.fn();
    renderWithQuery(
      <FlywheelNeedsYouCards
        tick={tick([{ text: 'Merge eltmon/overdeck#5127 for PAN-5095', firstRaisedTick: 3, firstRaisedAt: raisedAt, firstRaisedMessageId: 'm3' }])}
        inFlight={[row('PAN-5095')]}
        nowMs={NOW}
        onNeedsYouClick={onNeedsYouClick}
        onNavigateIssue={onNavigateIssue}
      />,
    );
    fireEvent.click(screen.getByTestId('flywheel-needs-you-pr'));
    fireEvent.click(screen.getByTestId('flywheel-needs-you-issue'));
    expect(onNavigateIssue).toHaveBeenCalledWith('PAN-5095');
    expect(onNeedsYouClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('flywheel-needs-you-item'));
    expect(onNeedsYouClick).toHaveBeenCalledWith('m3');
  });

  it('renders nothing when there is nothing to ask', () => {
    stubFetch(() => undefined);
    const { container } = renderWithQuery(<FlywheelNeedsYouCards tick={null} inFlight={[row('PAN-1')]} nowMs={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });
});
