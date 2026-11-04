import type { HttpRequest, requestOnChannel, SecureChannel } from '@overdeck/anywhere-channel/web';
import { buildPhonePairLink, type DirectoryMachine } from '@overdeck/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OverdeckKeysWeb } from '../../native/keys-web';
import { ConnectionError } from '../connection';
import { pairMachine, type PairingDeps, PairingError } from '../pairing';
import { readMachines, setKeysPlugin } from '../store';

const ENV = '0b5c6c1e-3f2a-4d8e-9a7b-1c2d3e4f5a6b';
const KEY = 'ab'.repeat(32);
const CODE = 'odp_' + 'cd34'.repeat(16);
const LINK = buildPhonePairLink({ environmentId: ENV, machineKeyHex: KEY, code: CODE });
const IDENTITY = { clientId: '0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9', pushPublicKeyHex: 'ee'.repeat(32) };

const MACHINE: DirectoryMachine = {
  environmentId: ENV,
  label: 'desk',
  publicKeyHex: KEY,
  fingerprint: 'abab-abab-abab-abab-abab',
  online: true,
  lastSeenAt: '2026-11-03T00:00:00.000Z',
  serverVersion: '0.74.0',
  endpoints: [],
};

const descriptor = (overrides: Record<string, unknown> = {}) => ({
  descriptorVersion: 1,
  environmentId: ENV,
  label: 'desk',
  machineKey: KEY,
  capabilities: { pairing: true, deviceSessions: true, terminalAuth: true, phoneApp: true },
  ...overrides,
});

const json = (status: number, value: unknown) => ({
  response: { status, statusText: '', httpVersion: '1.1' as const, headers: [], body: new TextEncoder().encode(JSON.stringify(value)) },
  reusable: true,
  keepAliveTimeoutMs: null,
});

function harness(answers: Array<ReturnType<typeof json>>) {
  const streams: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
  const requests: Array<{ stream: unknown; req: HttpRequest }> = [];
  const openPairing = vi.fn(async () => {
    const stream = { destroy: vi.fn(), destroyed: false };
    streams.push(stream);
    return { stream, channel: { mode: 'pairing' } } as unknown as SecureChannel;
  });
  const request = vi.fn(async (stream: unknown, req: HttpRequest) => {
    requests.push({ stream, req });
    const answer = answers.shift();
    if (!answer) throw new Error('unexpected request');
    return answer;
  }) as unknown as typeof requestOnChannel;
  const deps: PairingDeps = {
    machines: () => [MACHINE],
    connection: { openPairing },
    identity: IDENTITY,
    phoneLabel: 'Pixel 9',
    request,
    now: () => new Date('2026-11-03T12:00:00.000Z'),
  };
  return { deps, openPairing, requests, streams };
}

const exchangeOk = () => json(200, { v: 1, token: 'opt_phone', tokenId: 'tok-1', descriptor: descriptor() });

beforeEach(() => {
  localStorage.clear();
  setKeysPlugin(new OverdeckKeysWeb());
});

