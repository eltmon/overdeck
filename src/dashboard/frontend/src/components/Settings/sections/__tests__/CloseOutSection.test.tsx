import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseOutSection } from '../CloseOutSection';

vi.mock('../../../../lib/wsTransport', () => ({
  ensureDashboardSession: vi.fn().mockResolvedValue(undefined),
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'Content-Type': 'application/json' }),
}));

const SETTINGS_VIEW = {
  remove_workspace: { value: true, source: 'default' as const },
  delete_feature_branch: { value: false, source: 'default' as const },
  auto: { value: true, source: 'default' as const, inert: true as const },
  auto_delay_minutes: { value: 60, source: 'default' as const, inert: true as const },
};

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CloseOutSection markSaveError={vi.fn()} markSaved={vi.fn()} setSaveStatus={vi.fn()} />
    </QueryClientProvider>,
  );
}

function mockFetch(view: typeof SETTINGS_VIEW, onPut?: (body: unknown) => void) {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url === '/api/cloister/close-out' && (!init || init.method === undefined)) {
      return new Response(JSON.stringify(view), { status: 200 });
    }
    if (url === '/api/cloister/close-out' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      onPut?.(body);
      return new Response(JSON.stringify({ settings: view, reloaded: true }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
}

describe('CloseOutSection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the four close-out controls with their source labels', async () => {
    mockFetch(SETTINGS_VIEW);
    renderSection();

    await waitFor(() =>
      expect((screen.getByTestId('close-out-remove-workspace') as HTMLButtonElement).disabled).toBe(false)
    );

    expect(screen.getByTestId('close-out-remove-workspace').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('close-out-delete-branch').getAttribute('aria-checked')).toBe('false');
    expect((screen.getByTestId('close-out-auto') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('close-out-auto-delay') as HTMLInputElement).disabled).toBe(true);
  });

  it('shows cloister.toml as the source when the key is set in the file', async () => {
    mockFetch({
      ...SETTINGS_VIEW,
      remove_workspace: { value: false, source: 'cloister.toml' },
    });
    renderSection();

    await waitFor(() => expect(screen.getAllByText('cloister.toml').length).toBeGreaterThan(0));
    expect(screen.getAllByText('default').length).toBeGreaterThan(0);
  });

  it('sends a PUT with the toggled key and value when the remove-workspace switch is clicked', async () => {
    const onPut = vi.fn();
    mockFetch(SETTINGS_VIEW, onPut);
    renderSection();

    await waitFor(() =>
      expect((screen.getByTestId('close-out-remove-workspace') as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(screen.getByTestId('close-out-remove-workspace'));

    await waitFor(() => expect(onPut).toHaveBeenCalledWith({ key: 'remove_workspace', value: false }));
  });
});
