import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BUILTIN_COLOR_THEMES } from '@overdeck/contracts';
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

vi.mock('@pierre/diffs', () => ({
  registerCustomTheme: vi.fn(),
  getSharedHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: (code: string) => `<pre><code>${code}</code></pre>`,
  }),
}));

const MAPPED_THEME = {
  id: 'ayu-dark',
  builtin: false,
  name: 'Ayu Dark',
  type: 'dark' as const,
  terminal: { background: '#0d1017', red: '#f06b73' },
  ui: { accent: '#e6b450' },
};

describe('ColorThemeImportPreview (via ColorThemeSection)', () => {
  let fetchControl: ReturnType<typeof installStrictFetchMock>;

  beforeEach(() => {
    useColorTheme.setState({
      themes: [BUILTIN_COLOR_THEMES['overdeck-dark'], BUILTIN_COLOR_THEMES['overdeck-light']],
      selection: { light: 'overdeck-light', dark: 'overdeck-dark' },
      active: { light: BUILTIN_COLOR_THEMES['overdeck-light'], dark: BUILTIN_COLOR_THEMES['overdeck-dark'] },
    });
  });

  afterEach(async () => {
    await fetchControl?.assertNoUnexpectedRequests();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function chooseFile() {
    const user = userEvent.setup();
    render(<ColorThemeSection />);
    const file = new File(['{"name":"Ayu Dark","type":"dark"}'], 'ayu-dark.json', { type: 'application/json' });
    await user.upload(screen.getByTestId('color-theme-import-input'), file);
    return user;
  }

  it('ac1: choosing a .json file renders the preview with the theme name, 16 ANSI swatches, and warnings — before anything is saved', async () => {
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'POST' && url === '/api/color-themes/import/preview') {
        return Response.json({ themes: [MAPPED_THEME], warnings: ['terminal.green: invalid color; dropping'] });
      }
      return undefined;
    });

    await chooseFile();

    await waitFor(() => {
      expect(screen.getByTestId('color-theme-import-preview')).toBeInTheDocument();
    });
    expect(screen.getByText('Ayu Dark')).toBeInTheDocument();
    const swatches = screen.getByTestId('color-theme-import-preview').querySelectorAll('[title]');
    // background + foreground + 16 ANSI + 1 ui.accent = 19
    expect(swatches.length).toBeGreaterThanOrEqual(18);
    expect(screen.getByTestId('color-theme-import-warnings')).toHaveTextContent('terminal.green');

    // Nothing saved yet.
    expect(fetchControl.fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST' && (init as RequestInit)?.body?.toString().includes('"theme"'))).toBe(false);
  });

  it('ac2: Save sends POST /api/color-themes with the theme and the matching select then renders it', async () => {
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'POST' && url === '/api/color-themes/import/preview') {
        return Response.json({ themes: [MAPPED_THEME], warnings: [] });
      }
      if (method === 'POST' && url === '/api/color-themes') {
        return Response.json({ theme: MAPPED_THEME });
      }
      if (method === 'GET' && url === '/api/color-themes') {
        return Response.json({
          themes: [BUILTIN_COLOR_THEMES['overdeck-dark'], BUILTIN_COLOR_THEMES['overdeck-light'], MAPPED_THEME],
          selection: { light: 'overdeck-light', dark: 'overdeck-dark' },
          warnings: [],
        });
      }
      return undefined;
    });

    const user = await chooseFile();
    await waitFor(() => {
      expect(screen.getByTestId('color-theme-import-preview')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const postCall = fetchControl.fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit)?.method === 'POST' && JSON.parse(String((init as RequestInit).body) || '{}').theme,
      );
      expect(postCall).toBeDefined();
      expect(JSON.parse(String((postCall?.[1] as RequestInit).body)).theme).toEqual(MAPPED_THEME);
    });

    await waitFor(() => {
      expect(toastMock.toast.success).toHaveBeenCalled();
    });

    await waitFor(() => {
      const darkOptions = Array.from(screen.getByTestId('color-theme-dark').querySelectorAll('option')).map((o) => o.getAttribute('value'));
      expect(darkOptions).toContain('ayu-dark');
    });
  });

  it('ac3: Cancel closes the preview and sends no POST', async () => {
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'POST' && url === '/api/color-themes/import/preview') {
        return Response.json({ themes: [MAPPED_THEME], warnings: [] });
      }
      return undefined;
    });

    const user = await chooseFile();
    await waitFor(() => {
      expect(screen.getByTestId('color-theme-import-preview')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('color-theme-import-preview')).not.toBeInTheDocument();
    expect(fetchControl.fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST' && (init as RequestInit)?.body?.toString().includes('"theme"'))).toBe(false);
  });
});
