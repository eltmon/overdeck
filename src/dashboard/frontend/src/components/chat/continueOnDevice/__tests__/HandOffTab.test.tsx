/** PAN-4455 WI-8: the "Hand off to another machine" tab. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { AnywhereStatus } from '../../../Settings/anywhere/anywhereApi';
import type { ContinueTarget } from '../continueOnDeviceStore';

const api = vi.hoisted(() => ({ handOffConversation: vi.fn(), openSessionVaultSettings: vi.fn() }));
vi.mock('../continueOnDeviceApi', () => api);

const { HandOffTab } = await import('../HandOffTab');
const { useHandoffNoticeStore } = await import('../handoffNoticeStore');
const { useContinueOnDeviceStore } = await import('../continueOnDeviceStore');

function status(overrides: Partial<AnywhereStatus> = {}): AnywhereStatus {
  return {
    machine: { environmentId: '0f0e0d0c-0000-4000-8000-000000000000', label: 'desk' },
    addresses: [],
    devices: { active: 0 },
    vault: { state: 'ready', backend: 'dir:/x' },
    problems: [],
    viewer: { kind: 'root-session' },
    ...overrides,
  };
}

function target(overrides: Partial<ContinueTarget> = {}): ContinueTarget {
  return { name: 'conv-42', id: 42, title: 'Demo', harness: 'claude-code', sessionAlive: true, viewMode: 'conversation', ...overrides };
}

const SAVED = {
  result: 'saved',
  vaultId: '12345678-aaaa-4bbb-8ccc-dddddddddddd',
  version: 3,
  savedAt: '2026-10-01T10:00:00.000Z',
  title: 'Demo',
  machineLabel: 'desk',
  logLines: 12,
  alreadySaved: false,
  forkedFrom: null,
  wipProblem: null,
};

describe('HandOffTab (PAN-4455 WI-8)', () => {
  beforeEach(() => {
    api.handOffConversation.mockReset();
    api.openSessionVaultSettings.mockReset();
    useHandoffNoticeStore.setState({ notices: {} });
  });

  it('saved: names the version, the title and the machine, and records the composer notice', async () => {
    api.handOffConversation.mockResolvedValue({ status: 200, body: SAVED });
    const user = userEvent.setup();
    render(<HandOffTab target={target()} status={status()} />);
    await user.click(screen.getByRole('button', { name: 'Hand off now' }));
    const result = await screen.findByTestId('handoff-result');
    expect(result.textContent).toMatch(/Saved as version 3 at/);
    expect(result.textContent).toContain('open "Demo" from desk and click Continue here.');
    expect(api.handOffConversation).toHaveBeenCalledWith('conv-42');
    expect(useHandoffNoticeStore.getState().notices['conv-42']).toEqual({ at: '2026-10-01T10:00:00.000Z' });
  });

  it('saved for a stopped conversation records no notice', async () => {
    api.handOffConversation.mockResolvedValue({ status: 200, body: SAVED });
    const user = userEvent.setup();
    render(<HandOffTab target={target({ sessionAlive: false })} status={status()} />);
    await user.click(screen.getByRole('button', { name: 'Hand off now' }));
    await screen.findByTestId('handoff-result');
    expect(useHandoffNoticeStore.getState().notices).toEqual({});
  });

  it('saved as a fork says it is a separate copy', async () => {
    api.handOffConversation.mockResolvedValue({ status: 200, body: { ...SAVED, forkedFrom: { vaultId: 'v0', version: 2 } } });
    const user = userEvent.setup();
    render(<HandOffTab target={target()} status={status()} />);
    await user.click(screen.getByRole('button', { name: 'Hand off now' }));
    expect((await screen.findByTestId('handoff-result')).textContent).toMatch(/as a separate copy, because another machine already continued this conversation/);
  });

  it('blocked: shows each line and its allow-secret command, never "Saved as version"', async () => {
    api.handOffConversation.mockResolvedValue({
      status: 422,
      body: {
        result: 'blocked',
        error: 'Not saved: the secret scan blocked line 7 (aws-access-key).',
        hits: [{ line: 7, pattern: 'aws-access-key' }],
        fixes: ['pan vault allow-secret /tmp/t.jsonl 7'],
      },
    });
    const user = userEvent.setup();
    render(<HandOffTab target={target()} status={status()} />);
    await user.click(screen.getByRole('button', { name: 'Hand off now' }));
    expect(await screen.findByText('line 7: aws-access-key')).toBeInTheDocument();
    expect(screen.getByText('pan vault allow-secret /tmp/t.jsonl 7')).toBeInTheDocument();
    expect(screen.queryByText(/Saved as version/)).toBeNull();
    expect(useHandoffNoticeStore.getState().notices).toEqual({});
  });

  it('saved with a code-snapshot problem: no "Saved as version", the problem and its fix, no notice', async () => {
    api.handOffConversation.mockResolvedValue({
      status: 200,
      body: { ...SAVED, wipProblem: { message: 'The code snapshot is 30.0 MB, over the Session Vault size limit (wipMaxBytes).', fix: 'Commit and push the work.' } },
    });
    const user = userEvent.setup();
    render(<HandOffTab target={target()} status={status()} />);
    await user.click(screen.getByRole('button', { name: 'Hand off now' }));
    expect(await screen.findByText('The conversation was saved (version 3), but its code snapshot was not.')).toBeInTheDocument();
    expect(screen.getByText(/30\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText('Commit and push the work.')).toBeInTheDocument();
    expect(screen.queryByText(/Saved as version/)).toBeNull();
    expect(useHandoffNoticeStore.getState().notices).toEqual({});
  });

  it('offline: shows the error and the pan vault save fix', async () => {
    api.handOffConversation.mockResolvedValue({ status: 422, body: { result: 'offline', error: 'Not saved: the vault backend could not be reached.', fix: 'pan vault save /tmp/t.jsonl' } });
    const user = userEvent.setup();
    render(<HandOffTab target={target()} status={status()} />);
    await user.click(screen.getByRole('button', { name: 'Hand off now' }));
    expect(await screen.findByText('pan vault save /tmp/t.jsonl')).toBeInTheDocument();
  });

  it('an unexpected response shows the status', async () => {
    api.handOffConversation.mockResolvedValue({ status: 502, body: null });
    const user = userEvent.setup();
    render(<HandOffTab target={target()} status={status()} />);
    await user.click(screen.getByRole('button', { name: 'Hand off now' }));
    expect(await screen.findByText('Hand-off failed (502).')).toBeInTheDocument();
  });

  it('vault off: Set up opens Session Vault settings and closes the dialog; the route is never called', async () => {
    useContinueOnDeviceStore.setState({ target: target() });
    const user = userEvent.setup();
    render(<HandOffTab target={target()} status={status({ vault: { state: 'off', backend: null } })} />);
    expect(screen.queryByRole('button', { name: 'Hand off now' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Set up' }));
    expect(api.openSessionVaultSettings).toHaveBeenCalledTimes(1);
    expect(useContinueOnDeviceStore.getState().target).toBeNull();
    expect(api.handOffConversation).not.toHaveBeenCalled();
  });

  it('vault locked: Open Session Vault; rotation pending: a docs link; never Hand off now', () => {
    const { unmount } = render(<HandOffTab target={target()} status={status({ vault: { state: 'locked', backend: 'b' } })} />);
    expect(screen.getByRole('button', { name: 'Open Session Vault' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hand off now' })).toBeNull();
    unmount();
    render(<HandOffTab target={target()} status={status({ vault: { state: 'rotation-pending', backend: 'b' } })} />);
    expect(screen.getByRole('link', { name: 'How to finish it' })).toHaveAttribute('href', 'https://overdeck.ai/configuration/session-vault');
    expect(api.handOffConversation).not.toHaveBeenCalled();
  });

  it('an unsupported harness names it and never offers Hand off now', () => {
    render(<HandOffTab target={target({ harness: 'ohmypi' })} status={status()} />);
    expect(screen.getByText('Hand-off works for Claude Code and Codex conversations. This conversation runs on ohmypi.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hand off now' })).toBeNull();
    expect(api.handOffConversation).not.toHaveBeenCalled();
  });
});
