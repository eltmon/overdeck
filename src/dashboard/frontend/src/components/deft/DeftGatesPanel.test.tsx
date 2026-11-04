/**
 * PAN-4849 WI-13: Deft gate runs on the Overview tab.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import golden from '../../../../../lib/deft/__tests__/fixtures/deft-issue-state.golden.json';

const state = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./queries', () => ({ useDeftIssueState: () => ({ data: state.value }) }));

import { DeftGatesPanel } from './DeftGatesPanel';

afterEach(cleanup);

describe('DeftGatesPanel', () => {
  it('renders the run target and each gate with its Deft status', () => {
    state.value = golden;
    render(<DeftGatesPanel issueId="PAN-1" />);
    expect(screen.getByText('Deft gates')).toBeInTheDocument();
    expect(screen.getByText('pre-pr')).toBeInTheDocument();
    expect(screen.getByTestId('deft-gate-lint').textContent).toBe('lintrunexit 0');
    expect(screen.getByTestId('deft-gate-e2e').textContent).toBe('e2eskippedno browser available');
    expect(screen.getByTestId('deft-gate-typecheck').textContent).toBe('typecheckfailedexit 2TS2322 in src/a.ts');
  });

  it('says so when no gate run is recorded', () => {
    state.value = { ...golden, gateRuns: [] };
    render(<DeftGatesPanel issueId="PAN-1" />);
    expect(screen.getByText('No Deft gate runs recorded yet.')).toBeInTheDocument();
  });

  it('renders nothing for a non-Deft issue', () => {
    state.value = undefined;
    const { container } = render(<DeftGatesPanel issueId="PAN-2" />);
    expect(container.innerHTML).toBe('');
  });
});
