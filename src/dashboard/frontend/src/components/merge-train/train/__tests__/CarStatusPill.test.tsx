/**
 * PAN-4753 WI-10: the car status pill. The cooldown countdown is driven by a
 * 1 s client ticker, so it is tested with fake timers.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CarStatusPill } from '../CarStatusPill';
import { car } from './fixtures';

describe('CarStatusPill', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts the cooldown down every second', () => {
    render(<CarStatusPill car={car({ state: 'cooldown', mergeAt: '2026-11-14T12:04:12.000Z' })} />);
    expect(screen.getByTestId('car-pill-PAN-1').textContent).toBe('Cooling down 4:12');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId('car-pill-PAN-1').textContent).toBe('Cooling down 4:11');
    act(() => { vi.advanceTimersByTime(250_000); });
    expect(screen.getByTestId('car-pill-PAN-1').textContent).toBe('Cooling down 0:01');
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByTestId('car-pill-PAN-1').textContent).toBe('Cooling down 0:00');
  });

  it('names the merge step out of nine', () => {
    render(<CarStatusPill car={car({ state: 'merging', step: 'rebasing' })} />);
    expect(screen.getByTestId('car-pill-PAN-1').textContent).toBe('Merging · step 4 of 9');
  });

  it('names the first blocker and counts the rest', () => {
    render(<CarStatusPill car={car({
      state: 'blocked',
      blockers: [
        { type: 'failing_checks', summary: 'checks failed' },
        { type: 'draft_pr', summary: 'the PR is a draft' },
      ],
    })}
    />);
    expect(screen.getByTestId('car-pill-PAN-1').textContent).toBe('Blocked: failing checks +1');
  });

  it.each([
    ['failed', 'Last merge failed'],
    ['held', 'Waiting for batch'],
    ['ready', 'Ready'],
  ] as const)('%s reads "%s"', (state, text) => {
    render(<CarStatusPill car={car({ state })} />);
    expect(screen.getByTestId('car-pill-PAN-1').textContent).toBe(text);
  });
});
