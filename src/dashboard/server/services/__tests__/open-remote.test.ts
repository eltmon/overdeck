/** PAN-4650 WI-20: Open in editor launches `code --remote ssh-remote+<host> <cwd>` with the cwd from the cache. */
import { HttpServerResponse } from 'effect/unstable/http';
import { describe, expect, it, vi } from 'vitest';
import type { SharedConversationRow } from '@overdeck/contracts';

import type { LinkRoute } from '../../../../lib/anywhere/routes.js';
import type { MachineLink } from '../../../../lib/anywhere/link-store.js';
import { handleLinkedOpenInEditor } from '../../routes/linked-open.js';
import { resolveRemoteEditorLaunch, sshHostFor, sshRemoteAuthority } from '../open-remote.js';

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

  it('prefers the tailnet /ws/link route, then any tailnet route; an ssh route never counts (PAN-4859)', () => {
    expect(sshHostFor(link([route('wss://desk.tail1234.ts.net/ws/link', 'tailnet'), route('tcp://desk-ssh:22', 'ssh')]))).toBe('desk.tail1234.ts.net');
    expect(sshHostFor(link([route('tcp://100.64.0.2:3011', 'tailnet'), route('wss://desk.tail1234.ts.net/ws/link', 'tailnet')]))).toBe('desk.tail1234.ts.net');
    expect(sshHostFor(link([route('tcp://100.64.0.2:3011', 'tailnet')]))).toBe('100.64.0.2');
  });

  it('an ssh route is a local forward and never produces an editor host (PAN-4859 issue repro)', () => {
    const sshOnly = link([route('tcp://127.0.0.1:40123', 'ssh')]);
    expect(resolveRemoteEditorLaunch({ editor: 'vscode', link: sshOnly, cwd: '/home/root/project' })).toEqual({ error: 'no-ssh-host' });
  });

  it('uses the SSH machine record destination as the authority, hex-encoded when needed (PAN-4859)', () => {
    const sshOnly = link([route('tcp://127.0.0.1:40123', 'ssh')]);
    expect(
      resolveRemoteEditorLaunch({ editor: 'vscode', link: sshOnly, cwd: '/home/root/project', sshDestination: 'ssh://root@build-box:2222' }),
    ).toEqual({
      command: 'code',
      args: [
        '--remote',
        'ssh-remote+7b22686f73744e616d65223a226275696c642d626f78222c2275736572223a22726f6f74222c22706f7274223a323232327d',
        '/home/root/project',
      ],
    });
  });

  it('the record destination wins over a tailnet route when both are present (PAN-4859)', () => {
    const both = link([route('tcp://127.0.0.1:40123', 'ssh'), route('wss://desk.tail1234.ts.net/ws/link', 'tailnet')]);
    expect(resolveRemoteEditorLaunch({ editor: 'vscode', link: both, cwd: '/p', sshDestination: 'root@build-box' })).toMatchObject({
      args: ['--remote', 'ssh-remote+root@build-box', '/p'],
    });
    expect(resolveRemoteEditorLaunch({ editor: 'vscode', link: both, cwd: '/p' })).toMatchObject({
      args: ['--remote', 'ssh-remote+desk.tail1234.ts.net', '/p'],
    });
  });

  it('ac3: the route launches with the cwd from the cache row, not the body', async () => {
    const launch = vi.fn();
    const row = { cwd: '/home/desk/overdeck' } as SharedConversationRow;
    const response = await handleLinkedOpenInEditor(
      { conversation: '@desk/conv-x', editor: 'vscode', cwd: '/etc' },
      { getLink: async () => TAILNET, getLinked: () => ({ id: 1, environmentId: 'env-desk', name: 'conv-x', row, nativeSessionId: null, cachedAt: '', listHash: '' }), getSshMachine: async () => null, launch },
    );
    expect(response.status).toBe(200);
    expect(launch).toHaveBeenCalledWith('code', ['--remote', 'ssh-remote+desk.tail1234.ts.net', '/home/desk/overdeck']);
    expect(JSON.parse(await HttpServerResponse.toWeb(response).text())).toMatchObject({ commandLine: 'code --remote ssh-remote+desk.tail1234.ts.net /home/desk/overdeck' });
  });

  it('refuses a shared cwd that is not an absolute path, so it never becomes an editor flag', async () => {
    const launch = vi.fn();
    for (const cwd of ['--folder-uri=x', 'relative/dir', '']) {
      const row = { cwd } as SharedConversationRow;
      const response = await handleLinkedOpenInEditor(
        { conversation: '@desk/conv-x', editor: 'vscode' },
        { getLink: async () => TAILNET, getLinked: () => ({ id: 1, environmentId: 'env-desk', name: 'conv-x', row, nativeSessionId: null, cachedAt: '', listHash: '' }), getSshMachine: async () => null, launch },
      );
      expect(response.status).toBe(409);
    }
    expect(launch).not.toHaveBeenCalled();
  });

  it('an SSH-linked machine launches with the destination authority, never 127.0.0.1 (PAN-4859)', async () => {
    const launch = vi.fn();
    const sshLink = link([route('tcp://127.0.0.1:40123', 'ssh')]);
    const row = { cwd: '/home/desk/overdeck' } as SharedConversationRow;
    const getSshMachine = vi.fn(async () => ({
      id: 'ssh-1',
      destination: 'ssh://root@build-box:2222',
      linkId: 'link-desk',
      environmentId: 'env-desk',
      localPort: 40123,
      remotePort: 22,
      launch: 'managed' as const,
      panPath: null,
      forwardPid: null,
      addedAt: '2026-11-01T00:00:00.000Z',
    }));
    const response = await handleLinkedOpenInEditor(
      { conversation: '@desk/conv-x', editor: 'vscode' },
      { getLink: async () => sshLink, getLinked: () => ({ id: 1, environmentId: 'env-desk', name: 'conv-x', row, nativeSessionId: null, cachedAt: '', listHash: '' }), getSshMachine, launch },
    );
    expect(response.status).toBe(200);
    expect(getSshMachine).toHaveBeenCalledWith('link-desk');
    const authority = '7b22686f73744e616d65223a226275696c642d626f78222c2275736572223a22726f6f74222c22706f7274223a323232327d';
    expect(launch).toHaveBeenCalledWith('code', ['--remote', `ssh-remote+${authority}`, '/home/desk/overdeck']);
    const text = await HttpServerResponse.toWeb(response).text();
    expect(text).not.toContain('127.0.0.1');
  });

  it('answers no-ssh-host with the SSH-machine-aware message when there is no record and no tailnet route (PAN-4859)', async () => {
    const launch = vi.fn();
    const sshLink = link([route('tcp://127.0.0.1:40123', 'ssh')]);
    const row = { cwd: '/home/desk/overdeck' } as SharedConversationRow;
    const response = await handleLinkedOpenInEditor(
      { conversation: '@desk/conv-x', editor: 'vscode' },
      { getLink: async () => sshLink, getLinked: () => ({ id: 1, environmentId: 'env-desk', name: 'conv-x', row, nativeSessionId: null, cachedAt: '', listHash: '' }), getSshMachine: async () => null, launch },
    );
    expect(response.status).toBe(409);
    const body = JSON.parse(await HttpServerResponse.toWeb(response).text()) as { error: string; code: string };
    expect(body.code).toBe('no-ssh-host');
    expect(body.error).toBe('desk has no SSH host (not an SSH machine and no tailnet route)');
    expect(launch).not.toHaveBeenCalled();
  });
});

