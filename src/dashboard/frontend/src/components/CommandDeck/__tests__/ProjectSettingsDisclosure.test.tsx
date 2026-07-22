import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectSettingsDisclosure } from '../ProjectSettingsDisclosure';
import { installStrictFetchMock } from '../../../test-utils/strictFetchMock';

let fetchControl: ReturnType<typeof installStrictFetchMock>;
let autoMergeValue: 'auto' | 'hold' | null;
let swarmMode: 'off' | 'auto' | 'always' | null;

function renderDisclosure() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<ProjectSettingsDisclosure projectKey="overdeck" />, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

describe('ProjectSettingsDisclosure', () => {
  beforeEach(() => {
    autoMergeValue = null;
    swarmMode = null;
    fetchControl = installStrictFetchMock(({ method, url, init }) => {
      if (method === 'GET' && url === '/api/projects/overdeck/auto-merge-default') {
        return Response.json({ value: autoMergeValue });
      }
      if (method === 'POST' && url === '/api/projects/overdeck/auto-merge-default') {
        autoMergeValue = (JSON.parse(String(init?.body)) as { value: 'auto' | 'hold' | null }).value;
        return Response.json({ value: autoMergeValue });
      }
      if (method === 'GET' && url === '/api/projects/overdeck/swarm-policy') {
        return Response.json({ configured: swarmMode ? { mode: swarmMode } : null });
      }
      if (method === 'POST' && url === '/api/projects/overdeck/swarm-policy') {
        const value = (JSON.parse(String(init?.body)) as { value: { mode: 'off' | 'auto' | 'always' } | null }).value;
        swarmMode = value?.mode ?? null;
        return Response.json({ configured: value });
      }
      return undefined;
    });
  });

  afterEach(async () => {
    cleanup();
    await fetchControl.assertNoUnexpectedRequests();
    vi.unstubAllGlobals();
  });

  it('renders no stale collapsed label', () => {
    renderDisclosure();

    expect(screen.queryByText(/collapsed/i)).toBeNull();
  });

  it('renders a CSS-driven rotating chevron under a group details element', () => {
    const { container } = renderDisclosure();
    const details = container.querySelector('details');
    const chevron = container.querySelector('svg');

    expect(details).toHaveClass('group');
    expect(chevron).toHaveClass('transition-transform', 'group-open:rotate-90');
    details?.setAttribute('open', '');
    expect(details).toHaveAttribute('open');
  });

  it('shows configured values in the collapsed summary', async () => {
    autoMergeValue = 'hold';
    swarmMode = 'auto';
    renderDisclosure();

    expect(await screen.findByText('🔒 Hold for UAT · Swarm auto')).toBeInTheDocument();
  });

  it('shows inherited labels when neither setting is configured', async () => {
    renderDisclosure();

    expect(await screen.findByText('Global default · Swarm inherit')).toBeInTheDocument();
  });

  it('preserves the complete expanded settings panel', async () => {
    const { container } = renderDisclosure();
    await screen.findByText('Global default · Swarm inherit');
    container.querySelector('details')?.setAttribute('open', '');

    expect(screen.getByRole('button', { name: '⚡ Auto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '🔒 Hold for UAT' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Global default' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Project swarm policy' })).toBeInTheDocument();
    expect(screen.getByText("Applies to this project's issues that have no explicit per-issue auto-merge setting.")).toBeInTheDocument();
    expect(screen.getByText('Future dispatches only')).toBeInTheDocument();
  });

  it('posts the selected auto-merge value', async () => {
    renderDisclosure();
    await screen.findByText('Global default · Swarm inherit');

    fireEvent.click(screen.getByRole('button', { name: '⚡ Auto' }));

    await waitFor(() => {
      expect(fetchControl.fetchMock).toHaveBeenCalledWith(
        '/api/projects/overdeck/auto-merge-default',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ value: 'auto' }),
        }),
      );
    });
  });
});
