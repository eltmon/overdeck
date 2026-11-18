/**
 * PAN-5463: the macOS Accessibility and Screen Recording rows in Settings → Computer Use.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComputerUseStatusView } from '../../hooks/useComputerUseStatus';
import { ComputerUseMacPermissions } from '../ComputerUseMacPermissions';

function checks(accessibility: 'ok' | 'action', screenRecording: 'ok' | 'action'): ComputerUseStatusView['checks'] {
  return [
    { id: 'macos-version', label: 'macOS version', status: 'ok', detail: 'macOS 14.6.1' },
    { id: 'accessibility', label: 'Accessibility', status: accessibility, detail: accessibility === 'ok' ? 'Allowed' : 'Not allowed' },
    { id: 'screen-recording', label: 'Screen Recording', status: screenRecording, detail: screenRecording === 'ok' ? 'Allowed' : 'Not allowed' },
  ];
}

describe('ComputerUseMacPermissions (PAN-5463)', () => {
  it('renders both rows as Allowed with no buttons when both permissions are ok (ac4)', () => {
    render(<ComputerUseMacPermissions checks={checks('ok', 'ok')} busy={false} onOpen={vi.fn()} />);
    expect(screen.getByTestId('computer-use-permission-accessibility')).toHaveTextContent('AccessibilityAllowed');
    expect(screen.getByTestId('computer-use-permission-screen-recording')).toHaveTextContent('Screen RecordingAllowed');
    expect(screen.queryByText('Open settings')).toBeNull();
  });

  it('renders Not allowed in amber with an Open settings button that names the permission', () => {
    const onOpen = vi.fn();
    render(<ComputerUseMacPermissions checks={checks('ok', 'action')} busy={false} onOpen={onOpen} />);

    const status = screen.getByText('Not allowed');
    expect(status.className).toContain('text-warning-foreground');
    fireEvent.click(screen.getByTestId('computer-use-open-screen-recording'));

    expect(onOpen).toHaveBeenCalledWith('screen-recording');
    expect(screen.queryByTestId('computer-use-open-accessibility')).toBeNull();
  });

  it('treats a missing or unavailable check as not allowed, and names each button by its permission', () => {
    render(<ComputerUseMacPermissions checks={[]} busy={false} onOpen={vi.fn()} />);
    expect(screen.getAllByText('Not allowed')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Open settings for Accessibility' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open settings for Screen Recording' })).toBeInTheDocument();
  });

  it('disables Open settings while an action runs', () => {
    render(<ComputerUseMacPermissions checks={checks('action', 'ok')} busy onOpen={vi.fn()} />);
    expect(screen.getByTestId('computer-use-open-accessibility')).toBeDisabled();
  });
});
