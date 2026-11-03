/**
 * PAN-4849 WI-17: Deft's finish-loop entries in the Activity tab.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import golden from '../../../../../lib/deft/__tests__/fixtures/deft-issue-state.golden.json';

const state = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./queries', () => ({ useDeftIssueState: () => ({ data: state.value }) }));

import { DeftFinishLoopFeed } from './DeftFinishLoopFeed';

afterEach(cleanup);

describe('DeftFinishLoopFeed', () => {
  it('renders the entries newest first', () => {
    state.value = golden;
    render(<DeftFinishLoopFeed issueId="PAN-1" />);
    const entries = screen.getAllByTestId('deft-finish-loop-entry').map((entry) => entry.textContent);
    expect(entries).toEqual([
      '2026-11-02 16:10Zaddress#2addressed 2 findingsPR #12',
      '2026-11-02 15:30Zpr-watch#1pr:watch verdict=NEW_P0_P1PR #12',
      '2026-11-02 15:00Zpr-open#1opened PR #12PR #12',
    ]);
  });

  it('shows the halt reason', () => {
    state.value = {
      ...golden,
      finishLoop: [{ ts: '2026-11-02T17:00:00Z', phase: 'halt', iteration: 3, haltReason: 'ceiling reached', message: 'stopping', prNumber: 12 }],
    };
    render(<DeftFinishLoopFeed issueId="PAN-1" />);
    expect(screen.getByText('halted: ceiling reached')).toBeInTheDocument();
  });

  it('renders nothing without entries', () => {
    state.value = { ...golden, finishLoop: [] };
    expect(render(<DeftFinishLoopFeed issueId="PAN-1" />).container.innerHTML).toBe('');
  });
});
