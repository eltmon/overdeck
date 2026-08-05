import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installStrictFetchMock } from '../../../test-utils/strictFetchMock';
import { AppearanceSection } from '../sections/AppearanceSection';
import { useDesignLanguage } from '../../../hooks/useDesignLanguage';
import { type UIPreferences } from '../../../hooks/useUIPreferences';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../lib/wsTransport', () => ({ dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })) }));

const DEFAULT_UI_PREFERENCES: UIPreferences = { readyToMergeShimmer: true };

function renderSection(uiPrefs: UIPreferences, updateUIPrefs = vi.fn()) {
  return render(<AppearanceSection uiPrefs={uiPrefs} updateUIPrefs={updateUIPrefs} />);
}

describe('AppearanceSection', () => {
  let mockLocalStorage: Record<string, string>;
  let fetchControl: ReturnType<typeof installStrictFetchMock>;

  beforeEach(() => {
    mockLocalStorage = {};
    global.localStorage = {
      getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockLocalStorage[key];
      }),
      clear: vi.fn(() => {
        mockLocalStorage = {};
      }),
      length: 0,
      key: vi.fn(() => null),
    };
    document.documentElement.dataset.theme = 'broadsheet';
    useDesignLanguage.setState({ designLanguage: 'broadsheet' });
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'PUT' && url === '/api/settings/design-language') {
        return Response.json({ success: true });
      }
      return undefined;
    });
  });

  afterEach(async () => {
    await fetchControl.assertNoUnexpectedRequests();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    delete document.documentElement.dataset.theme;
  });

  it('renders both theme cards with name, description, and a self-themed specimen', () => {
    renderSection(DEFAULT_UI_PREFERENCES);

    expect(screen.getByText('Ledger')).toBeInTheDocument();
    expect(screen.getByText('The classic dense monitoring style')).toBeInTheDocument();
    expect(screen.getByText('Broadsheet')).toBeInTheDocument();
    expect(screen.getByText('The new editorial style — Geist type, display scale, chips, soft cards')).toBeInTheDocument();

    const ledgerSpecimen = screen.getByTestId('theme-specimen-ledger');
    const broadsheetSpecimen = screen.getByTestId('theme-specimen-broadsheet');
    expect(ledgerSpecimen).toHaveAttribute('data-theme', 'ledger');
    expect(broadsheetSpecimen).toHaveAttribute('data-theme', 'broadsheet');
  });

  it('flips documentElement.dataset.theme immediately and persists the mirror when Broadsheet is clicked', async () => {
    useDesignLanguage.setState({ designLanguage: 'ledger' });
    document.documentElement.dataset.theme = 'ledger';
    const user = userEvent.setup();
    renderSection(DEFAULT_UI_PREFERENCES);

    await user.click(screen.getByTestId('theme-card-broadsheet'));

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('broadsheet');
    });
    expect(localStorage.setItem).toHaveBeenCalledWith('overdeck.ui.designLanguage', 'broadsheet');

    const putCall = fetchControl.fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
    expect(putCall).toBeDefined();
    const body = JSON.parse(String((putCall?.[1] as RequestInit).body));
    expect(body).toEqual({ theme: 'broadsheet' });

    // Simulated reload: a fresh read of the persisted mirror reflects the new choice.
    expect(localStorage.getItem('overdeck.ui.designLanguage')).toBe('broadsheet');
  });

  it('shows the selected treatment on the active card and the unselected treatment on the other', () => {
    useDesignLanguage.setState({ designLanguage: 'broadsheet' });
    renderSection(DEFAULT_UI_PREFERENCES);

    expect(screen.getByTestId('theme-card-broadsheet').className).toContain('border-foreground/40');
    expect(screen.getByTestId('theme-card-broadsheet').className).toContain('bg-muted');
    expect(screen.getByTestId('theme-card-ledger').className).not.toContain('border-foreground/40');
  });

  it('renders and toggles the Ready to Merge shimmer switch unchanged', async () => {
    const updateUIPrefs = vi.fn();
    const user = userEvent.setup();
    renderSection({ ...DEFAULT_UI_PREFERENCES, readyToMergeShimmer: true }, updateUIPrefs);

    const toggle = screen.getByRole('switch', { name: 'Toggle Ready to Merge shimmer' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await user.click(toggle);

    expect(updateUIPrefs).toHaveBeenCalledWith({ readyToMergeShimmer: false });
  });
});
