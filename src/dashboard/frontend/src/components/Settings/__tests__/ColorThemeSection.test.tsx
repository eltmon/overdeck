import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BUILTIN_COLOR_THEMES, type ColorTheme } from '@overdeck/contracts';
import { installStrictFetchMock } from '../../../test-utils/strictFetchMock';
import { useColorTheme } from '../../../hooks/useColorTheme';
import { ColorThemeSection } from '../sections/ColorThemeSection';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const toastMock = await import('sonner');

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

vi.mock('../../../lib/syntaxTheme', () => ({
  ensureSyntaxTheme: vi.fn(async () => 'mock-theme'),
  highlight: vi.fn(async () => '<pre><code>mock</code></pre>'),
  syntaxThemeName: vi.fn(() => 'mock-theme'),
}));

function theme(overrides: Partial<ColorTheme> & { id: string; type: 'light' | 'dark' }): ColorTheme {
  return { builtin: false, name: overrides.id, ...overrides };
}

const ayuDark = theme({ id: 'ayu-dark', type: 'dark' });
const ayuLight = theme({ id: 'ayu-light', type: 'light' });

describe('ColorThemeSection', () => {
  let fetchControl: ReturnType<typeof installStrictFetchMock>;

  beforeEach(() => {
    useColorTheme.setState({
      themes: [BUILTIN_COLOR_THEMES['overdeck-dark'], BUILTIN_COLOR_THEMES['overdeck-light'], ayuDark, ayuLight],
      selection: { light: 'overdeck-light', dark: 'overdeck-dark' },
      active: { light: BUILTIN_COLOR_THEMES['overdeck-light'], dark: BUILTIN_COLOR_THEMES['overdeck-dark'] },
    });
  });

  afterEach(async () => {
    await fetchControl?.assertNoUnexpectedRequests();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('ac1: the dark select lists only dark-type themes and the light select lists only light-type themes', () => {
    fetchControl = installStrictFetchMock(() => undefined);
    render(<ColorThemeSection />);

    const darkOptions = screen.getByTestId('color-theme-dark').querySelectorAll('option');
    const lightOptions = screen.getByTestId('color-theme-light').querySelectorAll('option');

    expect(Array.from(darkOptions).map((o) => o.getAttribute('value'))).toEqual(['overdeck-dark', 'ayu-dark']);
    expect(Array.from(lightOptions).map((o) => o.getAttribute('value'))).toEqual(['overdeck-light', 'ayu-light']);
  });

  it('ac2: choosing ayu-dark sends PUT /api/color-themes/selection with { mode: "dark", id: "ayu-dark" }', async () => {
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'PUT' && url === '/api/color-themes/selection') {
        return Response.json({ selection: { light: 'overdeck-light', dark: 'ayu-dark' } });
      }
      return undefined;
    });
    const user = userEvent.setup();
    render(<ColorThemeSection />);

    await user.selectOptions(screen.getByTestId('color-theme-dark'), 'ayu-dark');

    const putCall = fetchControl.fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
    expect(putCall).toBeDefined();
    expect(JSON.parse(String((putCall?.[1] as RequestInit).body))).toEqual({ mode: 'dark', id: 'ayu-dark' });
  });

  it('ac3: a failed selection save toasts an error and keeps the previous selection', async () => {
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'PUT' && url === '/api/color-themes/selection') {
        return new Response(JSON.stringify({ error: 'id "ayu-dark" does not name a dark theme' }), { status: 400 });
      }
      return undefined;
    });
    const user = userEvent.setup();
    render(<ColorThemeSection />);

    await user.selectOptions(screen.getByTestId('color-theme-dark'), 'ayu-dark');

    await vi.waitFor(() => {
      expect(toastMock.toast.error).toHaveBeenCalled();
    });
    expect(useColorTheme.getState().selection.dark).toBe('overdeck-dark');
  });

  it('renders a row per theme; Edit is absent for built-ins and present for a user theme', () => {
    fetchControl = installStrictFetchMock(() => undefined);
    render(<ColorThemeSection />);

    expect(screen.getByTestId('color-theme-row-overdeck-dark')).toBeInTheDocument();
    expect(screen.getByTestId('color-theme-row-ayu-dark')).toBeInTheDocument();
    expect(screen.queryByTestId('color-theme-edit-overdeck-dark')).not.toBeInTheDocument();
    expect(screen.queryByTestId('color-theme-edit-overdeck-light')).not.toBeInTheDocument();
    expect(screen.getByTestId('color-theme-edit-ayu-dark')).toBeInTheDocument();
  });

  it('clicking Duplicate and edit on overdeck-dark opens the editor seeded with "Overdeck Dark copy"', async () => {
    fetchControl = installStrictFetchMock(() => undefined);
    const user = userEvent.setup();
    render(<ColorThemeSection />);

    await user.click(screen.getByTestId('color-theme-duplicate-overdeck-dark'));

    expect(screen.getByTestId('color-theme-editor')).toBeInTheDocument();
    expect(screen.getByTestId('color-theme-editor-name')).toHaveValue('Overdeck Dark copy');
  });

  it('end-to-end: duplicating and saving adds the new theme to the dark select and closes the editor', async () => {
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'POST' && url === '/api/color-themes') {
        return Response.json({ theme: { id: 'overdeck-dark-copy', builtin: false, name: 'Overdeck Dark copy', type: 'dark' } });
      }
      if (method === 'GET' && url === '/api/color-themes') {
        return Response.json({
          themes: [BUILTIN_COLOR_THEMES['overdeck-dark'], BUILTIN_COLOR_THEMES['overdeck-light'], ayuDark, ayuLight,
            { id: 'overdeck-dark-copy', builtin: false, name: 'Overdeck Dark copy', type: 'dark' }],
          selection: { light: 'overdeck-light', dark: 'overdeck-dark' },
          warnings: [],
        });
      }
      return undefined;
    });
    const user = userEvent.setup();
    render(<ColorThemeSection />);

    await user.click(screen.getByTestId('color-theme-duplicate-overdeck-dark'));
    await user.click(screen.getByTestId('color-theme-editor-save'));

    await vi.waitFor(() => {
      const darkOptions = Array.from(screen.getByTestId('color-theme-dark').querySelectorAll('option')).map((o) => o.getAttribute('value'));
      expect(darkOptions).toContain('overdeck-dark-copy');
    });
    expect(screen.queryByTestId('color-theme-editor')).not.toBeInTheDocument();
  });
});
