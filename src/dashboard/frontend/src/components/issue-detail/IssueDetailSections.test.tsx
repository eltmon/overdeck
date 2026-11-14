import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PausedBanner, ResourcesFacet } from './IssueDetailSections';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PausedBanner', () => {
  const paused = [{ id: 'agent-pan-1', paused: true, pausedReason: 'Operator pause' }];

  it('PausedBanner shows lucide icons and no glyph characters', () => {
    render(<PausedBanner agents={paused} />);
    expect(screen.getByRole('button', { name: 'Unpause' })).toBeTruthy();
    const banner = screen.getByTestId('drawer-paused-banner');
    expect(banner.textContent).not.toContain('⏸');
    expect(banner.textContent).not.toContain('▶');
    expect(banner.querySelectorAll('svg')).toHaveLength(2);
  });

  it('PausedBanner unpauses through the agent route', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    render(<PausedBanner agents={paused} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unpause' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/agent-pan-1/unpause', expect.objectContaining({ method: 'POST' }));
  });

  it('PausedBanner renders nothing when no agent is paused', () => {
    const { container } = render(<PausedBanner agents={[{ id: 'agent-pan-1', paused: false }]} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('ResourcesFacet', () => {
  const workspace = { exists: true, path: '/tmp/x', containers: { api: { running: true } } };

  it('ResourcesFacet inline variant labels the list Containers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(workspace)));
    const { container } = renderWithQueryClient(<ResourcesFacet issueId="PAN-1" variant="inline" />);
    await screen.findByText('Containers');
    const root = container.querySelector('[data-section="DrawerResourcesFacet"]');
    expect(root?.className).toBe('mt-[8px] border-t border-border pt-[8px]');
    expect(screen.getByTestId('drawer-resource-dot-api')).toBeTruthy();
    expect(screen.queryByText('Resources')).toBeNull();
  });

  it('ResourcesFacet rail variant keeps the Resources label and rail classes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(workspace)));
    const { container } = renderWithQueryClient(<ResourcesFacet issueId="PAN-1" />);
    await screen.findByText('Resources');
    const root = container.querySelector('[data-section="DrawerResourcesFacet"]');
    expect(root?.className).toBe('shrink-0 border-l border-border bg-card/70 px-[14px] py-[10px]');
  });
});
