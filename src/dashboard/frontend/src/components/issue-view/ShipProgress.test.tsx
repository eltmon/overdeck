import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShipProgress } from './ShipProgress';
import type { IssueShipModel } from './types';

const OPEN_PR = { prUrl: 'https://example.test/pr/7', prNumber: 7 };

function makeShip(overrides: Partial<IssueShipModel> = {}): IssueShipModel {
  return { status: 'pending', ...overrides };
}

describe('ShipProgress component', () => {
  it('renders the merge gate with the derived status badge', () => {
    render(<ShipProgress ship={makeShip({ status: 'ready', ...OPEN_PR, checks: 'green', mergeable: true })} />);
    expect(screen.getByText('Ship — merge gate')).toBeTruthy();
    expect(screen.getByText('ready')).toBeTruthy();
    expect(screen.getByText('Approved, green, and mergeable')).toBeTruthy();
  });

  it('shows the forge facts: PR, checks, mergeable', () => {
    render(<ShipProgress ship={makeShip({ status: 'pending', ...OPEN_PR, checks: 'red', mergeable: false, blockerReason: 'Checks are red' })} />);
    expect(screen.getByRole('link', { name: '#7' })).toHaveAttribute('href', 'https://example.test/pr/7');
    expect(document.querySelector('[data-step-key="checks"]')).toHaveAttribute('data-step-state', 'red');
    expect(screen.getByText('no')).toBeTruthy();
    expect(screen.getByText('Checks are red')).toBeTruthy();
  });

  it('says so plainly when there is no pull request yet', () => {
    render(<ShipProgress ship={makeShip()} />);
    expect(screen.getByText('No pull request yet')).toBeTruthy();
    expect(screen.getByText('none')).toBeTruthy();
  });

  it('reads merged from the derived state', () => {
    render(<ShipProgress ship={makeShip({ status: 'merged', ...OPEN_PR, checks: 'green', mergeable: true })} />);
    expect(screen.getByText('merged')).toBeTruthy();
    expect(screen.getByText('Merged to main')).toBeTruthy();
  });

  it('renders a compact rail row once the forge has something to say', () => {
    const { container } = render(
      <ShipProgress ship={makeShip({ status: 'merged', ...OPEN_PR })} compact />,
    );
    expect(container.querySelector('[data-section="ship-progress-compact"]')).toBeTruthy();
    expect(screen.getByTestId('ship-door-row')).toBeTruthy();
    expect(screen.getByText('Ship')).toBeTruthy();
  });

  it('renders nothing compact while the issue is still working', () => {
    const { container } = render(<ShipProgress ship={makeShip()} compact />);
    expect(container.firstChild).toBeNull();
  });

  it('exposes the inventory section attributes', () => {
    const { container } = render(<ShipProgress ship={makeShip({ status: 'ready', ...OPEN_PR })} />);
    expect(container.querySelector('[data-section="ship-progress-full"]')).toBeTruthy();
    expect(container.querySelector('[data-section="ship-progress-facts"]')).toBeTruthy();
    expect(container.querySelector('[data-section="ship-progress-summary"]')).toBeTruthy();
  });
});
