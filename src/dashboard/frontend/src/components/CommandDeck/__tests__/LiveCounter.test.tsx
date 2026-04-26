import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { LiveCounter } from '../LiveCounter';

describe('LiveCounter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the formatted value with the given precision', () => {
    const { getByTestId } = render(<LiveCounter value={1.234} precision={2} />);
    expect(getByTestId('live-counter-value').textContent).toBe('1.23');
  });

  it('renders the unit symbol when provided', () => {
    const { getByTestId } = render(<LiveCounter value={5} unit="$" precision={0} />);
    expect(getByTestId('live-counter-unit').textContent).toBe('$');
  });

  it('does not render unit when omitted', () => {
    const { queryByTestId } = render(<LiveCounter value={5} />);
    expect(queryByTestId('live-counter-unit')).toBeNull();
  });

  it('animates (sets data-scrolling) on value change', () => {
    const { rerender, getByTestId } = render(<LiveCounter value={1} precision={0} />);
    rerender(<LiveCounter value={2} precision={0} />);
    expect(getByTestId('live-counter').getAttribute('data-scrolling')).toBe('true');
  });

  it('clears scrolling state after 250ms', () => {
    const { rerender, getByTestId } = render(<LiveCounter value={1} precision={0} />);
    rerender(<LiveCounter value={2} precision={0} />);
    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(getByTestId('live-counter').getAttribute('data-scrolling')).toBeNull();
    expect(getByTestId('live-counter-value').textContent).toBe('2');
  });

  it('pulses when pulseOnIncrement and value increases', () => {
    const { rerender, getByTestId } = render(
      <LiveCounter value={1} precision={0} pulseOnIncrement />,
    );
    rerender(<LiveCounter value={2} precision={0} pulseOnIncrement />);
    expect(getByTestId('live-counter').getAttribute('data-pulsing')).toBe('true');
  });

  it('does not pulse when pulseOnIncrement is false', () => {
    const { rerender, getByTestId } = render(<LiveCounter value={1} precision={0} />);
    rerender(<LiveCounter value={2} precision={0} />);
    expect(getByTestId('live-counter').getAttribute('data-pulsing')).toBeNull();
  });

  it('flags big-jump when delta meets bigJumpDelta', () => {
    const { rerender, getByTestId } = render(
      <LiveCounter value={1} precision={0} bigJumpDelta={5} />,
    );
    rerender(<LiveCounter value={10} precision={0} bigJumpDelta={5} />);
    expect(getByTestId('live-counter').getAttribute('data-big-jump')).toBe('true');
  });

  it('does not flag big-jump when delta is below threshold', () => {
    const { rerender, getByTestId } = render(
      <LiveCounter value={1} precision={0} bigJumpDelta={5} />,
    );
    rerender(<LiveCounter value={3} precision={0} bigJumpDelta={5} />);
    expect(getByTestId('live-counter').getAttribute('data-big-jump')).toBeNull();
  });

  it('clears big-jump state after 600ms', () => {
    const { rerender, getByTestId } = render(
      <LiveCounter value={1} precision={0} bigJumpDelta={5} />,
    );
    rerender(<LiveCounter value={10} precision={0} bigJumpDelta={5} />);
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(getByTestId('live-counter').getAttribute('data-big-jump')).toBeNull();
  });
});