describe('sshRemoteAuthority (PAN-4859)', () => {
  it.each([
    ['build-box', 'build-box'],
    ['root@build-box', 'root@build-box'],
    ['ssh://root@build-box', 'root@build-box'],
    [
      'ssh://root@build-box:2222',
      '7b22686f73744e616d65223a226275696c642d626f78222c2275736572223a22726f6f74222c22706f7274223a323232327d',
    ],
    ['ssh://build-box:2222', '7b22686f73744e616d65223a226275696c642d626f78222c22706f7274223a323232327d'],
    ['[::1]', '7b22686f73744e616d65223a223a3a31227d'],
    [
      'ssh://me@[fd00::5]:2200',
      '7b22686f73744e616d65223a22666430303a3a35222c2275736572223a226d65222c22706f7274223a323230307d',
    ],
  ] as const)('encodes %s as %s', (destination, authority) => {
    expect(sshRemoteAuthority(destination)).toBe(authority);
  });

  it('encodes an uppercase user as hex that round-trips to the object', () => {
    const authority = sshRemoteAuthority('Admin@build-box');
    expect(JSON.parse(Buffer.from(authority, 'hex').toString())).toEqual({ hostName: 'build-box', user: 'Admin' });
  });

  it('every hex vector round-trips through Buffer.from(x, "hex")', () => {
    const vectors: Array<[string, Record<string, unknown>]> = [
      ['ssh://root@build-box:2222', { hostName: 'build-box', user: 'root', port: 2222 }],
      ['ssh://build-box:2222', { hostName: 'build-box', port: 2222 }],
      ['[::1]', { hostName: '::1' }],
      ['ssh://me@[fd00::5]:2200', { hostName: 'fd00::5', user: 'me', port: 2200 }],
    ];
    for (const [destination, expected] of vectors) {
      const authority = sshRemoteAuthority(destination);
      expect(JSON.parse(Buffer.from(authority, 'hex').toString())).toEqual(expected);
    }
  });
});
