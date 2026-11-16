/**
 * PAN-4594: Settings → Security edits `security.semgrep` through the dedicated
 * settings door and drives the managed install button.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installStrictFetchMock } from '../../../../test-utils/strictFetchMock';
import { SecuritySection } from '../SecuritySection';

vi.mock('../../../../lib/wsTransport', () => ({
  ensureDashboardSession: vi.fn().mockResolvedValue(undefined),
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'Content-Type': 'application/json' }),
}));

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SecuritySection />
    </QueryClientProvider>,
  );
}

const BASE_VIEW = {
  enabled: true,
  mcp: false,
  edit_hook: false,
  gate: 'advisory' as const,
  severity: 'ERROR' as const,
  configs: ['p/default'],
  timeout_seconds: 300,
  pinnedVersion: '1.180.0',
};

describe('SecuritySection (PAN-4594)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('renders every security.semgrep value', async () => {
    const view = { ...BASE_VIEW, gate: 'blocking' as const, configs: ['p/default', 'rules/x.yml'] };
    installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/semgrep/settings') return Response.json(view);
      if (method === 'GET' && url === '/api/prereqs/useSemgrep') {
        return Response.json({ feature: 'useSemgrep', tools: [{ tool: 'semgrep', installed: true, installable: true }], ready: true, missing: [] });
      }
      return undefined;
    });

    renderSection();

    await waitFor(() => expect(screen.getByTestId('semgrep-gate-select')).toHaveValue('blocking'));
    expect(screen.getByTestId('semgrep-configs-input')).toHaveValue('p/default\nrules/x.yml');
  });

  it('toggling Semgrep saves enabled', async () => {
    const view = { ...BASE_VIEW, enabled: false };
    const { fetchMock } = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/semgrep/settings') return Response.json(view);
      if (method === 'PUT' && url === '/api/semgrep/settings') return Response.json({ ...view, enabled: true });
      return undefined;
    });

    renderSection();
    const toggle = await screen.findByTestId('semgrep-enabled-toggle');
    fireEvent.click(toggle);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/semgrep/settings', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ enabled: true }),
    })));
  });

  it('disables the install button while Semgrep is off', async () => {
    const view = { ...BASE_VIEW, enabled: false };
    installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/semgrep/settings') return Response.json(view);
      return undefined;
    });

    renderSection();
    const button = await screen.findByTestId('semgrep-install-button');
    expect(button).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId('semgrep-install-status')).toHaveTextContent('Turn Semgrep on to install it.'));
  });

  it('shows a failure state and retries the install status check', async () => {
    let installStatusCalls = 0;
    installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/semgrep/settings') return Response.json(BASE_VIEW);
      if (method === 'GET' && url === '/api/prereqs/useSemgrep') {
        installStatusCalls += 1;
        if (installStatusCalls === 1) return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
        return Response.json({ feature: 'useSemgrep', tools: [{ tool: 'semgrep', installed: true, installable: true }], ready: true, missing: [] });
      }
      return undefined;
    });

    renderSection();
    await waitFor(() => expect(screen.getByTestId('semgrep-install-status'))
      .toHaveTextContent('Failed to check the install state: Failed to fetch Semgrep install status (HTTP 500)'));
    expect(screen.queryByTestId('semgrep-install-button')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('semgrep-install-status-retry'));

    await waitFor(() => expect(screen.getByTestId('semgrep-install-status')).toHaveTextContent('1.180.0 installed'));
  });

  it('install posts tool semgrep and shows the message', async () => {
    let installStatusCalls = 0;
    installStrictFetchMock(({ method, url, init }) => {
      if (method === 'GET' && url === '/api/semgrep/settings') return Response.json(BASE_VIEW);
      if (method === 'GET' && url === '/api/prereqs/useSemgrep') {
        installStatusCalls += 1;
        return Response.json({ feature: 'useSemgrep', tools: [{ tool: 'semgrep', installed: false, installable: true }], ready: false, missing: ['semgrep'] });
      }
      if (method === 'POST' && url === '/api/prereqs/install') {
        expect(JSON.parse(String(init?.body))).toEqual({ tool: 'semgrep' });
        return Response.json({ success: true, message: 'installed 1.180.0' });
      }
      return undefined;
    });

    renderSection();
    const button = await screen.findByTestId('semgrep-install-button');
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByTestId('semgrep-install-message')).toHaveTextContent('installed 1.180.0'));
    await waitFor(() => expect(installStatusCalls).toBe(2));
  });

  it('keeps polling the install status until it reports installed, then stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let installStatusCalls = 0;
    let toolInstalled = false;
    installStrictFetchMock(({ method, url, init }) => {
      if (method === 'GET' && url === '/api/semgrep/settings') return Response.json(BASE_VIEW);
      if (method === 'GET' && url === '/api/prereqs/useSemgrep') {
        installStatusCalls += 1;
        return Response.json({
          feature: 'useSemgrep',
          tools: [{ tool: 'semgrep', installed: toolInstalled, installable: true }],
          ready: toolInstalled,
          missing: toolInstalled ? [] : ['semgrep'],
        });
      }
      if (method === 'POST' && url === '/api/prereqs/install') {
        expect(JSON.parse(String(init?.body))).toEqual({ tool: 'semgrep' });
        return Response.json({ success: true, message: 'installing…' });
      }
      return undefined;
    });

    try {
      renderSection();
      const button = await screen.findByTestId('semgrep-install-button');
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByTestId('semgrep-install-message')).toHaveTextContent('installing…'));

      const callsAfterRequest = installStatusCalls;
      toolInstalled = true;
      await vi.advanceTimersByTimeAsync(3_000);
      await waitFor(() => expect(installStatusCalls).toBeGreaterThan(callsAfterRequest));
      await waitFor(() => expect(screen.getByTestId('semgrep-install-status')).toHaveTextContent('1.180.0 installed'));

      const callsOnceInstalled = installStatusCalls;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(installStatusCalls).toBe(callsOnceInstalled);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the server's 400 error", async () => {
    installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/semgrep/settings') return Response.json(BASE_VIEW);
      if (method === 'GET' && url === '/api/prereqs/useSemgrep') {
        return Response.json({ feature: 'useSemgrep', tools: [{ tool: 'semgrep', installed: true, installable: true }], ready: true, missing: [] });
      }
      if (method === 'PUT' && url === '/api/semgrep/settings') {
        return new Response(JSON.stringify({ error: 'config.yaml: security.semgrep.gate must be one of …' }), { status: 400 });
      }
      return undefined;
    });

    renderSection();
    const select = await screen.findByTestId('semgrep-gate-select');
    fireEvent.change(select, { target: { value: 'blocking' } });

    await waitFor(() => expect(screen.getByTestId('semgrep-settings-error'))
      .toHaveTextContent('config.yaml: security.semgrep.gate must be one of …'));
  });

  it('does not save an empty configs list', async () => {
    const { fetchMock } = installStrictFetchMock(({ method, url }) => {
      if (method === 'GET' && url === '/api/semgrep/settings') return Response.json(BASE_VIEW);
      if (method === 'GET' && url === '/api/prereqs/useSemgrep') {
        return Response.json({ feature: 'useSemgrep', tools: [{ tool: 'semgrep', installed: true, installable: true }], ready: true, missing: [] });
      }
      return undefined;
    });

    renderSection();
    const textarea = await screen.findByTestId('semgrep-configs-input');
    fireEvent.change(textarea, { target: { value: '' } });
    fireEvent.blur(textarea);

    await waitFor(() => expect(screen.getByTestId('semgrep-settings-error')).toHaveTextContent('Add at least one rule config'));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/semgrep/settings', expect.objectContaining({ method: 'PUT' }));
  });

  it('clears the stale installed state after Semgrep is turned off', async () => {
    const { fetchMock } = installStrictFetchMock(({ method, url, init }) => {
      if (method === 'GET' && url === '/api/semgrep/settings') return Response.json(BASE_VIEW);
      if (method === 'GET' && url === '/api/prereqs/useSemgrep') {
        return Response.json({ feature: 'useSemgrep', tools: [{ tool: 'semgrep', installed: true, installable: true }], ready: true, missing: [] });
      }
      if (method === 'PUT' && url === '/api/semgrep/settings') {
        expect(JSON.parse(String(init?.body))).toEqual({ enabled: false });
        return Response.json({ ...BASE_VIEW, enabled: false });
      }
      return undefined;
    });

    renderSection();
    await waitFor(() => expect(screen.getByTestId('semgrep-install-status')).toHaveTextContent('1.180.0 installed'));

    fireEvent.click(await screen.findByTestId('semgrep-enabled-toggle'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/semgrep/settings', expect.objectContaining({ method: 'PUT' })));
    await waitFor(() => expect(screen.getByTestId('semgrep-install-status')).toHaveTextContent('Turn Semgrep on to install it.'));
    expect(screen.getByTestId('semgrep-install-status')).not.toHaveClass('text-success');
    expect(screen.getByTestId('semgrep-install-button')).toBeInTheDocument();
  });

  it('serializes saves and keeps the latest view', async () => {
    let resolveFirstPut: ((response: Response) => void) | undefined;
    let putCalls = 0;
    installStrictFetchMock(({ method, url, init }) => {
      if (method === 'GET' && url === '/api/semgrep/settings') return Response.json(BASE_VIEW);
      if (method === 'GET' && url === '/api/prereqs/useSemgrep') {
        return Response.json({ feature: 'useSemgrep', tools: [{ tool: 'semgrep', installed: true, installable: true }], ready: true, missing: [] });
      }
      if (method === 'PUT' && url === '/api/semgrep/settings') {
        putCalls += 1;
        if (putCalls === 1) {
          expect(JSON.parse(String(init?.body))).toEqual({ severity: 'WARNING' });
          return new Promise<Response>((resolve) => { resolveFirstPut = resolve; });
        }
        expect(JSON.parse(String(init?.body))).toEqual({ gate: 'blocking' });
        return Response.json({ ...BASE_VIEW, severity: 'WARNING', gate: 'blocking' });
      }
      return undefined;
    });

    renderSection();
    const severitySelect = await screen.findByTestId('semgrep-severity-select');
    const gateSelect = screen.getByTestId('semgrep-gate-select');

    fireEvent.change(severitySelect, { target: { value: 'WARNING' } });
    fireEvent.change(gateSelect, { target: { value: 'blocking' } });

    await waitFor(() => expect(putCalls).toBe(1));

    resolveFirstPut?.(Response.json({ ...BASE_VIEW, severity: 'WARNING', gate: 'advisory' }));

    await waitFor(() => expect(putCalls).toBe(2));
    await waitFor(() => expect(gateSelect).toHaveValue('blocking'));
  });
});
