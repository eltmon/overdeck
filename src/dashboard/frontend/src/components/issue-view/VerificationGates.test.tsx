import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerificationGatesGrid } from './VerificationGates';
import type { IssueVerificationModel } from './types';

function makeVerification(overrides: Partial<IssueVerificationModel> = {}): IssueVerificationModel {
  return {
    status: 'pending',
    gates: [
      { id: 'typecheck', label: 'typecheck', status: 'pending' },
      { id: 'lint', label: 'lint', status: 'pending' },
      { id: 'test', label: 'test', status: 'pending' },
      { id: 'uat', label: 'UAT', status: 'pending' },
    ],
    ...overrides,
  };
}

describe('VerificationGatesGrid', () => {
  it('renders all four gate cards', () => {
    render(<VerificationGatesGrid verification={makeVerification()} />);
    expect(screen.getByTestId('verification-gates')).toBeTruthy();
    expect(screen.getByTestId('verification-gate-typecheck')).toBeTruthy();
    expect(screen.getByTestId('verification-gate-lint')).toBeTruthy();
    expect(screen.getByTestId('verification-gate-test')).toBeTruthy();
    expect(screen.getByTestId('verification-gate-uat')).toBeTruthy();
  });

  it('renders pass/fail/pending/infra-unavailable fixture states', () => {
    const verification = makeVerification({
      status: 'failed',
      gates: [
        { id: 'typecheck', label: 'typecheck', status: 'passed' },
        { id: 'lint', label: 'lint', status: 'failed' },
        { id: 'test', label: 'test', status: 'pending' },
        { id: 'uat', label: 'UAT', status: 'infra-unavailable' },
      ],
    });
    render(<VerificationGatesGrid verification={verification} />);

    expect(screen.getByTestId('verification-gate-typecheck')).toHaveAttribute('data-gate-status', 'passed');
    expect(screen.getByTestId('verification-gate-lint')).toHaveAttribute('data-gate-status', 'failed');
    expect(screen.getByTestId('verification-gate-test')).toHaveAttribute('data-gate-status', 'pending');
    expect(screen.getByTestId('verification-gate-uat')).toHaveAttribute('data-gate-status', 'infra-unavailable');

    expect(screen.getByText('pass')).toBeTruthy();
    expect(screen.getByText('fail')).toBeTruthy();
    expect(screen.getByText('unavailable')).toBeTruthy();
  });

  it('renders the cycle count when provided', () => {
    render(<VerificationGatesGrid verification={makeVerification({ status: 'running', cycle: 'cycle 2/3' })} />);
    expect(screen.getByText('cycle 2/3')).toBeTruthy();
  });

  it('exposes the inventory section attributes', () => {
    render(<VerificationGatesGrid verification={makeVerification()} />);
    expect(document.querySelector('[data-section="verification-gates"]')).toBeTruthy();
    expect(document.querySelectorAll('[data-section="verification-gate"]')).toHaveLength(4);
  });
});
