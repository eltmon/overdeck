/**
 * Real component tests for ScanButton (PAN-457).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScanButton } from '../ScanButton';

describe('ScanButton', () => {
  it('renders Scan label when not scanning', () => {
    render(<ScanButton isScanning={false} onScan={vi.fn()} />);
    expect(screen.getByRole('button', { name: /scan/i })).toBeInTheDocument();
    expect(screen.queryByText(/scanning/i)).not.toBeInTheDocument();
  });

  it('renders Scanning… label when isScanning is true', () => {
    render(<ScanButton isScanning={true} onScan={vi.fn()} />);
    expect(screen.getByText(/scanning/i)).toBeInTheDocument();
  });

  it('disables the button while scanning', () => {
    render(<ScanButton isScanning={true} onScan={vi.fn()} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('enables the button when not scanning', () => {
    render(<ScanButton isScanning={false} onScan={vi.fn()} />);
    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('calls onScan when button is clicked', () => {
    const onScan = vi.fn();
    render(<ScanButton isScanning={false} onScan={onScan} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onScan).toHaveBeenCalledOnce();
  });

  it('shows last result stats when provided', () => {
    const lastResult = { inserted: 3, updated: 1, skipped: 0, errors: 0, durationMs: 1500 };
    render(<ScanButton isScanning={false} onScan={vi.fn()} lastResult={lastResult} />);
    expect(screen.getByText(/\+3/)).toBeInTheDocument();
    expect(screen.getByText(/↑1/)).toBeInTheDocument();
    expect(screen.getByText(/1\.5s/)).toBeInTheDocument();
  });

  it('hides last result stats while scanning', () => {
    const lastResult = { inserted: 3, updated: 1, skipped: 0, errors: 0, durationMs: 1500 };
    render(<ScanButton isScanning={true} onScan={vi.fn()} lastResult={lastResult} />);
    expect(screen.queryByText(/\+3/)).not.toBeInTheDocument();
  });

  it('renders without lastResult', () => {
    render(<ScanButton isScanning={false} onScan={vi.fn()} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.queryByText(/\+/)).not.toBeInTheDocument();
  });
});
