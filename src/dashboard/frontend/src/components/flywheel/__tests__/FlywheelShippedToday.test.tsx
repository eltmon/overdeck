import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FlywheelShippedEvent } from '@overdeck/contracts';

import { FlywheelShippedToday } from '../FlywheelShippedToday';

const at = (h: number, m = 0) => new Date(2026, 10, 14, h, m).toISOString();

const merge: FlywheelShippedEvent = {
  kind: 'merge',
  at: at(9, 30),
  merge: {
    sha: 'a'.repeat(40), at: at(9, 30), subject: 'feat: stats panel (#5273)', prNumber: 5273,
    prUrl: 'https://github.com/eltmon/overdeck/pull/5273', issueId: 'PAN-5246', title: 'Flywheel stats panel shows waste', deployed: true,
  },
};
const deploy: FlywheelShippedEvent = { kind: 'deploy', at: at(11, 20), trigger: 'pan reload', issueId: null, initiator: null };
const release: FlywheelShippedEvent = { kind: 'release', at: at(12, 2), tag: 'v0.85.0', url: 'https://github.com/eltmon/overdeck/releases/tag/v0.85.0' };

describe('FlywheelShippedToday (PAN-5283 FR-10)', () => {
  it('lists merges, deploys and releases newest first', () => {
    render(<FlywheelShippedToday events={[merge, release, deploy]} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.dataset.testid)).toEqual(['flywheel-shipped-release', 'flywheel-shipped-deploy', 'flywheel-shipped-merge']);
    expect(items[0]).toHaveTextContent('12:02released v0.85.0');
    expect(items[1]).toHaveTextContent('11:20deployed (pan reload)');
  });

  it('merge rows link to their PR and name the issue', () => {
    render(<FlywheelShippedToday events={[merge]} />);
    const link = screen.getByTestId('flywheel-shipped-merge-link');
    expect(link).toHaveTextContent('PAN-5246');
    expect(link).toHaveAttribute('href', 'https://github.com/eltmon/overdeck/pull/5273');
    expect(screen.getByTestId('flywheel-shipped-merge')).toHaveTextContent('merged PAN-5246 Flywheel stats panel shows waste');
  });

  it('shows the empty message when nothing shipped', () => {
    render(<FlywheelShippedToday events={[]} />);
    expect(screen.getByTestId('flywheel-shipped-today')).toHaveTextContent('Nothing shipped yet today.');
  });
});
