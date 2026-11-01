/** PAN-4650 WI-20: Open in editor launches `code --remote ssh-remote+<host> <cwd>` with the cwd from the cache. */
import { HttpServerResponse } from 'effect/unstable/http';
import { describe, expect, it, vi } from 'vitest';
import type { SharedConversationRow } from '@overdeck/contracts';

import type { LinkRoute } from '../../../../lib/anywhere/routes.js';
import type { MachineLink } from '../../../../lib/anywhere/link-store.js';
import { handleLinkedOpenInEditor } from '../../routes/linked-open.js';
import { resolveRemoteEditorLaunch, sshHostFor } from '../open-remote.js';

const route = (url: string, kind: LinkRoute['kind']): LinkRoute => ({ url, kind, source: 'pairing', addedAt: '2026-11-01T00:00:00.000Z' });

function link(routes: LinkRoute[]): MachineLink {
  return {
    id: 'link-desk', environmentId: 'env-desk', label: 'desk', machineKey: 'ab'.repeat(32), token: 'odk_x', access: 'operator',
    reverseTokenId: null, routes, createdAt: '2026-11-01T00:00:00.000Z', revokedAt: null,
  };
}

const TAILNET = link([route('tcp://192.168.1.5:3011', 'lan'), route('wss://desk.tail1234.ts.net/ws/link', 'tailnet')]);

describe('remote editor launch (PAN-4650 WI-20)', () => {
  it('ac1: a tailnet link route yields code --remote ssh-remote+<host> <cwd>', () => {
    expect(resolveRemoteEditorLaunch({ editor: 'vscode', link: TAILNET, cwd: '/home/u/proj' }))
      .toEqual({ command: 'code', args: ['--remote', 'ssh-remote+desk.tail1234.ts.net', '/home/u/proj'] });
    expect(resolveRemoteEditorLaunch({ editor: 'vscodium', link: TAILNET, cwd: '/p' })).toMatchObject({ command: 'codium' });
  });

  it('ac2: lan-only links have no SSH host; Cursor is unsupported', () => {
    expect(resolveRemoteEditorLaunch({ editor: 'vscode', link: link([route('tcp://192.168.1.5:3011', 'lan')]), cwd: '/p' })).toEqual({ error: 'no-ssh-host' });
    expect(resolveRemoteEditorLaunch({ editor: 'cursor', link: TAILNET, cwd: '/p' })).toEqual({ error: 'editor-unsupported' });
  });

  it('prefers an ssh route, then the tailnet /ws/link route, then any tailnet route', () => {
    expect(sshHostFor(link([route('wss://desk.tail1234.ts.net/ws/link', 'tailnet'), route('tcp://desk-ssh:22', 'ssh')]))).toBe('desk-ssh');
    expect(sshHostFor(link([route('tcp://100.64.0.2:3011', 'tailnet'), route('wss://desk.tail1234.ts.net/ws/link', 'tailnet')]))).toBe('desk.tail1234.ts.net');
    expect(sshHostFor(link([route('tcp://100.64.0.2:3011', 'tailnet')]))).toBe('100.64.0.2');
  });

  it('ac3: the route launches with the cwd from the cache row, not the body', async () => {
    const launch = vi.fn();
    const row = { cwd: '/home/desk/overdeck' } as SharedConversationRow;
    const response = await handleLinkedOpenInEditor(
      { conversation: '@desk/conv-x', editor: 'vscode', cwd: '/etc' },
      { getLink: async () => TAILNET, getLinked: () => ({ id: 1, environmentId: 'env-desk', name: 'conv-x', row, nativeSessionId: null, cachedAt: '', listHash: '' }), launch },
    );
    expect(response.status).toBe(200);
    expect(launch).toHaveBeenCalledWith('code', ['--remote', 'ssh-remote+desk.tail1234.ts.net', '/home/desk/overdeck']);
    expect(JSON.parse(await HttpServerResponse.toWeb(response).text())).toMatchObject({ commandLine: 'code --remote ssh-remote+desk.tail1234.ts.net /home/desk/overdeck' });
  });
});