describe('pairMachine', () => {
  it('stores a record with a fresh link key per pairing', async () => {
    const first = harness([json(200, descriptor()), exchangeOk()]);
    const a = await pairMachine(LINK, first.deps);
    const second = harness([json(200, descriptor()), exchangeOk()]);
    const b = await pairMachine(LINK, second.deps);

    expect(a).toMatchObject({ environmentId: ENV, label: 'desk', machineKeyHex: KEY, token: 'opt_phone', tokenId: 'tok-1', pairedAt: '2026-11-03T12:00:00.000Z' });
    expect(a.linkPublicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(a.linkSecretKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(b.linkPublicKeyHex).not.toBe(a.linkPublicKeyHex);
    // The second pairing replaced the first record for the same machine.
    expect(await readMachines()).toEqual([b]);
    expect(first.streams[0]!.destroy).toHaveBeenCalled();
  });

  it('refuses a key that does not match the directory before any dial', async () => {
    const h = harness([]);
    h.deps.machines = () => [{ ...MACHINE, publicKeyHex: 'cd'.repeat(32) }];
    await expect(pairMachine(LINK, h.deps)).rejects.toThrow(new PairingError('This code does not match desk in your overdeck.ai account.'));
    expect(h.openPairing).not.toHaveBeenCalled();
  });

  it('refuses a machine missing from the directory and an offline one', async () => {
    const missing = harness([]);
    missing.deps.machines = () => [];
    await expect(pairMachine(LINK, missing.deps)).rejects.toThrow('This machine is not signed in to your overdeck.ai account.');
    const offline = harness([]);
    offline.deps.machines = () => [{ ...MACHINE, online: false }];
    await expect(pairMachine(LINK, offline.deps)).rejects.toThrow('desk is offline. Open Overdeck on it and try again.');
    expect(missing.openPairing).not.toHaveBeenCalled();
    expect(offline.openPairing).not.toHaveBeenCalled();
  });

  it('rejects text that is not a pair link', async () => {
    await expect(pairMachine('https://example.com', harness([]).deps)).rejects.toThrow('That is not an Overdeck pairing code.');
  });

  it('refuses a machine without phoneApp as outdated and sends no exchange', async () => {
    const h = harness([json(200, descriptor({ capabilities: { pairing: true, deviceSessions: true, terminalAuth: true } }))]);
    const error = (await pairMachine(LINK, h.deps).catch((e: unknown) => e)) as ConnectionError;
    expect(error).toBeInstanceOf(ConnectionError);
    expect(error.kind).toBe('outdated');
    expect(h.requests.map((r) => r.req.path)).toEqual(['/api/environment']);
  });

  it('refuses a descriptor whose machine key differs from the link', async () => {
    const h = harness([json(200, descriptor({ machineKey: 'cd'.repeat(32) }))]);
    const error = (await pairMachine(LINK, h.deps).catch((e: unknown) => e)) as ConnectionError;
    expect(error.kind).toBe('identity');
  });

  it('sends both requests on one pairing channel with exactly four exchange fields', async () => {
    const h = harness([json(200, descriptor()), exchangeOk()]);
    await pairMachine(LINK, h.deps);
    expect(h.openPairing).toHaveBeenCalledTimes(1);
    expect(h.openPairing).toHaveBeenCalledWith(ENV, 'desk', CODE, expect.objectContaining({ publicKey: expect.any(Uint8Array) }));
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1]!.stream).toBe(h.requests[0]!.stream);
    const exchange = h.requests[1]!.req;
    expect(exchange.method).toBe('POST');
    expect(exchange.path).toBe('/api/phones/exchange');
    expect(JSON.parse(new TextDecoder().decode(exchange.body))).toEqual({
      v: 1,
      clientId: IDENTITY.clientId,
      label: 'Pixel 9',
      pushKeyHex: IDENTITY.pushPublicKeyHex,
    });
  });

  it('carries notificationPreferences in the exchange body and calls onPreferencesStored when the answer has the flag', async () => {
    const h = harness([json(200, descriptor()), json(200, { v: 1, token: 'opt_phone', tokenId: 'tok-1', descriptor: descriptor(), notificationPreferencesStored: true })]);
    const prefs = { v: 1 as const, pause: null, muted: ['failed' as const] };
    h.deps.notificationPreferences = () => ({ revision: 3, prefs });
    const onPreferencesStored = vi.fn();
    h.deps.onPreferencesStored = onPreferencesStored;
    await pairMachine(LINK, h.deps);
    const exchange = h.requests[1]!.req;
    expect(JSON.parse(new TextDecoder().decode(exchange.body))).toMatchObject({ notificationPreferences: prefs });
    expect(onPreferencesStored).toHaveBeenCalledWith(ENV, 3);
  });

  it('does not call onPreferencesStored when the answer omits the flag', async () => {
    const h = harness([json(200, descriptor()), exchangeOk()]);
    h.deps.notificationPreferences = () => ({ revision: 1, prefs: { v: 1, pause: null, muted: [] } });
    const onPreferencesStored = vi.fn();
    h.deps.onPreferencesStored = onPreferencesStored;
    await pairMachine(LINK, h.deps);
    expect(onPreferencesStored).not.toHaveBeenCalled();
  });

  it('shows the already-paired text on 409 link-key-in-use and opens no second channel', async () => {
    const h = harness([json(200, descriptor()), json(409, { error: 'in use', code: 'link-key-in-use' })]);
    await expect(pairMachine(LINK, h.deps)).rejects.toThrow('This phone is already paired with desk. Remove it on the machine, then pair again.');
    expect(h.openPairing).toHaveBeenCalledTimes(1);
    expect(await readMachines()).toEqual([]);
  });

  it('shows the server error text for another refusal', async () => {
    const h = harness([json(200, descriptor()), json(400, { error: 'label must be a string of 1-64 characters' })]);
    await expect(pairMachine(LINK, h.deps)).rejects.toThrow('label must be a string of 1-64 characters');
  });
});
