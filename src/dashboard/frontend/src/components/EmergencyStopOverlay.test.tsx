import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EmergencyStopOverlay } from './EmergencyStopOverlay';
import { installShortcutListener, resetShortcutsForTests } from '../lib/shortcuts/registry';

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (m: string) => toastSuccess(m),
    error: (m: string) => toastError(m),
    warning: (m: string) => toastWarning(m),
  },
}));

function pressChord() {
  // The current platform's modifier only: ⌘⇧. on macOS, Ctrl+Shift+. elsewhere.
  const mac = navigator.platform.includes('Mac');
  fireEvent.keyDown(document, { key: '>', code: 'Period', metaKey: mac, ctrlKey: !mac, shiftKey: true });
}

describe('EmergencyStopOverlay', () => {
  beforeEach(() => {
    installShortcutListener();
    toastSuccess.mockClear();
    toastError.mockClear();
    toastWarning.mockClear();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ killedAgents: ['agent-pan-1', 'agent-pan-2'] }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    resetShortcutsForTests();
    vi.restoreAllMocks();
  });

  it('opens on Ctrl+Shift+. on Linux and not on ⌘⇧. there (PAN-5287)', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
    render(<EmergencyStopOverlay />);
    fireEvent.keyDown(document, { key: '>', code: 'Period', metaKey: true, shiftKey: true });
    expect(screen.queryByText(/Emergency STOP — kill all agents\?/)).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: '>', code: 'Period', ctrlKey: true, shiftKey: true });
    expect(screen.getByText(/Emergency STOP — kill all agents\?/)).toBeInTheDocument();
  });

  it('opens on ⌘⇧. on macOS, even with focus in a text field', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    render(<><EmergencyStopOverlay /><input data-testid="field" /></>);
    const field = screen.getByTestId('field');
    field.focus();
    fireEvent.keyDown(field, { key: '>', code: 'Period', metaKey: true, shiftKey: true });
    expect(screen.getByText(/Emergency STOP — kill all agents\?/)).toBeInTheDocument();
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

  it('#4109: warns, not succeeds, when some agents could not be confirmed stopped', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ killedAgents: ['agent-pan-1'], unconfirmedAgents: ['agent-pan-2', 'agent-pan-3'] }),
    }) as unknown as typeof fetch;
    render(<EmergencyStopOverlay />);
    pressChord();
    fireEvent.click(screen.getByText(/Stop all agents/));
    await waitFor(() => expect(toastWarning).toHaveBeenCalledWith(
      expect.stringContaining('stopped 1; 2 could not be confirmed stopped: agent-pan-2, agent-pan-3'),
    ));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('Escape closes the dialog without firing the stop', () => {
    render(<EmergencyStopOverlay />);
    pressChord();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText(/Emergency STOP — kill all agents\?/)).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
