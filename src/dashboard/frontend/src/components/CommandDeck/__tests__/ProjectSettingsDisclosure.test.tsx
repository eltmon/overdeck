import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectSettingsDisclosure } from '../ProjectSettingsDisclosure';
import { installStrictFetchMock } from '../../../test-utils/strictFetchMock';

let fetchControl: ReturnType<typeof installStrictFetchMock>;
let autoMergeValue: 'auto' | 'hold' | null;
let swarmMode: 'off' | 'auto' | 'always' | null;
let mergeTrainValue: 'enabled' | 'disabled' | null;
let mergeTrainEffective: boolean;
let mergeTrainQueue: unknown[];
let mergeTrainGenerations: Array<{ name: string; status: string }>;

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
    mergeTrainValue = null;
    mergeTrainEffective = true;
    mergeTrainQueue = [];
    mergeTrainGenerations = [];
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
      // PAN-1696: per-project merge-train override.
      if (method === 'GET' && url === '/api/projects/overdeck/merge-train') {
        return Response.json({ value: mergeTrainValue, effective: mergeTrainValue === null ? mergeTrainEffective : mergeTrainValue !== 'disabled' });
      }
      if (method === 'POST' && url === '/api/projects/overdeck/merge-train') {
        mergeTrainValue = (JSON.parse(String(init?.body)) as { value: 'enabled' | 'disabled' | null }).value;
        return Response.json({ value: mergeTrainValue, effective: mergeTrainValue === null ? mergeTrainEffective : mergeTrainValue !== 'disabled' });
      }
      if (method === 'GET' && url === '/api/dashboard/session') {
        return Response.json({ csrfToken: 'test-csrf-token' });
      }
      // PAN-1696 ac3: the cockpit merge-train summary reads the aggregate endpoints.
      if (method === 'GET' && url === '/api/merge-train/queues') {
        return Response.json([{ projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, queue: mergeTrainQueue }]);
      }
      if (method === 'GET' && url === '/api/merge-train/generations') {
        return Response.json([{ projectKey: 'overdeck', projectName: 'Overdeck', enabled: true, generations: mergeTrainGenerations }]);
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

    expect(screen.getByRole('button', { name: 'Auto-merge default: ⚡ Auto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auto-merge default: 🔒 Hold for UAT' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auto-merge default: Global default' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Project swarm policy' })).toBeInTheDocument();
    expect(screen.getByText("Applies to this project's issues that have no explicit per-issue auto-merge setting.")).toBeInTheDocument();
    expect(screen.getByText('Future dispatches only')).toBeInTheDocument();
    // PAN-1696: the per-project merge-train override is part of the panel now,
    // so the no-loss assertion has to cover it too.
    expect(screen.getByRole('button', { name: 'Merge train: Enabled' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Merge train: Disabled' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Merge train: Global default' })).toBeInTheDocument();
  });

  // PAN-1696 fe-cockpit-toggle ac1: "Global default" must resolve to what is
  // actually in force, otherwise the operator cannot tell on from off.
  it('resolves the effective state when Global default is selected (ac1)', async () => {
    mergeTrainValue = null;
    mergeTrainEffective = true;
    renderDisclosure();

    expect((await screen.findByTestId('merge-train-effective')).textContent)
      .toBe('Following the global default — currently on for this project.');
  });

  it('shows the global default resolving to off (ac1)', async () => {
    mergeTrainValue = null;
    mergeTrainEffective = false;
    renderDisclosure();

    expect((await screen.findByTestId('merge-train-effective')).textContent)
      .toContain('currently off for this project');
  });

  it('omits the effective gloss when the project sets an explicit value (ac1)', async () => {
    mergeTrainValue = 'disabled';
    renderDisclosure();

    await screen.findByRole('button', { name: 'Merge train: Disabled' });
    expect(screen.queryByTestId('merge-train-effective')).not.toBeInTheDocument();
  });

  // PAN-1696 fe-cockpit-toggle ac3.
  it('summarises the ready-feature count and current batch, linking to Awaiting Merge (ac3)', async () => {
    mergeTrainQueue = [{ issueId: 'PAN-1' }, { issueId: 'PAN-2' }];
    mergeTrainGenerations = [
      { name: 'uat/pan-copper-fox-0726', status: 'assembling' },
      { name: 'uat/pan-otter-0726', status: 'ready' },
    ];
    renderDisclosure();

    // The summary renders with zeros before the queries settle, so wait on content.
    await waitFor(() => expect(screen.getByTestId('merge-train-summary').textContent).toContain('2 features ready'));
    // The ready batch wins over the assembling one, matching the merge-train view.
    expect(screen.getByTestId('merge-train-summary').textContent).toContain('batch pan-otter-0726 (ready)');
    expect(screen.getByRole('link', { name: /Awaiting Merge/ })).toHaveAttribute('href', '/awaiting-merge');
  });

  it('says so plainly when no batch is assembled (ac3)', async () => {
    mergeTrainQueue = [{ issueId: 'PAN-1' }];
    renderDisclosure();

    await waitFor(() => expect(screen.getByTestId('merge-train-summary').textContent).toContain('1 feature ready'));
    expect(screen.getByTestId('merge-train-summary').textContent).toContain('no batch assembled');
  });

  it('navigates to Awaiting Merge in-app rather than reloading (ac3)', async () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    renderDisclosure();

    fireEvent.click(await screen.findByRole('link', { name: /Awaiting Merge/ }));

    expect(pushState).toHaveBeenCalledWith({}, '', '/awaiting-merge');
    pushState.mockRestore();
  });

  it('posts the selected auto-merge value', async () => {
    renderDisclosure();
    await screen.findByText('Global default · Swarm inherit');

    fireEvent.click(screen.getByRole('button', { name: 'Auto-merge default: ⚡ Auto' }));

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
