import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EmergencyStopOverlay } from './EmergencyStopOverlay';

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));

function pressChord() {
  // Cmd/Ctrl + Shift + . — fire both modifier flags so the test passes on either platform.
  fireEvent.keyDown(document, { key: '.', code: 'Period', metaKey: true, ctrlKey: true, shiftKey: true });
}

describe('EmergencyStopOverlay', () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ killedAgents: ['agent-pan-1', 'agent-pan-2'] }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not render the dialog until the hotkey is pressed', () => {
    render(<EmergencyStopOverlay />);
    expect(screen.queryByText(/Emergency STOP — kill all agents\?/)).not.toBeInTheDocument();
  });

  it('opens the confirm dialog on Cmd/Ctrl+Shift+.', () => {
    render(<EmergencyStopOverlay />);
    pressChord();
    expect(screen.getByText(/Emergency STOP — kill all agents\?/)).toBeInTheDocument();
  });

  it('confirming POSTs to the emergency-stop endpoint and toasts the kill count', async () => {
    render(<EmergencyStopOverlay />);
    pressChord();
    fireEvent.click(screen.getByText(/Stop all agents/));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/cloister/emergency-stop', { method: 'POST' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('killed 2 agents')));
  });

  it('Escape closes the dialog without firing the stop', () => {
    render(<EmergencyStopOverlay />);
    pressChord();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText(/Emergency STOP — kill all agents\?/)).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
