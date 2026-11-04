import { CONNECT_PROTOCOL_VERSION, CONNECTOR_LIMIT_MESSAGE, type DirectoryMachine } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createConnectorDirectory,
  machineInDirectory,
  waitDirectoryOnline,
} from '../../../../../src/lib/mcp/connector/directory.js';
import type { ConnectorAccount, ConnectorIdentity } from '../../../../../src/lib/mcp/connector/home.js';

const TOKEN = `odd_${'a1'.repeat(32)}`;

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  protocol = '';
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.protocol = this.protocols[0] ?? '';
    this.readyState = 1;
    this.emit('open', {});
  }

  receive(data: unknown): void {
    this.emit('message', { data: JSON.stringify(data) });
  }

  serverClose(code: number): void {
    this.readyState = 3;
    this.emit('close', { code });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const MACHINE: DirectoryMachine = {
  environmentId: 'env-1',
  label: 'studio',
  publicKeyHex: 'ab'.repeat(32),
  fingerprint: 'abab-abab-abab-abab-abab',
  online: true,
  lastSeenAt: '2026-11-04T00:00:00.000Z',
  serverVersion: '0.73.1',
  endpoints: [],
};

const ACCOUNT: ConnectorAccount = {
  v: 1,
  baseUrl: 'https://account.example',
  directoryUrl: 'https://connect.example',
  accessToken: TOKEN,
  deviceId: 'dev-1',
  label: 'brave-otter',
  githubLogin: 'octo',
  signedInAt: '2026-11-04T00:00:00.000Z',
};

const IDENTITY: ConnectorIdentity = {
  v: 1,
  clientId: '0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9',
  linkPublicKey: '1'.repeat(64),
  linkSecretKey: '2'.repeat(64),
  installPublicKey: '3'.repeat(64),
  installSecretKey: '4'.repeat(64),
};

function connectorDirectory() {
  return createConnectorDirectory({
    account: ACCOUNT,
    identity: IDENTITY,
    label: 'bot box',
    appVersion: '0.74.0',
    WebSocket: FakeSocket as unknown as typeof WebSocket,
  });
}

function latest(): FakeSocket {
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error('no socket opened');
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createConnectorDirectory', () => {
  it('opens the directory socket with the bearer subprotocol and says hello-client as a node client', async () => {
    const directory = connectorDirectory();
    await directory.start();
    const socket = latest();
    expect(socket.url).toBe('wss://connect.example/v1/directory');
    expect(socket.protocols).toEqual([`overdeck.bearer.${TOKEN}`]);
    socket.open();
    const hello = JSON.parse(socket.sent[0] ?? '{}') as Record<string, unknown>;
    expect(hello).toMatchObject({
      type: 'hello-client',
      platform: 'node',
      clientId: IDENTITY.clientId,
      publicKeyHex: IDENTITY.installPublicKey,
      label: 'bot box',
      appVersion: '0.74.0',
    });
    directory.stop();
  });
});

describe('waitDirectoryOnline', () => {
  it('resolves on welcome-client', async () => {
    const directory = connectorDirectory();
    await directory.start();
    const online = waitDirectoryOnline(directory);
    latest().open();
    latest().receive({ type: 'welcome-client', protocol: CONNECT_PROTOCOL_VERSION, plan: 'free', relayAllowed: false, machines: [MACHINE] });
    await expect(online).resolves.toBeUndefined();
    directory.stop();
  });

  it('rejects after 15 s without a welcome', async () => {
    const directory = connectorDirectory();
    await directory.start();
    latest().open();
    const online = waitDirectoryOnline(directory);
    const assertion = expect(online).rejects.toThrow('Could not reach the overdeck.ai directory within 15 s');
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    directory.stop();
  });

  it('rejects with the connector limit message on close 4013', async () => {
    const directory = connectorDirectory();
    await directory.start();
    const online = waitDirectoryOnline(directory);
    latest().open();
    latest().serverClose(4013);
    await expect(online).rejects.toThrow(CONNECTOR_LIMIT_MESSAGE);
    directory.stop();
  });
});

describe('machineInDirectory', () => {
  it('names a machine outside this account', () => {
    expect(machineInDirectory({ machines: [MACHINE] }, 'env-9')).toEqual({
      ok: false,
      error:
        'This connector is signed in to an overdeck.ai account that does not include machine env-9. Sign in with the account the machine uses: pan mcp connector logout, then login.',
    });
  });

  it('names an offline machine', () => {
    expect(machineInDirectory({ machines: [{ ...MACHINE, online: false }] }, 'env-1')).toEqual({
      ok: false,
      error: 'studio is offline in the overdeck.ai directory.',
    });
  });

  it('returns an online machine', () => {
    expect(machineInDirectory({ machines: [MACHINE] }, 'env-1')).toEqual({ ok: true, machine: MACHINE });
  });
});
