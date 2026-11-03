/**
 * PAN-4849 WI-14, WI-15: the Deft delivery chip and drift badges.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const summary = vi.hoisted(() => ({
  value: {
    issueId: 'PAN-1',
    scopeCounts: { proposed: 1, pending: 1, active: 1, completed: 1, cancelled: 1 },
    specDriftUnresolved: 1,
    installDrift: 0,
    handoffState: 'pr_open' as string | null,
    openEscalations: 3,
  } as Record<string, unknown> | null,
}));
vi.mock('./queries', () => ({
  useDeftIssueSummary: () => ({ isDeft: summary.value !== null, summary: summary.value, isLoading: false }),
}));

import { DeftDeliveryChip, DeftDriftBadges } from './DeftBadges';

const BASE = summary.value;
afterEach(() => {
  cleanup();
  summary.value = BASE;
});

describe('DeftDeliveryChip', () => {
  it('renders the Deft delivery state', () => {
    const { container } = render(<DeftDeliveryChip issueId="PAN-1" />);
    expect(container.textContent).toBe('Deft: pr_open');
  });

  it('renders nothing without a delivery state or for a non-Deft issue', () => {
    summary.value = { ...BASE, handoffState: null };
    expect(render(<DeftDeliveryChip issueId="PAN-1" />).container.innerHTML).toBe('');
    cleanup();
    summary.value = null;
    expect(render(<DeftDeliveryChip issueId="PAN-2" />).container.innerHTML).toBe('');
  });
});

describe('DeftDriftBadges', () => {
  const renderBadges = () => render(<DeftDriftBadges issueId="PAN-1" groupClassName="group" badgeClassName="badge stopped" />);

  it('renders spec drift and install drift as separate neutral badges', () => {
    summary.value = { ...BASE, specDriftUnresolved: 1, installDrift: 2 };
    const badges = Array.from(renderBadges().container.querySelectorAll('.badge'));
    expect(badges.map((badge) => badge.textContent)).toEqual(['spec drift 1', 'install drift 2']);
    expect(badges.every((badge) => badge.className === 'badge stopped')).toBe(true);
  });

  it('renders nothing when both counts are zero', () => {
    summary.value = { ...BASE, specDriftUnresolved: 0, installDrift: 0 };
    expect(renderBadges().container.innerHTML).toBe('');
  });
});
