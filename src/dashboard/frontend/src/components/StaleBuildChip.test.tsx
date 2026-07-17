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
  it('renders the number of missed build-input commits in the warning tone', () => {
    hookState.data = {
      status: 'stale',
      buildCommit: '1234567890abcdef',
      originMainSha: 'fedcba0987654321',
      behindTotal: 5,
      behindBuildInputs: 2,
      originMainLastCommitAt: 1_710_000_000_000,
      computedAt: 1_752_580_800_000,
    };

    const chip = render(<StaleBuildChip />).getByText('build stale ×2');

    expect(chip).toHaveClass('text-warning-foreground');
    expect(chip).toHaveAttribute(
      'title',
      'Running build 12345678 · origin/main fedcba09 · 5 total commit(s) behind',
    );
  });

  it.each(['fresh', 'unknown'] as const)('renders nothing for %s builds', (status) => {
    hookState.data = {
      status,
      buildCommit: 'build-sha',
      originMainSha: 'origin-sha',
      behindTotal: 0,
      behindBuildInputs: 0,
      originMainLastCommitAt: 1_710_000_000_000,
      computedAt: 1_752_580_800_000,
    };

    const { container } = render(<StaleBuildChip />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when deploy staleness is unavailable', () => {
    hookState.data = null;

    render(<StaleBuildChip />);
    expect(screen.queryByText(/build stale/)).not.toBeInTheDocument();
  });
});
