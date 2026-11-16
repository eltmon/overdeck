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
let versionSyncConfig: {
  set?: Array<{ path: string; json_field: string }>;
  command?: string;
  command_cwd?: string;
  command_image?: string;
  expect?: Array<{ path: string; pattern: string }>;
  commit_message?: string;
  push?: string[];
} | null;
let versionShipOutcome: {
  status: 'pending' | 'passed' | 'partial' | 'failed';
  version?: string;
  batch: string;
  paths?: Array<{ path: string; ok: boolean; detail: string }>;
  errorCode?: string;
  at: string;
} | null;
let versionSyncValidationErrors: string[] | null;
let versionSyncLoadFails: boolean;
/** The server-computed effective flag on the aggregate payloads. */
let mergeTrainAggregateEnabled: boolean;
/** PAN-5363: makes the merge-train POST answer 500 without writing. */
let mergeTrainPostFails: boolean;
/** PAN-4594: per-project Semgrep gate override state. */
let sastValue: 'off' | 'advisory' | 'blocking' | null;
let sastSemgrepEnabled: boolean;
let sastGetFails: boolean;

function renderDisclosure() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...rtlRender(<ProjectSettingsDisclosure projectKey="overdeck" />, {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    }),
    client,
  };
}

describe('ProjectSettingsDisclosure', () => {
  beforeEach(() => {
    autoMergeValue = null;
    swarmMode = null;
    mergeTrainValue = null;
    mergeTrainEffective = true;
    mergeTrainQueue = [];
    mergeTrainGenerations = [];
    versionSyncConfig = null;
    versionShipOutcome = null;
    versionSyncValidationErrors = null;
    versionSyncLoadFails = false;
    mergeTrainAggregateEnabled = true;
    mergeTrainPostFails = false;
    sastValue = null;
    sastSemgrepEnabled = true;
    sastGetFails = false;
    const sastEffective = (): { effective: 'off' | 'advisory' | 'blocking'; reason: string } => {
      if (!sastSemgrepEnabled) return { effective: 'off', reason: 'security.semgrep.enabled is false' };
      if (sastValue) return { effective: sastValue, reason: `verification.sast: ${sastValue} in projects.yaml` };
      return { effective: 'advisory', reason: 'security.semgrep.gate: advisory' };
    };
    fetchControl = installStrictFetchMock(({ method, url, init }) => {
      if (method === 'GET' && url === '/api/projects/overdeck/sast') {
        if (sastGetFails) return Response.json({ error: 'registry unavailable' }, { status: 503 });
        return Response.json({ value: sastValue, semgrepEnabled: sastSemgrepEnabled, ...sastEffective() });
      }
      if (method === 'POST' && url === '/api/projects/overdeck/sast') {
        sastValue = (JSON.parse(String(init?.body)) as { value: 'off' | 'advisory' | 'blocking' | null }).value;
        return Response.json({ value: sastValue, semgrepEnabled: sastSemgrepEnabled, ...sastEffective() });
      }
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
        if (mergeTrainPostFails) return Response.json({ error: 'Failed to save merge-train setting' }, { status: 500 });
        mergeTrainValue = (JSON.parse(String(init?.body)) as { value: 'enabled' | 'disabled' | null }).value;
        return Response.json({ value: mergeTrainValue, effective: mergeTrainValue === null ? mergeTrainEffective : mergeTrainValue !== 'disabled' });
      }
      if (method === 'GET' && url === '/api/projects/overdeck/version-sync') {
        if (versionSyncLoadFails) return Response.json({ error: 'registry unavailable' }, { status: 503 });
        return Response.json({ config: versionSyncConfig, lastOutcome: versionShipOutcome });
      }
      if (method === 'PUT' && url === '/api/projects/overdeck/version-sync') {
        if (versionSyncValidationErrors) return Response.json({ errors: versionSyncValidationErrors }, { status: 400 });
        versionSyncConfig = (JSON.parse(String(init?.body)) as { config: typeof versionSyncConfig }).config;
        return Response.json({ config: versionSyncConfig });
      }
      if (method === 'POST' && url.endsWith('/api/dashboard/session')) {
        return Response.json({ csrfToken: 'test-csrf-token' });
      }
      // PAN-4753 WI-12: the cockpit merge-train summary reads the board.
      if (method === 'GET' && url.startsWith('/api/merge-train/board')) {
        return Response.json({
          masterEnabled: true,
          projects: [{
            projectKey: 'overdeck', projectName: 'Overdeck', enabled: mergeTrainAggregateEnabled,
            cars: mergeTrainQueue.map((car) => ({ ...(car as object), liveBatch: null })),
            batches: mergeTrainGenerations, strikes: [], recent: [],
          }],
        });
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

    expect((await screen.findByTestId('project-settings-collapsed-summary')).textContent)
      .toContain('🔒 Hold for UAT · Swarm auto · Train 0 ready · no batch');
  });

  it('shows inherited labels when neither setting is configured', async () => {
    renderDisclosure();

    expect((await screen.findByTestId('project-settings-collapsed-summary')).textContent)
      .toContain('Global default · Swarm inherit · Train 0 ready · no batch');
  });

  it('preserves the complete expanded settings panel', async () => {
    const { container } = renderDisclosure();
    await screen.findByTestId('project-settings-collapsed-summary');
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
      .toBe('Global default: on while the merge train is on for all projects');
  });

  it('shows the global default resolving to off (ac1)', async () => {
    mergeTrainValue = null;
    mergeTrainEffective = false;
    renderDisclosure();

    expect((await screen.findByTestId('merge-train-effective')).textContent)
      .toBe('Off for this project');
  });

  it('omits the effective gloss when the project sets an explicit value (ac1)', async () => {
    mergeTrainValue = 'disabled';
    renderDisclosure();

    await screen.findByRole('button', { name: 'Merge train: Disabled' });
    expect(screen.queryByTestId('merge-train-effective')).not.toBeInTheDocument();
  });

  function boardGetCount(): number {
    return fetchControl.fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/merge-train/board')).length;
  }

  it('the Merge train control refreshes the merge train board (PAN-5363)', async () => {
    const { client } = renderDisclosure();
    await screen.findByRole('button', { name: 'Merge train: Disabled' });
    const before = boardGetCount();

    fireEvent.click(screen.getByRole('button', { name: 'Merge train: Disabled' }));

    await waitFor(() => {
      expect(boardGetCount()).toBeGreaterThan(before);
      expect(client.getQueryData(['project-merge-train', 'overdeck'])).toMatchObject({ value: 'disabled' });
    });
  });

  it('a failed Merge train write leaves the board alone (PAN-5363)', async () => {
    mergeTrainPostFails = true;
    const { client } = renderDisclosure();
    await screen.findByRole('button', { name: 'Merge train: Disabled' });
    const before = boardGetCount();

    fireEvent.click(screen.getByRole('button', { name: 'Merge train: Disabled' }));

    await waitFor(() => expect(fetchControl.fetchMock.mock.calls.some(([input, init]) =>
      String(input) === '/api/projects/overdeck/merge-train' && (init?.method ?? 'GET') === 'POST')).toBe(true));
    expect(boardGetCount()).toBe(before);
    expect(client.getQueryData(['project-merge-train', 'overdeck'])).toMatchObject({ value: null });
  });

  // PAN-1696 fe-cockpit-toggle ac3.
  it('carries count, batch name, STATUS and the Merge train link while COLLAPSED (ac3)', async () => {
    mergeTrainQueue = [{ issueId: 'PAN-1' }, { issueId: 'PAN-2' }];
    mergeTrainGenerations = [{ name: 'uat/pan-otter-0726', status: 'ready' }];
    const { container } = renderDisclosure();

    // Nothing is expanded — assert against what the operator sees at a glance.
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    await waitFor(() => expect(screen.getByTestId('project-settings-collapsed-summary').textContent)
      .toContain('Train 2 ready · pan-otter-0726 (ready)'));

    // All three ac3 pieces must live on the collapsed surface, inside <summary>.
    const link = screen.getByRole('link', { name: /Merge train ↓/ });
    expect(link).toHaveAttribute('href', '#merge-train');
    expect(link.closest('summary')).not.toBeNull();
  });

  it('shows an assembling batch status while COLLAPSED (ac3)', async () => {
    mergeTrainGenerations = [{ name: 'uat/pan-copper-fox-0726', status: 'assembling' }];
    renderDisclosure();

    await waitFor(() => expect(screen.getByTestId('project-settings-collapsed-summary').textContent)
      .toContain('pan-copper-fox-0726 (assembling)'));
  });

  it('scrolls to the project merge train card from the COLLAPSED surface (PAN-4753 WI-12)', async () => {
    const card = document.createElement('div');
    card.id = 'merge-train';
    const scrollIntoView = vi.fn();
    card.scrollIntoView = scrollIntoView;
    document.body.appendChild(card);
    const pushState = vi.spyOn(window.history, 'pushState');
    const { container } = renderDisclosure();

    // Collapsed: the link is reachable without opening anything.
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    fireEvent.click(await screen.findByRole('link', { name: /Merge train ↓/ }));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(pushState).not.toHaveBeenCalled();
    pushState.mockRestore();
    card.remove();
  });

  it('opens Awaiting Merge when the page has no merge train card (sparse project Home)', async () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    renderDisclosure();
    fireEvent.click(await screen.findByRole('link', { name: /Merge train ↓/ }));
    expect(pushState).toHaveBeenCalledWith({}, '', '/awaiting-merge');
    pushState.mockRestore();
  });

  it('reports an off train on the collapsed summary line (ac3)', async () => {
    // The collapsed line reads the server-computed effective flag off the same
    // aggregate payload as the ready count, not the raw per-project override.
    mergeTrainAggregateEnabled = false;
    renderDisclosure();

    await waitFor(() => expect(screen.getByTestId('project-settings-collapsed-summary').textContent)
      .toContain('Train off'));
  });

  it('summarises the waiting-feature count and current batch (ac3)', async () => {
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
  });

  it('says so plainly when no batch is assembled (ac3)', async () => {
    mergeTrainQueue = [{ issueId: 'PAN-1' }];
    renderDisclosure();

    await waitFor(() => expect(screen.getByTestId('merge-train-summary').textContent).toContain('1 feature ready'));
    expect(screen.getByTestId('merge-train-summary').textContent).toContain('no batch assembled');
  });

  it('posts the selected auto-merge value', async () => {
    renderDisclosure();
    await screen.findByTestId('project-settings-collapsed-summary');

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

  it('shows the explicit ship skip posture when version_sync is absent', async () => {
    renderDisclosure();

    expect(await screen.findByText(
      'This project skips ship: no version_sync is declared, so batch promotes will not touch version strings.',
    )).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configure version sync' })).toBeInTheDocument();
  });

  it('shows a retryable load error without exposing empty configuration controls', async () => {
    versionSyncLoadFails = true;
    renderDisclosure();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load version ship configuration: registry unavailable',
    );
    expect(screen.queryByRole('button', { name: 'Configure version sync' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove version sync' })).not.toBeInTheDocument();

    versionSyncLoadFails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Configure version sync' })).toBeInTheDocument();
  });

  it('edits and saves the structured version_sync block explicitly', async () => {
    renderDisclosure();
    fireEvent.click(await screen.findByRole('button', { name: 'Configure version sync' }));

    fireEvent.change(screen.getByLabelText('Version sync command'), { target: { value: 'pnpm vsync' } });
    fireEvent.change(screen.getByLabelText('Version sync command cwd'), { target: { value: 'frontend' } });
    fireEvent.change(screen.getByLabelText('Version sync command image'), { target: { value: 'myn-version-sync:latest' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add target' }));
    fireEvent.change(screen.getByLabelText('Set path 1'), { target: { value: 'frontend/package.json' } });
    fireEvent.change(screen.getByLabelText('Set JSON field 1'), { target: { value: 'version' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add replacement' }));
    fireEvent.change(screen.getByLabelText('Replace path 1'), { target: { value: 'frontend/android/app/build.gradle' } });
    fireEvent.change(screen.getByLabelText('Replace pattern 1'), { target: { value: 'versionName "(?<version>\\d+\\.\\d+)"' } });
    fireEvent.change(screen.getByLabelText('Replace value 1'), { target: { value: '{majorMinor}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add expectation' }));
    fireEvent.change(screen.getByLabelText('Expect path 1'), { target: { value: 'frontend/package.json' } });
    fireEvent.change(screen.getByLabelText('Expect pattern 1'), { target: { value: '"version": "{version}"' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }));
    fireEvent.change(screen.getByLabelText('Push repository 1'), { target: { value: 'frontend' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(versionSyncConfig).toEqual({
      command: 'pnpm vsync',
      command_cwd: 'frontend',
      command_image: 'myn-version-sync:latest',
      set: [{ path: 'frontend/package.json', json_field: 'version' }],
      replace: [{
        path: 'frontend/android/app/build.gradle',
        pattern: 'versionName "(?<version>\\d+\\.\\d+)"',
        value: '{majorMinor}',
      }],
      expect: [{ path: 'frontend/package.json', pattern: '"version": "{version}"' }],
      push: ['frontend'],
    }));
    expect(await screen.findByText(/frontend\/package.json → version/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('renders no-op configuration errors beside expectations and push repositories', async () => {
    versionSyncValidationErrors = [
      'version_sync.expect must contain at least one entry',
      'version_sync.push must contain at least one repository',
    ];
    renderDisclosure();
    fireEvent.click(await screen.findByRole('button', { name: 'Configure version sync' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('version_sync.expect must contain at least one entry')).toBeInTheDocument();
    expect(screen.getByText('version_sync.push must contain at least one repository')).toBeInTheDocument();
  });

  it('renders a server validation error beside the offending pattern', async () => {
    versionSyncValidationErrors = ['version_sync.expect[0].pattern must be a valid regular expression'];
    renderDisclosure();
    fireEvent.click(await screen.findByRole('button', { name: 'Configure version sync' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add expectation' }));
    fireEvent.change(screen.getByLabelText('Expect path 1'), { target: { value: 'package.json' } });
    fireEvent.change(screen.getByLabelText('Expect pattern 1'), { target: { value: '[' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('version_sync.expect[0].pattern must be a valid regular expression')).toBeInTheDocument();
    expect(screen.getByText('version_sync.expect[0].pattern must be a valid regular expression').closest('div'))
      .toContainElement(screen.getByLabelText('Expect pattern 1'));
  });

  it('shows partial propagation with each failing path', async () => {
    versionSyncConfig = { set: [{ path: 'package.json', json_field: 'version' }] };
    versionShipOutcome = {
      status: 'partial',
      version: '48.8.0',
      batch: 'uat/pan-otter-0731',
      at: '2026-07-31T12:00:00.000Z',
      paths: [
        { path: 'package.json', ok: true, detail: 'matched' },
        { path: 'apps/desktop/package.json', ok: false, detail: 'not matched' },
        { path: 'packages/contracts/package.json', ok: false, detail: 'not matched' },
      ],
    };
    renderDisclosure();

    expect(await screen.findByText('Partial propagation — these paths do not report 48.8.0:')).toBeInTheDocument();
    expect(screen.getByText('apps/desktop/package.json')).toBeInTheDocument();
    expect(screen.getByText('packages/contracts/package.json')).toBeInTheDocument();
  });

  it('shows the global default and posts an override', async () => {
    renderDisclosure();

    expect((await screen.findByTestId('sast-gate-effective')).textContent)
      .toBe('Effective: advisory (security.semgrep.gate: advisory)');

    fireEvent.click(screen.getByRole('button', { name: 'Semgrep gate: Blocking' }));

    await waitFor(() => expect(fetchControl.fetchMock).toHaveBeenCalledWith(
      '/api/projects/overdeck/sast',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ value: 'blocking' }) }),
    ));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Semgrep gate: Blocking' }))
      .toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByTestId('sast-gate-effective').textContent)
      .toBe('Effective: blocking (verification.sast: blocking in projects.yaml)');
  });

  it('Global default posts null', async () => {
    sastValue = 'off';
    renderDisclosure();
    await screen.findByRole('button', { name: 'Semgrep gate: Off' });

    fireEvent.click(screen.getByRole('button', { name: 'Semgrep gate: Global default' }));

    await waitFor(() => expect(fetchControl.fetchMock).toHaveBeenCalledWith(
      '/api/projects/overdeck/sast',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ value: null }) }),
    ));
  });

  it('says when Semgrep is off everywhere', async () => {
    sastSemgrepEnabled = false;
    renderDisclosure();

    expect((await screen.findByTestId('sast-gate-effective')).textContent)
      .toBe('Semgrep is off for every project (Settings → Security)');
  });

  it('shows a distinct load error instead of a false off-everywhere message', async () => {
    sastGetFails = true;
    renderDisclosure();

    expect((await screen.findByTestId('sast-gate-load-error')).textContent)
      .toBe('Failed to load the Semgrep gate (HTTP 503)');
    expect(screen.queryByTestId('sast-gate-effective')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Semgrep gate:/ })).not.toBeInTheDocument();
  });

  it('removes version_sync and returns to the explicit skip state', async () => {
    versionSyncConfig = { command: 'pnpm vsync', command_image: 'myn-version-sync:latest' };
    renderDisclosure();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove version sync' }));

    await waitFor(() => expect(versionSyncConfig).toBeNull());
    expect(await screen.findByText(/This project skips ship: no version_sync is declared/)).toBeInTheDocument();
    const put = fetchControl.fetchMock.mock.calls.find(([url, init]) =>
      url === '/api/projects/overdeck/version-sync' && (init as RequestInit | undefined)?.method === 'PUT');
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({ config: null });
  });
});
