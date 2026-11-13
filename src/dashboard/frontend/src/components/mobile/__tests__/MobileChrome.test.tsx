import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { APPEARANCE_KEY } from '../../../lib/appearance';
import { MobileSettingsSheet, useInstallPrompt } from '../MobileChrome';

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Mirrors MobileApp: the prompt hook lives from the first render, the sheet opens later. */
function SheetHarness({ onClose }: { onClose?: () => void }) {
  const prompt = useInstallPrompt();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open settings
      </button>
      <MobileSettingsSheet
        open={open}
        prompt={prompt}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
      />
    </>
  );
}

const STATIC_PROMPT = { installEvent: null, install: () => {}, standalone: false, iosSafari: false };

describe('MobileSettingsSheet (PAN-5208)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ac1: renders a Settings dialog with Appearance, Install and Notifications', () => {
    renderWithQuery(<MobileSettingsSheet open onClose={() => {}} prompt={STATIC_PROMPT} />);
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('radiogroup', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Install' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderWithQuery(<MobileSettingsSheet open={false} onClose={() => {}} prompt={STATIC_PROMPT} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ac2: choosing Light stores it; Escape and Close each call onClose once', () => {
    const onClose = vi.fn();
    renderWithQuery(<MobileSettingsSheet open onClose={onClose} prompt={STATIC_PROMPT} />);

    fireEvent.click(screen.getByRole('radio', { name: /Light/ }));
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('light');
    expect(screen.getByRole('radio', { name: /Light/ }).getAttribute('aria-checked')).toBe('true');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('ac3: an install event dispatched before the sheet opens shows Install app in it', () => {
    renderWithQuery(<SheetHarness />);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn(async () => {}) });
    act(() => {
      window.dispatchEvent(event);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    const install = screen.getByRole('button', { name: 'Install app' });
    expect(dialog.contains(install)).toBe(true);
    act(() => install.click());
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('says Installed when running as a Home Screen app', () => {
    renderWithQuery(<MobileSettingsSheet open onClose={() => {}} prompt={{ ...STATIC_PROMPT, standalone: true }} />);
    expect(screen.getByText('Installed')).toBeInTheDocument();
  });
});
