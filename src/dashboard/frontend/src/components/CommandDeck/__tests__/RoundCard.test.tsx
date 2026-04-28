import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { RoundCard } from '../RoundCard';

describe('RoundCard', () => {
  it('renders the round number and verdict label', () => {
    const { getByText } = render(
      <RoundCard round={{ round: 2, verdict: 'passed' }} />,
    );
    expect(getByText('Round 2')).toBeInTheDocument();
    expect(getByText('Passed')).toBeInTheDocument();
  });

  it('emits data-verdict matching the round verdict', () => {
    const { getByTestId } = render(
      <RoundCard round={{ round: 1, verdict: 'failed' }} />,
    );
    expect(getByTestId('round-card').getAttribute('data-verdict')).toBe('failed');
  });

  it('applies anim-round-active class when active=true', () => {
    const { getByTestId } = render(
      <RoundCard round={{ round: 1, verdict: 'running' }} active />,
    );
    expect(getByTestId('round-card').classList.contains('anim-round-active')).toBe(true);
  });

  it('does not apply anim-round-active when active=false', () => {
    const { getByTestId } = render(
      <RoundCard round={{ round: 1, verdict: 'passed' }} />,
    );
    expect(getByTestId('round-card').classList.contains('anim-round-active')).toBe(false);
  });

  it('renders findings count with pluralization', () => {
    const { getByTestId, rerender } = render(
      <RoundCard round={{ round: 1, verdict: 'failed', findings: 3 }} />,
    );
    expect(getByTestId('round-card-findings').textContent).toBe('3 findings');
    rerender(<RoundCard round={{ round: 1, verdict: 'failed', findings: 1 }} />);
    expect(getByTestId('round-card-findings').textContent).toBe('1 finding');
  });

  it('formats duration as seconds for sub-minute', () => {
    const { getByTestId } = render(
      <RoundCard round={{ round: 1, verdict: 'passed', duration: 45 }} />,
    );
    expect(getByTestId('round-card-duration').textContent).toBe('45s');
  });

  it('formats duration as minutes for sub-hour', () => {
    const { getByTestId } = render(
      <RoundCard round={{ round: 1, verdict: 'passed', duration: 600 }} />,
    );
    expect(getByTestId('round-card-duration').textContent).toBe('10m');
  });

  it('formats cost as USD with two decimals', () => {
    const { getByTestId } = render(
      <RoundCard round={{ round: 1, verdict: 'passed', cost: 1.5 }} />,
    );
    expect(getByTestId('round-card-cost').textContent).toBe('$1.50');
  });

  it('omits duration and cost spans when values are missing', () => {
    const { queryByTestId } = render(
      <RoundCard round={{ round: 1, verdict: 'pending' }} />,
    );
    expect(queryByTestId('round-card-duration')).toBeNull();
    expect(queryByTestId('round-card-cost')).toBeNull();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    const { getByTestId } = render(
      <RoundCard round={{ round: 1, verdict: 'passed' }} onClick={onClick} />,
    );
    fireEvent.click(getByTestId('round-card'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('exposes role=button only when interactive', () => {
    const { getByTestId, rerender } = render(
      <RoundCard round={{ round: 1, verdict: 'passed' }} />,
    );
    expect(getByTestId('round-card').getAttribute('role')).toBeNull();

    rerender(
      <RoundCard round={{ round: 1, verdict: 'passed' }} onClick={() => {}} />,
    );
    expect(getByTestId('round-card').getAttribute('role')).toBe('button');
  });

  it('triggers onClick on Enter and Space keys', () => {
    const onClick = vi.fn();
    const { getByTestId } = render(
      <RoundCard round={{ round: 1, verdict: 'passed' }} onClick={onClick} />,
    );
    const el = getByTestId('round-card');
    fireEvent.keyDown(el, { key: 'Enter' });
    fireEvent.keyDown(el, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
