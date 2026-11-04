/**
 * PAN-4849 WI-22: Deft's review cycle panel, rendered from the review-cycle
 * golden.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import golden from '../../../../../lib/deft/__tests__/fixtures/review-cycle.golden.json';

const cycle = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('./queries', () => ({ useDeftReviewCycle: () => ({ data: cycle.value }) }));

import { DeftReviewCyclePanel } from './DeftReviewCyclePanel';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T18:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DeftReviewCyclePanel', () => {
  it('renders the verdict, exit predicate, rounds and lease', () => {
    cycle.value = golden;
    render(<DeftReviewCyclePanel issueId="PAN-1" />);
    expect(screen.getByText('Deft review cycle')).toBeInTheDocument();
    expect(screen.getByText('NEW_P0_P1')).toBeInTheDocument();
    expect(screen.getByText('PR #12')).toBeInTheDocument();
    const confidence = screen.getByText('Confidence ≥ 4/5 (now 4/5)').closest('li') as HTMLElement;
    expect(confidence.querySelector('[data-exit]')?.textContent).toBe('met');
    const blocking = screen.getByText('No P0/P1 findings (1 remaining)').closest('li') as HTMLElement;
    expect(blocking.querySelector('[data-exit]')?.textContent).toBe('unmet');

    const round1 = screen.getByTestId('deft-round-1').textContent;
    expect(round1).toContain('P0 1 · P1 0 · P2 1');
    expect(round1).toContain('fix 1111111 fix: address Greptile review findings (batch)');
    expect(screen.getByTestId('deft-round-2').textContent).toContain('current');
    expect(screen.getByText(/Rounds are reconstructed/)).toBeInTheDocument();

    const lease = document.querySelector('[data-section="Deft review lease"]')?.textContent ?? '';
    expect(lease).toContain('owner agent:impl-1');
    expect(lease).toContain('active');
    expect(screen.getByText('pr-watch-12-4242 · polling · 2m ago')).toBeInTheDocument();
    expect(screen.getByText('CLEAN recorded at 2026-11-02 17:00Z for 0123456')).toBeInTheDocument();
  });

  it('says the cycle is not running without a supported reviewer, with no rounds', () => {
    cycle.value = {
      ...golden,
      verdict: 'NO_REVIEWER_INSTALLED',
      reviewer: { present: false, name: null, source: 'none', unsupported: ['CodeRabbit'] },
      rounds: [],
    };
    render(<DeftReviewCyclePanel issueId="PAN-1" />);
    expect(screen.getByText('No supported bot reviewer — Deft review cycle not running')).toBeInTheDocument();
    expect(screen.getByText("CodeRabbit is present, but Deft's review cycle supports only Greptile.")).toBeInTheDocument();
    expect(screen.queryByText(/Round/)).toBeNull();
  });

  it('renders nothing for a non-Deft issue', () => {
    cycle.value = undefined;
    expect(render(<DeftReviewCyclePanel issueId="PAN-2" />).container.innerHTML).toBe('');
  });
});
