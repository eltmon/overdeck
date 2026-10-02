/** PAN-4437 WI-7: the Continue here dialog's states and the POSTs it sends. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../lib/wsTransport', () => ({
  ensureDashboardSession: vi.fn().mockResolvedValue(undefined),
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'content-type': 'application/json' }),
}));

import { VaultContinueDialog, type ContinuePreview } from '../VaultContinueDialog';
import { useAddProjectDialog } from '../../project/new/addProjectDialogStore';

const VAULT_ID = 'abcdef12-3456-4789-8abc-def012345678';
const TOKEN = '0123456789abcdef';

const clean: ContinuePreview = {
  vaultId: VAULT_ID,
  title: 'Fix the parser',
  harness: 'claude-code',
  resumable: true,
  ownerLabel: 'machine-a',
  ownerToken: TOKEN,
  ownedHere: false,
  target: { cwd: '/src/widget', source: 'saved-cwd', projectKey: 'widget', dirty: false, isGit: true },
  noTargetReason: null,
  clone: null,
  wip: { kind: 'captured', at: '2026-09-30T10:00:00.000Z', bytes: 2048, branch: 'main', base: 'b'.repeat(40) },
  codePlacement: 'in-place',
  drift: [],
  savedCwd: '/src/widget',
};

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const fetchMock = vi.fn();

function routes(preview: ContinuePreview, post: Response = json({ conversation: { name: '20260930-abcd', title: 't', cwd: '/src/widget' }, codeApplied: true, workspacePath: null })) {
  fetchMock.mockImplementation((url: string) => {
    if (url.endsWith('/continue-preview')) return Promise.resolve(json(preview));
    if (url.endsWith('/continue')) return Promise.resolve(post);
    return Promise.resolve(json({}));
  });
}

function renderDialog() {
  const onContinued = vi.fn();
  const onClose = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <VaultContinueDialog vaultId={VAULT_ID} onClose={onClose} onContinued={onContinued} />
    </QueryClientProvider>,
  );
  return { onContinued, onClose };
}

function postedBody(): unknown {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/continue'));
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  useAddProjectDialog.getState().hide();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('VaultContinueDialog (PAN-4437)', () => {
  it('a clean preview continues with one click, posting the owner token', async () => {
    const user = userEvent.setup();
    routes(clean);
    const { onContinued, onClose } = renderDialog();
    expect(await screen.findByText('/src/widget')).toBeInTheDocument();
    expect(screen.getByText('Apply the code snapshot from 2026-09-30T10:00:00.000Z (2.0 KB) here. Branch: main.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue here' }));
    await waitFor(() => expect(onContinued).toHaveBeenCalledWith('20260930-abcd'));
    expect(postedBody()).toEqual({ expectedOwnerToken: TOKEN });
    expect(onClose).toHaveBeenCalled();
  });

  it('a drift preview offers three choices and "Continue with a note" posts onDrift note', async () => {
    const user = userEvent.setup();
    routes({ ...clean, wip: { kind: 'none' }, codePlacement: 'none', drift: ['branch'] });
    renderDialog();
    expect(await screen.findByText('The working directory differs from where this conversation was saved: branch.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue with a note' }));
    await waitFor(() => expect(postedBody()).toEqual({ expectedOwnerToken: TOKEN, onDrift: 'note' }));
  });

  it('a lost race shows "Already continued on <label>."', async () => {
    const user = userEvent.setup();
    routes(clean, json({ code: 'already-continued', label: 'laptop-b', error: 'Already continued on laptop-b.', codeAppliedAt: null }, 409));
    const { onContinued } = renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Continue here' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Already continued on laptop-b.');
    expect(onContinued).not.toHaveBeenCalled();
  });

  it('a 409 drift re-renders the drift step with the returned fields', async () => {
    const user = userEvent.setup();
    routes(clean, json({ code: 'drift', fields: ['head'], error: 'drift' }, 409));
    renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Continue here' }));
    expect(await screen.findByRole('button', { name: 'Continue with a note' })).toBeInTheDocument();
    expect(screen.getByText(/differs from where this conversation was saved: head\./)).toBeInTheDocument();
  });

  it('the clone offer opens Add-project in clone mode with the URL', async () => {
    const user = userEvent.setup();
    routes({ ...clean, target: null, noTargetReason: 'clone-offered', clone: { url: 'https://github.com/acme/widget.git', slug: 'acme/widget' }, codePlacement: 'none' });
    renderDialog();
    expect(await screen.findByText('No registered project matches acme/widget.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clone and register acme/widget' }));
    const state = useAddProjectDialog.getState();
    expect(state).toMatchObject({ open: true, mode: 'clone', initialUrl: 'https://github.com/acme/widget.git' });
    expect(state.onCreatedExtra).toBeTypeOf('function');
    // The Add-project modal sits below this one, so this dialog steps aside until it closes.
    await waitFor(() => expect(screen.queryByTestId('vault-continue-dialog')).not.toBeInTheDocument());
    act(() => useAddProjectDialog.getState().hide());
    expect(await screen.findByTestId('vault-continue-dialog')).toBeInTheDocument();
  });

  it('shows a skipped snapshot reason, but not a clean or no-git skip (like the CLI)', async () => {
    routes({ ...clean, wip: { kind: 'skipped', reason: 'too-large' }, codePlacement: 'none' });
    renderDialog();
    expect(await screen.findByText('No code snapshot: skipped (too-large).')).toBeInTheDocument();
    cleanup();
    routes({ ...clean, wip: { kind: 'skipped', reason: 'clean' }, codePlacement: 'none' });
    renderDialog();
    expect(await screen.findByText('/src/widget')).toBeInTheDocument();
    expect(screen.queryByText(/No code snapshot/)).not.toBeInTheDocument();
  });

  it('a dirty checkout explains the new workspace, or why there can be none when it is unregistered', async () => {
    const dirty = { ...clean, target: { ...clean.target!, dirty: true }, codePlacement: 'new-workspace' as const };
    routes(dirty);
    renderDialog();
    expect(await screen.findByText(/goes into a new workspace\./)).toBeInTheDocument();
    cleanup();
    routes({ ...dirty, target: { ...dirty.target, projectKey: null } });
    renderDialog();
    expect(await screen.findByText(/is not a registered project, so no workspace can be created/)).toBeInTheDocument();
    expect(screen.getByText(/pan vault resume abcdef12 --worktree <dir>/)).toBeInTheDocument();
  });

  it('a non-resumable harness explains the CLI path', async () => {
    routes({ ...clean, harness: 'opencode', resumable: false });
    renderDialog();
    expect(await screen.findByText('opencode has no native resume. Run: pan vault resume abcdef12')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue here' })).not.toBeInTheDocument();
  });
});
