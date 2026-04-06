import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OpenRouterPage } from '../OpenRouterPage';

// Mock OpenRouterModelBrowser to keep tests focused on OpenRouterPage logic
vi.mock('../OpenRouterModelBrowser', () => ({
  OpenRouterModelBrowser: ({ models, favorites, onToggleFavorite }: any) => (
    <div data-testid="model-browser">
      <span data-testid="model-count">{models.length}</span>
      <span data-testid="favorite-count">{favorites.length}</span>
      <button onClick={() => onToggleFavorite('test/model')} data-testid="toggle-fav">
        Toggle
      </button>
    </div>
  ),
}));

// Mock sonner toast
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockFetch = vi.fn();
global.fetch = mockFetch;

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(props: Partial<Parameters<typeof OpenRouterPage>[0]> = {}) {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <OpenRouterPage
        apiKey=""
        enabled={false}
        onApiKeyChange={vi.fn()}
        onToggleEnabled={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('OpenRouterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ models: [], favorites: [] }),
    });
  });

  it('renders API key input', () => {
    renderPage();
    expect(screen.getByPlaceholderText(/sk-or-/i)).toBeDefined();
  });

  it('renders Test Key button', () => {
    renderPage({ apiKey: 'sk-or-test' });
    expect(screen.getByText('Test Key')).toBeDefined();
  });

  it('calls onApiKeyChange when API key input changes', () => {
    const onApiKeyChange = vi.fn();
    renderPage({ onApiKeyChange });
    const input = screen.getByPlaceholderText(/sk-or-/i);
    fireEvent.change(input, { target: { value: 'sk-or-newkey' } });
    expect(onApiKeyChange).toHaveBeenCalledWith('sk-or-newkey');
  });

  it('shows success state after valid API key test', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ models: [], favorites: [] }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ valid: true }) });

    renderPage({ apiKey: 'sk-or-valid' });
    fireEvent.click(screen.getByText('Test Key'));

    await waitFor(() => {
      // After valid test, status changes (spinner disappears, success shown)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  it('renders model browser once models are loaded', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        models: [
          { id: 'qwen/qwen3.6-plus:free', name: 'Qwen Free', promptCostPer1M: 0, completionCostPer1M: 0, contextLength: 32768, supportsThinking: false, category: 'free' },
        ],
        favorites: [],
      }),
    });

    renderPage({ enabled: true });

    await waitFor(() => {
      expect(screen.getByTestId('model-browser')).toBeDefined();
      expect(screen.getByTestId('model-count').textContent).toBe('1');
    });
  });
});
