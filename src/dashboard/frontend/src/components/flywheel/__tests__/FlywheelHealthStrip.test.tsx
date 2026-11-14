import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FlywheelHealth } from '@overdeck/contracts';

import { FlywheelHealthStrip, clockTime } from '../FlywheelHealthStrip';

const NOW = Date.parse('2026-11-14T14:00:00.000Z');

function health(overrides: Partial<FlywheelHealth> = {}): FlywheelHealth {
  return {
    mainCi: { conclusion: 'success', sha: 'd0c9b93efe2aaaa', url: 'https://github.com/eltmon/overdeck/actions/runs/1', at: '2026-11-14T13:00:00.000Z' },
    deployed: { buildCommit: 'd0c9b93efe2aaaa', behindVerdict: 0 },
    gateQueue: { running: 0, queued: 9, slots: 2, oldestWaitSince: '2026-11-14T13:36:00.000Z' },
    nextBatch: { name: 'uat/pan-train-0614', status: 'assembling', members: ['PAN-1', 'PAN-2', 'PAN-3'], createdAt: '2026-11-14T13:00:00.000Z' },
    batchingPausedUntil: null,
    lastRelease: { tag: 'v0.85.0', at: '2026-11-14T11:00:00.000Z', url: 'https://github.com/eltmon/overdeck/releases/tag/v0.85.0' },
    ...overrides,
  };
}

describe('FlywheelHealthStrip (PAN-5283 FR-9)', () => {
  it('renders the five strip facts', () => {
    render(<FlywheelHealthStrip health={health()} nowMs={NOW} />);
    expect(screen.getByTestId('flywheel-health-ci')).toHaveTextContent('main CI success · d0c9b93');
    expect(screen.getByTestId('flywheel-health-deployed')).toHaveTextContent('deployed = main CI verdict');
    expect(screen.getByTestId('flywheel-health-gates')).toHaveTextContent('gates 0 running · 9 queued · oldest 24m');
    expect(screen.getByTestId('flywheel-health-batch')).toHaveTextContent('next batch 3 PRs · assembling');
    expect(screen.getByTestId('flywheel-health-release')).toHaveTextContent('release v0.85.0 · 3h');
  });

  it('says how far behind the deployed build is', () => {
    render(<FlywheelHealthStrip health={health({ deployed: { buildCommit: 'abc1234', behindVerdict: 4 } })} nowMs={NOW} />);
    expect(screen.getByTestId('flywheel-health-deployed')).toHaveTextContent('deployed 4 commits behind');
  });

  it('omits a fact whose source is null', () => {
    render(<FlywheelHealthStrip health={health({ mainCi: null, deployed: null, lastRelease: null, nextBatch: null })} nowMs={NOW} />);
    expect(screen.queryByTestId('flywheel-health-ci')).toBeNull();
    expect(screen.queryByTestId('flywheel-health-deployed')).toBeNull();
    expect(screen.queryByTestId('flywheel-health-release')).toBeNull();
    expect(screen.getByTestId('flywheel-health-gates')).toBeInTheDocument();
    expect(screen.getByTestId('flywheel-health-batch')).toHaveTextContent('no batch forming');
  });

  it('shows batching paused until a time', () => {
    const until = new Date(2026, 10, 14, 18, 40).toISOString();
    render(<FlywheelHealthStrip health={health({ batchingPausedUntil: until })} nowMs={NOW} />);
    expect(screen.getByTestId('flywheel-health-batch')).toHaveTextContent('batching paused until 18:40');
    expect(clockTime(until)).toBe('18:40');
  });

  it('contains none of the global header items', () => {
    render(<FlywheelHealthStrip health={health()} nowMs={NOW} />);
    const strip = screen.getByTestId('flywheel-health-strip');
    const text = strip.textContent?.toLowerCase() ?? '';
    for (const word of ['agents', 'quota', 'memory', 'needs you']) expect(text).not.toContain(word);
    for (const testId of ['running-agents-pill', 'github-quota-pill', 'system-health-pill', 'needs-you-indicator', 'decisions-indicator', 'stopped-agents-pill', 'deacon-pause-toggle', 'low-cost-mode-pill', 'stale-build-chip']) {
      expect(strip.querySelector(`[data-testid="${testId}"]`)).toBeNull();
    }
  });
});
