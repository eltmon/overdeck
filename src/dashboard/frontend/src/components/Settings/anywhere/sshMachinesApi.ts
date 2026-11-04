/**
 * Client for the SSH machine routes (PAN-4404 WI-11): the same routes
 * `pan machines add-ssh|test-ssh|unlink --keep-server` call. Every fetcher
 * returns `{ status, body }` (see anywhereApi.ts) so the dialog can show the
 * server's error text.
 */
import type { LinkAccess, MachineLinkView, SshMachineErrorCode, SshTestResult } from '@overdeck/contracts';

import { dashboardMutationJsonHeaders } from '../../../lib/wsTransport';
import { apiError, type ApiResult } from './anywhereApi';

export type { SshLinkInfo, SshTestResult } from '@overdeck/contracts';

async function readResult<T>(response: Response): Promise<ApiResult<T>> {
  const body = (await response.json().catch(() => null)) as T | { error?: string } | null;
  return { status: response.status, body };
}

export interface AddSshMachineInput {
  host: string;
  bothWays: boolean;
  panPath?: string;
  access?: LinkAccess;
}

export async function addSshMachine(input: AddSshMachineInput): Promise<ApiResult<MachineLinkView>> {
  return readResult(await fetch('/api/machines/ssh', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(input),
  }));
}

export async function testSshHost(input: { host: string; panPath?: string }): Promise<ApiResult<SshTestResult>> {
  return readResult(await fetch('/api/machines/ssh/test', {
    method: 'POST',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify(input),
  }));
}

export async function fetchSshConfigHosts(): Promise<ApiResult<{ hosts: string[] }>> {
  return readResult(await fetch('/api/machines/ssh/config-hosts'));
}

export interface SshRemoval {
  stopped: boolean;
  reason: string;
}

/** Unlink an SSH-backed link and leave the host's Overdeck server running. */
export async function unlinkMachineKeepingServer(id: string): Promise<ApiResult<{ ok: true; peerNotified: boolean; ssh: SshRemoval | null }>> {
  return readResult(await fetch(`/api/machines/${encodeURIComponent(id)}?keepServer=1`, {
    method: 'DELETE',
    headers: await dashboardMutationJsonHeaders(),
  }));
}

const SSH_ERROR_TEXT: Record<SshMachineErrorCode, string> = {
  'bad-destination': 'That is not an SSH host. Use an SSH config alias, user@host, a host name or ssh://user@host:port.',
  'busy': 'Another add, remove or reconnect for this host is running. Try again when it finishes.',
  'unresolvable': 'This machine could not resolve the host name.',
  'unreachable': 'This machine could not connect to the host over SSH.',
  'host-key': 'The host key is unknown or has changed. Run ssh to this host once in a terminal on this machine, then try again.',
  'auth-failed': 'SSH refused the login. The dashboard needs a key or SSH agent it can use without a prompt.',
  'pan-missing': 'pan was not found on the host. Install the same Overdeck version there.',
  'version-mismatch': 'The host has another pan version. Install the same Overdeck version there.',
  'helper-failed': 'Overdeck on the host could not be set up over SSH.',
  'start-failed': 'Overdeck did not start on the host.',
  'forward-failed': 'The SSH port forward to the host did not come up.',
  'self-link': 'That host is this machine.',
  'not-found': 'That SSH machine no longer exists.',
};

/** The sentence for a failed SSH request: the server's message, else the code's text, else the status. */
export function sshErrorText(result: ApiResult<unknown>): string {
  const body = result.body as { error?: string; message?: string } | null;
  if (typeof body?.message === 'string' && body.message !== '') return body.message;
  if (typeof body?.error === 'string' && body.error in SSH_ERROR_TEXT) return SSH_ERROR_TEXT[body.error as SshMachineErrorCode];
  return apiError(result);
}
