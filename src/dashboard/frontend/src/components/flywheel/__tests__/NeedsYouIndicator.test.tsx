/**
 * PAN-4199 WI-16 — the app-header needs-you indicator and the reveal channel
 * it drives.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlywheelDerivedStatus } from '@overdeck/contracts';

import { NeedsYouIndicator } from '../NeedsYouIndicator';
import { consumePendingReveal } from '../../../lib/flywheelReveal';
import { flywheelStatus, renderWithQuery, stubFetch } from './fixtures';

function setup(status: FlywheelDerivedStatus) {
  return stubFetch((url) => (url === '/api/flywheel/status' ? Response.json(status) : undefined));
}

/** No tick needs-you and no needs-you row. */
function quiet(overrides: Partial<FlywheelDerivedStatus> = {}) {
  const base = flywheelStatus();
  return flywheelStatus({
    lastTick: { ...base.lastTick!, needsYou: null },
    inFlight: base.inFlight.map((row) => ({ ...row, attention: undefined })),
    ...overrides,
  });
}

describe('NeedsYouIndicator (PAN-4199 WI-16)', () => {
  beforeEach(() => { consumePendingReveal(); });
  afterEach(() => vi.unstubAllGlobals());

  it('renders nothing when nothing needs the operator (ac1)', async () => {
    setup(quiet());
    renderWithQuery(<NeedsYouIndicator />);
    await waitFor(() => expect(screen.queryByTestId('flywheel-needs-you-indicator')).toBeNull());
  });

  it('survives a 200 whose body has no inFlight, rather than taking the app down', async () => {
    // It renders in AppChrome on every page: a throw here reaches the root
    // error boundary and blanks the whole dashboard (caught by tests/e2e).
    stubFetch((url) => (url === '/api/flywheel/status' ? Response.json({}) : undefined));
    renderWithQuery(<NeedsYouIndicator />);
    await waitFor(() => expect(screen.queryByTestId('flywheel-needs-you-indicator')).toBeNull());
  });

  it('counts the tick line and every needs-you row (ac2)', async () => {
    const base = quiet();
    setup(flywheelStatus({
      lastTick: { ...base.lastTick!, needsYou: 'decide the scope' },
      inFlight: [{ ...base.inFlight[0]!, attention: 'needs-you' }, base.inFlight[1]!],
    }));
    renderWithQuery(<NeedsYouIndicator />);
    expect(await screen.findByTestId('flywheel-needs-you-indicator')).toHaveTextContent('Needs you · 2');
  });

  it('requests the reveal exactly once and calls onActivate (ac3)', async () => {
    const onActivate = vi.fn();
    setup(flywheelStatus());
    renderWithQuery(<NeedsYouIndicator onActivate={onActivate} />);
    fireEvent.click(await screen.findByTestId('flywheel-needs-you-indicator'));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(consumePendingReveal()).toBe(true);
    expect(consumePendingReveal()).toBe(false);
  });
});
