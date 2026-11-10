/**
 * PAN-5108 (WI-10): the failed harness update card — label, error tail and
 * the manual command, with nothing to answer or open.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { HarnessAutoUpdateFailure } from '@overdeck/contracts';

import { HarnessUpdateCard } from '../HarnessUpdateCard';
import type { Decision } from '../../lib/useDecisions';

const COMMAND = 'npm install -g --prefix /p @anthropic-ai/claude-code@latest';

function makeDecision(error: string): Decision {
  const failure: HarnessAutoUpdateFailure = {
    binary: 'claude',
    label: 'Claude Code',
    error,
    command: COMMAND,
    failedAt: '2026-11-10T12:01:00.000Z',
  };
  return {
    id: 'harness-update:claude',
    source: 'agent',
    label: 'Claude Code update failed',
    kinds: ['harnessUpdateFailed'],
    since: failure.failedAt,
    blocking: false,
    harnessUpdate: failure,
  };
}

describe('HarnessUpdateCard', () => {
  it('renders the label, the error and the command, with no Answer or Open button', () => {
    render(<HarnessUpdateCard decision={makeDecision('npm ERR! code E404')} />);

    expect(screen.getByTestId('harness-update-card')).toBeTruthy();
    expect(screen.getByText('Claude Code update failed')).toBeTruthy();
    expect(screen.getByText('npm ERR! code E404')).toBeTruthy();
    expect(screen.getByText(COMMAND)).toBeTruthy();
    expect(screen.getByText(/Overdeck retries at the next daily check/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Answer|Open/ })).toBeNull();
  });

  it('shows only the last 300 characters of a long error', () => {
    const error = `${'x'.repeat(1_000)}TAIL`;
    render(<HarnessUpdateCard decision={makeDecision(error)} />);

    const prompt = screen.getByText(/TAIL$/);
    expect(prompt.textContent).toBe(`…${error.slice(-300)}`);
  });
});
