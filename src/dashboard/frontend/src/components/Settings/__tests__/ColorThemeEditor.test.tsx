import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BUILTIN_COLOR_THEMES } from '@overdeck/contracts';
import { installStrictFetchMock } from '../../../test-utils/strictFetchMock';
import { useColorTheme } from '../../../hooks/useColorTheme';
import { ColorThemeEditor } from '../sections/ColorThemeEditor';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
const toastMock = await import('sonner');

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

vi.mock('../../../lib/syntaxTheme');

describe('ColorThemeEditor', () => {
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

  it('duplicate mode seeds the name field and the terminal-background picker from the source theme', () => {
    render(
      <ColorThemeEditor
        source={BUILTIN_COLOR_THEMES['overdeck-dark']}
        mode="duplicate"
        existingNames={['Overdeck Dark', 'Overdeck Light']}
        onDone={() => {}}
      />,
    );

    expect(screen.getByTestId('color-theme-editor-name')).toHaveValue('Overdeck Dark copy');
    expect(screen.getByTestId('color-theme-editor-terminal-background')).toHaveValue('#1a1a2e');
  });

  it('changing the terminal-background picker updates the preview and sends no request', () => {
    render(
      <ColorThemeEditor
        source={BUILTIN_COLOR_THEMES['overdeck-dark']}
        mode="duplicate"
        existingNames={[]}
        onDone={() => {}}
      />,
    );

    fireEvent.change(screen.getByTestId('color-theme-editor-terminal-background'), { target: { value: '#000000' } });

    expect(screen.getByTestId('color-theme-preview-terminal')).toHaveStyle({ backgroundColor: '#000000' });
  });

  it('Save in duplicate mode POSTs the draft theme, then GETs the list, then calls onDone', async () => {
    const onDone = vi.fn();
    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'POST' && url === '/api/color-themes') {
        return Response.json({ theme: { id: 'overdeck-dark-copy', builtin: false, name: 'Overdeck Dark copy', type: 'dark' } });
      }
      if (method === 'GET' && url === '/api/color-themes') {
        return Response.json({
          themes: [BUILTIN_COLOR_THEMES['overdeck-dark'], BUILTIN_COLOR_THEMES['overdeck-light']],
          selection: { light: 'overdeck-light', dark: 'overdeck-dark' },
          warnings: [],
        });
      }
      return undefined;
    });

    render(
      <ColorThemeEditor
        source={BUILTIN_COLOR_THEMES['overdeck-dark']}
        mode="duplicate"
        existingNames={['Overdeck Dark', 'Overdeck Light']}
        onDone={onDone}
      />,
    );
    fireEvent.change(screen.getByTestId('color-theme-editor-terminal-background'), { target: { value: '#000000' } });
    fireEvent.click(screen.getByTestId('color-theme-editor-save'));

    await waitFor(() => {
      const postCall = fetchControl.fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
      expect(postCall).toBeDefined();
      const body = JSON.parse(String((postCall?.[1] as RequestInit).body)).theme;
      expect(body.name).toBe('Overdeck Dark copy');
      expect(body.type).toBe('dark');
      expect(body.terminal.background).toBe('#000000');
      expect(body.id).toBeUndefined();
      expect(body.builtin).toBeUndefined();
    });

    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
  });

  it('Save in edit mode on a user theme sends PUT /api/color-themes/ayu-dark', async () => {
    const ayuDark = { id: 'ayu-dark', builtin: false, name: 'Ayu Dark', type: 'dark' as const };
    useColorTheme.setState({ themes: [ayuDark, BUILTIN_COLOR_THEMES['overdeck-dark'], BUILTIN_COLOR_THEMES['overdeck-light']] });

    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'PUT' && url === '/api/color-themes/ayu-dark') {
        return Response.json({ theme: { ...ayuDark, terminal: { background: '#000000' } } });
      }
      if (method === 'GET' && url === '/api/color-themes') {
        return Response.json({
          themes: [ayuDark, BUILTIN_COLOR_THEMES['overdeck-dark'], BUILTIN_COLOR_THEMES['overdeck-light']],
          selection: { light: 'overdeck-light', dark: 'ayu-dark' },
          warnings: [],
        });
      }
      return undefined;
    });

    render(
      <ColorThemeEditor source={ayuDark} mode="edit" existingNames={['Ayu Dark']} onDone={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('color-theme-editor-save'));

    await waitFor(() => {
      const putCall = fetchControl.fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
      expect(putCall).toBeDefined();
      expect(putCall?.[0]).toBe('/api/color-themes/ayu-dark');
    });
  });

  it('a 403 from PUT shows toast.error and keeps the editor mounted', async () => {
    const ayuDark = { id: 'ayu-dark', builtin: false, name: 'Ayu Dark', type: 'dark' as const };
    useColorTheme.setState({ themes: [ayuDark] });

    fetchControl = installStrictFetchMock(({ method, url }) => {
      if (method === 'PUT' && url === '/api/color-themes/ayu-dark') {
        return Response.json({ error: 'built-in themes are read-only; duplicate it instead' }, { status: 403 });
      }
      return undefined;
    });

    render(
      <ColorThemeEditor source={ayuDark} mode="edit" existingNames={['Ayu Dark']} onDone={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('color-theme-editor-save'));

    await waitFor(() => {
      expect(toastMock.toast.error).toHaveBeenCalled();
    });
    expect(screen.getByTestId('color-theme-editor')).toBeInTheDocument();
  });
});
