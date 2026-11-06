/**
 * PAN-5093 (WI-6): the disk alert card — free-space line, holder rows, the
 * measuring/incomplete notes, and the Open Resources button.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DiskAlertSnapshot } from '@overdeck/contracts';

import { DiskAlertCard } from '../DiskAlertCard';
import type { Decision } from '../../lib/useDecisions';

const GIB = 1024 ** 3;

function makeSnapshot(overrides: Partial<DiskAlertSnapshot> = {}): DiskAlertSnapshot {
  return {
    level: 'warning',
    path: '/home/op/.overdeck',
    availableBytes: 4.1 * GIB,
    totalBytes: 915 * GIB,
    warningBytes: 5 * GIB,
    criticalBytes: 2 * GIB,
    since: '2026-11-06T17:00:00.000Z',
    checkedAt: '2026-11-06T17:00:30.000Z',
    measuring: false,
    holders: null,
    ...overrides,
  };
}

function makeDecision(snapshot: DiskAlertSnapshot): Decision {
  return {
    id: 'disk-alert',
    source: 'agent',
    label: snapshot.level === 'critical' ? 'Disk critical' : 'Disk low',
    kinds: [snapshot.level === 'critical' ? 'diskCritical' : 'diskLow'],
    since: snapshot.since ?? '',
    blocking: snapshot.level === 'critical',
    diskAlert: snapshot,
  };
}

afterEach(() => {
  window.history.pushState(null, '', '/');
});

describe('DiskAlertCard', () => {
  it('renders the free-space line and holder rows', () => {
    const snapshot = makeSnapshot({
      holders: {
        measuredAt: '2026-11-06T17:00:30.000Z',
        incomplete: false,
        holders: [
          { label: '~/.overdeck/transcript-preservation', path: '/home/op/.overdeck/transcript-preservation', bytes: 53 * GIB },
        ],
      },
    });
    render(<DiskAlertCard decision={makeDecision(snapshot)} />);
    const card = screen.getByTestId('disk-alert-card');
    expect(card.textContent).toContain('4.1 GiB free of 915.0 GiB');
    expect(card.textContent).toContain('~/.overdeck');
    expect(card.textContent).toContain('alert below 5.0 GiB');
    expect(card.textContent).toContain('~/.overdeck/transcript-preservation');
    expect(card.textContent).toContain('53.0 GiB');
  });

  it('shows "Measuring space holders…" while measuring and "Some sizes timed out." when incomplete', () => {
    const measuring = makeSnapshot({ measuring: true });
    const { rerender } = render(<DiskAlertCard decision={makeDecision(measuring)} />);
    expect(screen.getByText('Measuring space holders…')).toBeInTheDocument();

    const incomplete = makeSnapshot({
      holders: { measuredAt: '2026-11-06T17:00:30.000Z', incomplete: true, holders: [] },
    });
    rerender(<DiskAlertCard decision={makeDecision(incomplete)} />);
    expect(screen.getByText('Some sizes timed out.')).toBeInTheDocument();
  });

  it('shows the critical wording below the critical threshold', () => {
    const snapshot = makeSnapshot({ level: 'critical', availableBytes: 1.2 * GIB });
    render(<DiskAlertCard decision={makeDecision(snapshot)} />);
    expect(screen.getByTestId('disk-alert-card').textContent).toContain('critical below 2.0 GiB');
  });

  it('sets window.location.pathname to /resources when Open Resources is clicked', async () => {
    const user = userEvent.setup();
    render(<DiskAlertCard decision={makeDecision(makeSnapshot())} />);
    await user.click(screen.getByRole('button', { name: 'Open Resources' }));
    expect(window.location.pathname).toBe('/resources');
  });
});
