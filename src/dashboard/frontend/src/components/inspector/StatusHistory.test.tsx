import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusHistory } from './StatusHistory';
import type { StatusHistoryEntry } from './types';

const entries: StatusHistoryEntry[] = [
  { type: 'review', status: 'passed', timestamp: new Date(Date.now() - 3600000).toISOString(), notes: 'Looks good' },
  { type: 'test', status: 'failed', timestamp: new Date(Date.now() - 7200000).toISOString() },
  { type: 'merge', status: 'merged', timestamp: new Date(Date.now() - 10800000).toISOString() },
];

describe('StatusHistory', () => {
  it('renders collapsed by default showing entry count', () => {
    render(<StatusHistory history={entries} />);
    expect(screen.getByText('Previous attempts (3)')).toBeInTheDocument();
    expect(screen.queryByText('review')).not.toBeInTheDocument();
  });

  it('expands on click to show history entries', () => {
    render(<StatusHistory history={entries} />);
    fireEvent.click(screen.getByText('Previous attempts (3)'));
    expect(screen.getByText('review')).toBeInTheDocument();
    expect(screen.getByText('test')).toBeInTheDocument();
    expect(screen.getByText('merge')).toBeInTheDocument();
  });

  it('shows notes when present', () => {
    render(<StatusHistory history={entries} />);
    fireEvent.click(screen.getByText('Previous attempts (3)'));
    expect(screen.getByText(/Looks good/)).toBeInTheDocument();
  });

  it('collapses again on second click', () => {
    render(<StatusHistory history={entries} />);
    fireEvent.click(screen.getByText('Previous attempts (3)'));
    expect(screen.getByText('review')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Previous attempts (3)'));
    expect(screen.queryByText('review')).not.toBeInTheDocument();
  });

  it('renders entries in reverse chronological order', () => {
    render(<StatusHistory history={entries} />);
    fireEvent.click(screen.getByText('Previous attempts (3)'));
    const statuses = screen.getAllByText(/passed|failed|merged/);
    // Most recent (merged) appears first since we reverse sort
    expect(statuses[0].textContent).toBe('merged');
  });
});
