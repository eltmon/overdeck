import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MergedSummaryCard } from './MergedSummaryCard';

const MERGED_AT = '2026-04-10T14:30:00.000Z';

describe('MergedSummaryCard', () => {
  it('renders merged status and timestamp', () => {
    render(<MergedSummaryCard mergedAt={MERGED_AT} />);
    expect(screen.getByText('Merged')).toBeInTheDocument();
    // Timestamp is locale-formatted — just verify some date text exists
    expect(screen.getByText(/Apr/)).toBeInTheDocument();
  });

  it('renders cost pill when totalCost > 0', () => {
    render(<MergedSummaryCard mergedAt={MERGED_AT} totalCost={1.5} />);
    expect(screen.getByText('$1.50')).toBeInTheDocument();
    expect(screen.getByText('Total cost')).toBeInTheDocument();
  });

  it('does not render cost pill when totalCost is 0', () => {
    render(<MergedSummaryCard mergedAt={MERGED_AT} totalCost={0} />);
    expect(screen.queryByText('Total cost')).not.toBeInTheDocument();
  });

  it('does not render cost pill when totalCost is null', () => {
    render(<MergedSummaryCard mergedAt={MERGED_AT} totalCost={null} />);
    expect(screen.queryByText('Total cost')).not.toBeInTheDocument();
  });

  it('renders PR link when prUrl is provided', () => {
    render(<MergedSummaryCard mergedAt={MERGED_AT} prUrl="https://github.com/org/repo/pull/42" />);
    const link = screen.getByText('View PR');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', 'https://github.com/org/repo/pull/42');
  });

  it('does not render PR link when prUrl is null', () => {
    render(<MergedSummaryCard mergedAt={MERGED_AT} prUrl={null} />);
    expect(screen.queryByText('View PR')).not.toBeInTheDocument();
  });

  it('does not render PR link when prUrl is undefined', () => {
    render(<MergedSummaryCard mergedAt={MERGED_AT} />);
    expect(screen.queryByText('View PR')).not.toBeInTheDocument();
  });

  it('renders "View last specialist log" button when onViewLastLog is provided', () => {
    const onViewLastLog = vi.fn();
    render(<MergedSummaryCard mergedAt={MERGED_AT} onViewLastLog={onViewLastLog} />);
    const button = screen.getByText('View last specialist log');
    expect(button).toBeInTheDocument();
    fireEvent.click(button.closest('button')!);
    expect(onViewLastLog).toHaveBeenCalledOnce();
  });

  it('does not render "View last specialist log" button when onViewLastLog is null', () => {
    render(<MergedSummaryCard mergedAt={MERGED_AT} onViewLastLog={null} />);
    expect(screen.queryByText('View last specialist log')).not.toBeInTheDocument();
  });

  describe('formatCost', () => {
    it('formats dollars for cost >= 0.01', () => {
      render(<MergedSummaryCard mergedAt={MERGED_AT} totalCost={0.50} />);
      expect(screen.getByText('$0.50')).toBeInTheDocument();
    });

    it('formats cents (no $ prefix) for cost < 0.01', () => {
      render(<MergedSummaryCard mergedAt={MERGED_AT} totalCost={0.005} />);
      // 0.005 * 100 = 0.50 → '0.50¢'
      expect(screen.getByText('0.50¢')).toBeInTheDocument();
    });

    it('does not mix $ and ¢ symbols', () => {
      render(<MergedSummaryCard mergedAt={MERGED_AT} totalCost={0.003} />);
      const costText = screen.getByText(/¢/);
      expect(costText.textContent).not.toMatch(/\$/);
    });
  });
});
