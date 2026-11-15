import type { DeployStalenessSnapshot } from '@overdeck/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StaleBuildChip } from './StaleBuildChip';

const hookState = vi.hoisted(() => ({
  data: undefined as DeployStalenessSnapshot | null | undefined,
}));

vi.mock('../hooks/useDeployStaleness', () => ({
  useDeployStaleness: () => ({ data: hookState.data }),
}));

afterEach(() => {
  cleanup();
  hookState.data = undefined;
});

describe('StaleBuildChip', () => {
  it('reads "Build behind main" in the warning tone and names the missed commits and the remedy', () => {
    hookState.data = {
      status: 'stale',
      buildCommit: '1234567890abcdef',
      originMainSha: 'fedcba0987654321',
      behindTotal: 5,
      behindBuildInputs: 2,
      originMainLastCommitAt: 1_710_000_000_000,
      originMainLastBuildInputCommitAt: 1_710_000_000_000,
      computedAt: 1_752_580_800_000,
    };

    const chip = render(<StaleBuildChip />).getByText('Build behind main');

    expect(chip).toHaveClass('text-warning-foreground');
    expect(chip).toHaveAttribute(
      'title',
      'Running build 12345678 · origin/main fedcba09 · 2 build-input commit(s) behind · 5 total commit(s) behind · Run pan reload to build and restart the dashboard.',
    );
    expect(chip.getAttribute('title')).toContain('2 build-input commit(s) behind');
    expect(chip.getAttribute('title')).toContain('pan reload');
  });

  it.each(['fresh', 'unknown'] as const)('renders nothing for %s builds', (status) => {
    hookState.data = {
      status,
      buildCommit: 'build-sha',
      originMainSha: 'origin-sha',
      behindTotal: 0,
      behindBuildInputs: 0,
      originMainLastCommitAt: 1_710_000_000_000,
      originMainLastBuildInputCommitAt: 1_710_000_000_000,
      computedAt: 1_752_580_800_000,
    };

    const { container } = render(<StaleBuildChip />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when deploy staleness is unavailable', () => {
    hookState.data = null;

    render(<StaleBuildChip />);
    expect(screen.queryByText('Build behind main')).not.toBeInTheDocument();
  });
});
