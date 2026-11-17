/**
 * PAN-5461: Settings → Computer Use shows the host's computer-use status, sets it
 * up in one click, and lets the operator take the desktop back from an agent.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installStrictFetchMock } from '../../../../test-utils/strictFetchMock';
import type { ComputerUseStatusView } from '../../hooks/useComputerUseStatus';
import { ComputerUseSection } from '../ComputerUseSection';
import { SETTINGS_NAV_ITEMS } from '../../settingsPageConstants';

vi.mock('../../../../lib/wsTransport', () => ({
  ensureDashboardSession: vi.fn().mockResolvedValue(undefined),
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'Content-Type': 'application/json' }),
}));

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ComputerUseSection />
    </QueryClientProvider>,
  );
}

const OK_CHECKS: ComputerUseStatusView['checks'] = [
  { id: 'session', label: 'Desktop session', status: 'ok', detail: 'x11 · display :1' },
  { id: 'helper', label: 'Helper', status: 'ok', detail: 'Handshake ok' },
];

function view(overrides: Partial<ComputerUseStatusView> = {}): ComputerUseStatusView {
  return {
    platform: 'linux',
    supported: true,
    enabled: false,
    hostname: 'desk',
    session: { ok: true, label: 'x11 · display :1' },
    checks: OK_CHECKS,
    setupSteps: [
      { id: 'enable-flag', label: 'Turn on Computer Use' },
      { id: 'test-helper', label: 'Test the helper' },
    ],
    lease: null,
    skill: { installed: true, locations: ['~/.claude/skills'] },
    ...overrides,
  };
}

function serveStatus(status: ComputerUseStatusView, extra?: Parameters<typeof installStrictFetchMock>[0]) {
  return installStrictFetchMock((request) => {
    if (request.method === 'GET' && request.url === '/api/computer-use/status') return Response.json(status);
    return extra?.(request);
  });
}

describe('ComputerUseSection (PAN-5461)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('shows Unavailable with the host message and no button', async () => {
    serveStatus(view({ platform: 'wsl', supported: false, session: { ok: false, message: "Computer use isn't supported on this host (wsl) yet." }, checks: [], setupSteps: [] }));
    renderSection();
    expect(await screen.findByText('Not available on this machine')).toBeInTheDocument();
    expect(screen.getByTestId('computer-use-badge')).toHaveTextContent('Unavailable');
    expect(screen.getByText("Computer use isn't supported on this host (wsl) yet.")).toBeInTheDocument();
    expect(screen.queryByTestId('computer-use-cta')).toBeNull();
  });

  it('offers Set up and turn on with the password note when packages are missing', async () => {
    serveStatus(view({
      setupSteps: [
        { id: 'install-packages', label: 'Install xdotool xclip', needsPassword: true },
        { id: 'enable-accessibility', label: 'Turn on GNOME accessibility' },
        { id: 'enable-flag', label: 'Turn on Computer Use' },
        { id: 'test-helper', label: 'Test the helper' },
      ],
    }));
    renderSection();
    expect(await screen.findByTestId('computer-use-cta')).toHaveTextContent('Set up and turn on');
    expect(screen.getByTestId('computer-use-badge')).toHaveTextContent('Off');
    expect(screen.getByTestId('computer-use-password-note')).toHaveTextContent('Your system will ask for your password once, to install packages.');
    expect(screen.getByText('Setup installs xdotool xclip, turns on GNOME accessibility and tests everything.')).toBeInTheDocument();
    expect(screen.getByText('desk', { exact: true })).toBeInTheDocument();
  });

  it('offers Turn on Computer Use with no password when nothing is missing', async () => {
    serveStatus(view());
    renderSection();
    expect(await screen.findByTestId('computer-use-cta')).toHaveTextContent('Turn on Computer Use');
    expect(screen.getByTestId('computer-use-password-note')).toHaveTextContent('No password needed.');
    expect(screen.getByText('Everything it needs is already installed. One click turns it on.')).toBeInTheDocument();
  });

  it('shows a failed step with its command, a Copy button and Try again', async () => {
    const status = view({ setupSteps: [{ id: 'install-packages', label: 'Install xdotool', needsPassword: true }, ...view().setupSteps] });
    const { fetchMock } = serveStatus(status, ({ method, url }) => {
      if (method === 'POST' && url === '/api/computer-use/setup') {
        return Response.json({
          ok: false,
          steps: [{
            id: 'install-packages',
            label: 'Install xdotool',
            status: 'failed',
            message: 'The password prompt was cancelled. Try again, or run the command below in a terminal.',
            command: 'sudo apt-get install -y xdotool',
          }],
          status,
        });
      }
      return undefined;
    });
    renderSection();
    const cta = await screen.findByTestId('computer-use-cta');
    await act(async () => { fireEvent.click(cta); });

    await waitFor(() => expect(screen.getByTestId('computer-use-cta')).toHaveTextContent('Try again'));
    expect(fetchMock).toHaveBeenCalledWith('/api/computer-use/setup', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByTestId('computer-use-command')).toHaveTextContent('sudo apt-get install -y xdotool');
    expect(screen.getByTestId('computer-use-copy-command')).toBeInTheDocument();
    expect(screen.getByText(/password prompt was cancelled/)).toBeInTheDocument();
  });

  it('keeps the off switch after a failed helper test leaves the flag on, and turning it off clears the failure', async () => {
    const status = view();
    const onStatus = view({ enabled: true, setupSteps: [{ id: 'test-helper', label: 'Test the helper' }] });
    const { fetchMock } = serveStatus(status, ({ method, url }) => {
      if (method === 'POST' && url === '/api/computer-use/setup') {
        return Response.json({
          ok: false,
          steps: [
            { id: 'enable-flag', label: 'Turn on Computer Use', status: 'done' },
            { id: 'test-helper', label: 'Test the helper', status: 'failed', message: 'helper_timeout' },
          ],
          status: onStatus,
        });
      }
      if (method === 'PUT' && url === '/api/computer-use/settings') return Response.json(view());
      return undefined;
    });
    renderSection();
    const cta = await screen.findByTestId('computer-use-cta');
    await act(async () => { fireEvent.click(cta); });

    await waitFor(() => expect(screen.getByTestId('computer-use-cta')).toHaveTextContent('Try again'));
    const toggle = screen.getByTestId('computer-use-enabled-switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await act(async () => { fireEvent.click(toggle); });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/computer-use/settings', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ enabled: false }),
    })));
    await waitFor(() => expect(screen.getByTestId('computer-use-title')).toHaveTextContent('Computer Use is off'));
  });

  it('shows Ready, a checked switch and a disabled Take back control when on and free', async () => {
    serveStatus(view({ enabled: true, setupSteps: [] }));
    renderSection();
    expect(await screen.findByText('Computer Use is on')).toBeInTheDocument();
    expect(screen.getByTestId('computer-use-badge')).toHaveTextContent('Ready');
    expect(screen.getByTestId('computer-use-enabled-switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('computer-use-lease-badge')).toHaveTextContent('Free');
    expect(screen.getByTestId('computer-use-release')).toBeDisabled();
  });

  it('shows In use with the holder and an enabled Take back control while an agent holds the desktop', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const { fetchMock } = serveStatus(view({ enabled: true, setupSteps: [], lease: { holder: 'agent-pan-1', expiresAt } }), ({ method, url }) => {
      if (method === 'POST' && url === '/api/computer-use/release') return Response.json(view({ enabled: true, setupSteps: [] }));
      return undefined;
    });
    renderSection();
    expect(await screen.findByTestId('computer-use-lease-badge')).toHaveTextContent('In use');
    expect(screen.getByTestId('computer-use-lease-holder')).toHaveTextContent(/agent-pan-1 is driving the desktop · its turn ends in \d+s unless it acts again\./);
    const release = screen.getByTestId('computer-use-release');
    expect(release).toBeEnabled();
    await act(async () => { fireEvent.click(release); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/computer-use/release', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(screen.getByTestId('computer-use-lease-badge')).toHaveTextContent('Free'));
  });

  it('lists the checks and where the skill is installed', async () => {
    serveStatus(view({ checks: [...OK_CHECKS, { id: 'input', label: 'Mouse and keyboard input', status: 'missing', detail: 'xdotool not installed', fixCommand: 'sudo zypper install -y xdotool' }] }));
    renderSection();
    expect(await screen.findByText('What Overdeck checked')).toBeInTheDocument();
    expect(screen.getByText('xdotool not installed')).toBeInTheDocument();
    expect(screen.getByText('sudo zypper install -y xdotool')).toBeInTheDocument();
    expect(screen.getByTestId('computer-use-skill')).toHaveTextContent('pan-computer-use skill — installed in ~/.claude/skills');
  });

  it('lists Computer Use directly after Security in the Settings nav', () => {
    const ids = SETTINGS_NAV_ITEMS.map((item) => item.id);
    expect(ids[ids.indexOf('security') + 1]).toBe('computer-use');
    expect(SETTINGS_NAV_ITEMS.find((item) => item.id === 'computer-use')?.label).toBe('Computer Use');
  });
});

describe('ComputerUseSection on macOS (PAN-5463)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  const MAC_CHECKS = (screenRecording: 'ok' | 'action'): ComputerUseStatusView['checks'] => [
    { id: 'macos-version', label: 'macOS version', status: 'ok', detail: 'macOS 14.6.1' },
    { id: 'helper', label: 'Overdeck Computer Use helper', status: 'ok', detail: 'Installed' },
    { id: 'accessibility', label: 'Accessibility', status: 'ok', detail: 'Allowed' },
    { id: 'screen-recording', label: 'Screen Recording', status: screenRecording, detail: screenRecording === 'ok' ? 'Allowed' : 'Not allowed' },
    { id: 'handshake', label: 'Helper handshake', status: 'ok', detail: 'Handshake ok' },
  ];

  function macView(overrides: Partial<ComputerUseStatusView> = {}): ComputerUseStatusView {
    return view({ platform: 'darwin', session: { ok: true, label: 'macOS 14.6.1' }, checks: MAC_CHECKS('ok'), ...overrides });
  }

  const MAC_STEPS: ComputerUseStatusView['setupSteps'] = [
    { id: 'install-packages', label: 'Install the Overdeck Computer Use helper' },
    { id: 'grant-permissions', label: 'Allow Accessibility and Screen Recording' },
    { id: 'enable-flag', label: 'Turn on Computer Use' },
    { id: 'test-helper', label: 'Test the helper' },
  ];

  it('describes the helper install and the two permission pages when off (ac1)', async () => {
    serveStatus(macView({ setupSteps: MAC_STEPS }));
    renderSection();
    expect(
      await screen.findByText(
        'Setup installs the Overdeck Computer Use helper and opens two macOS permission pages. Switch on Overdeck Computer Use in each, then press Continue.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('computer-use-password-note')).toHaveTextContent('No password needed.');
  });

  it('shows a waiting step message in amber and a Continue button (ac2)', async () => {
    const status = macView({ setupSteps: MAC_STEPS });
    serveStatus(status, ({ method, url }) => {
      if (method === 'POST' && url === '/api/computer-use/setup') {
        return Response.json({
          ok: false,
          steps: [
            { id: 'install-packages', label: 'Install the Overdeck Computer Use helper', status: 'done' },
            {
              id: 'grant-permissions',
              label: 'Allow Accessibility and Screen Recording',
              status: 'waiting',
              message: 'Switch on "Overdeck Computer Use" in the two System Settings pages that opened, then press Continue.',
            },
          ],
          status,
        });
      }
      return undefined;
    });
    renderSection();
    await act(async () => { fireEvent.click(await screen.findByTestId('computer-use-cta')); });

    await waitFor(() => expect(screen.getByTestId('computer-use-cta')).toHaveTextContent('Continue'));
    const message = screen.getByText(/Switch on "Overdeck Computer Use" in the two System Settings pages/);
    expect(message.className).toContain('text-warning-foreground');
    expect(screen.getByTestId('computer-use-badge')).toHaveTextContent('Waiting');
  });

  it('flags a missing permission when on and opens its settings pane (ac3)', async () => {
    const status = macView({ enabled: true, checks: MAC_CHECKS('action'), setupSteps: [] });
    const { fetchMock } = serveStatus(status, ({ method, url }) => {
      if (method === 'POST' && url === '/api/computer-use/open-permission') return Response.json(status);
      return undefined;
    });
    renderSection();

    expect(await screen.findByTestId('computer-use-badge')).toHaveTextContent('Needs attention');
    expect(screen.getByTestId('computer-use-mac-regrant')).toHaveTextContent('macOS asks you to allow the updated helper again.');
    expect(screen.getByTestId('computer-use-cta')).toHaveTextContent('Fix setup');
    await act(async () => { fireEvent.click(screen.getByTestId('computer-use-open-screen-recording')); });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/computer-use/open-permission',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ id: 'screen-recording' }) }),
      ),
    );
  });

  it('shows both permissions as Allowed and Ready when everything is ok (ac4)', async () => {
    serveStatus(macView({ enabled: true, setupSteps: [] }));
    renderSection();
    expect(await screen.findByTestId('computer-use-badge')).toHaveTextContent('Ready');
    expect(screen.getByTestId('computer-use-permission-accessibility')).toHaveTextContent('Allowed');
    expect(screen.getByTestId('computer-use-permission-screen-recording')).toHaveTextContent('Allowed');
    expect(screen.queryByTestId('computer-use-mac-regrant')).toBeNull();
  });

  it('shows no macOS permission rows on Linux', async () => {
    serveStatus(view({ enabled: true, setupSteps: [] }));
    renderSection();
    await screen.findByTestId('computer-use-badge');
    expect(screen.queryByTestId('computer-use-mac-permissions')).toBeNull();
  });
});
