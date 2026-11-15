/**
 * PAN-5293 WI-15: the left column footer.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeftColumnFooter } from '../LeftColumnFooter';

vi.mock('../../FreshnessIndicator', () => ({ FreshnessIndicator: () => <span data-testid="freshness-indicator" /> }));

let props: { onTabChange: ReturnType<typeof vi.fn>; onOpenUpdater: ReturnType<typeof vi.fn>; onOpenShortcuts: ReturnType<typeof vi.fn> };

function renderFooter(version: { version: string; isDev?: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['version'], version);
  client.setQueryData(['anywhere-machines'], { links: [] });
  return render(
    <QueryClientProvider client={client}>
      <LeftColumnFooter activeTab="home" collapsed={false} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  props = { onTabChange: vi.fn(), onOpenUpdater: vi.fn(), onOpenShortcuts: vi.fn() };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ links: [] })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LeftColumnFooter (PAN-5293 F-D19)', () => {
  it('Settings changes tab and ? opens the shortcuts sheet', () => {
    renderFooter({ version: '0.90.0' });
    fireEvent.click(screen.getByTestId('sidebar-settings-pinned'));
    expect(props.onTabChange).toHaveBeenCalledWith('settings');
    fireEvent.click(screen.getByTestId('left-column-shortcuts'));
    expect(props.onOpenShortcuts).toHaveBeenCalledTimes(1);
  });

  it('names a source checkout on the version button and offers Rebuild there', () => {
    renderFooter({ version: '0.90.0', isDev: true });
    const version = screen.getByTestId('left-column-version');
    expect(version).toHaveTextContent('v0.90.0');
    expect(version.getAttribute('title')).toContain('Running from a source checkout');
    expect(screen.getByTestId('sidebar-rebuild')).toBeInTheDocument();
  });

  it('offers no Rebuild outside a source checkout', () => {
    renderFooter({ version: '0.90.0', isDev: false });
    expect(screen.getByTestId('left-column-version')).toHaveAttribute('title', 'Click to check for updates');
    expect(screen.queryByTestId('sidebar-rebuild')).not.toBeInTheDocument();
  });

  it('the version button opens the updater; Machines and freshness render', () => {
    renderFooter({ version: '0.90.0' });
    fireEvent.click(screen.getByTestId('left-column-version'));
    expect(props.onOpenUpdater).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('sidebar-machines')).toBeInTheDocument();
    expect(screen.getByTestId('freshness-indicator')).toBeInTheDocument();
  });
});
