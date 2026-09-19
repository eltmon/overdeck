import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerificationGatesGrid } from './VerificationGates';
import type { IssueVerificationModel } from './types';

function makeVerification(overrides: Partial<IssueVerificationModel> = {}): IssueVerificationModel {
  return {
    status: 'pending',
    gates: [{ id: 'checks', label: 'checks', status: 'pending' }],
    ...overrides,
  };
}

describe('VerificationGatesGrid', () => {
  it('renders the checks gate', () => {
    render(<VerificationGatesGrid verification={makeVerification()} />);
    expect(screen.getByTestId('verification-gates')).toBeTruthy();
    expect(screen.getByTestId('verification-gate-checks')).toBeTruthy();
  });

  it('renders the forge verdict as pass, fail, running or pending', () => {
    for (const [status, label] of [['passed', 'pass'], ['failed', 'fail'], ['running', 'running'], ['pending', 'pending']] as const) {
      const { unmount } = render(
        <VerificationGatesGrid verification={makeVerification({ gates: [{ id: 'checks', label: 'checks', status }] })} />,
      );
      expect(screen.getByTestId('verification-gate-checks')).toHaveAttribute('data-gate-status', status);
      expect(screen.getByTestId('verification-gate-checks')).toHaveAccessibleName(`checks: ${label}`);
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });

  it('exposes the inventory section attributes', () => {
    render(<VerificationGatesGrid verification={makeVerification()} />);
    expect(document.querySelector('[data-section="verification-gates"]')).toBeTruthy();
    expect(document.querySelectorAll('[data-section="verification-gate"]')).toHaveLength(1);
  });
});
