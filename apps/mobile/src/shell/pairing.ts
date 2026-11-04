/**
 * Pairing with a machine from its pair link (PAN-4837 FR-6, D-6, D-8, C-1).
 *
 * The link is checked against the directory's entry for that machine before any dial. One
 * pairing-mode channel, keyed by the link's `odp_` code and a fresh link key, carries both requests:
 * `GET /api/environment` (the machine must offer the phone app and prove the key in the link) and
 * `POST /api/phones/exchange`. The code is single use (the machine consumes it at the handshake), so
 * nothing is retried on a new channel.
 */
import { generateStaticKeyPair, requestOnChannel, type StaticKeyPair } from '@overdeck/anywhere-channel/web';
import type { DirectoryMachine, EnvironmentDescriptor, PhoneNotificationPreferences } from '@overdeck/contracts';
import { parsePhonePairLink } from '@overdeck/contracts';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { DeviceIdentity } from '../native/keys';
import { ConnectionError, connectionText, type Connection } from './connection';
import { readMachines, useShellStore, writeMachines } from './store';
import type { PairedMachine } from './types';

export const pairingText = {
  notALink: () => 'That is not an Overdeck pairing code.',
  notInDirectory: () => 'This machine is not signed in to your overdeck.ai account.',
  keyMismatch: (label: string) => `This code does not match ${label} in your overdeck.ai account.`,
  offline: (label: string) => `${label} is offline. Open Overdeck on it and try again.`,
  alreadyPaired: (label: string) => `This phone is already paired with ${label}. Remove it on the machine, then pair again.`,
};

export class PairingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PairingError';
  }
}

export interface PairingDeps {
  /** The directory's current machine list. */
  machines(): readonly DirectoryMachine[];
  connection: Pick<Connection, 'openPairing'>;
  identity: DeviceIdentity;
  /** The phone's name, sent as the exchange label. */
  phoneLabel: string;
  /** Defaults to `generateStaticKeyPair` and `requestOnChannel`; tests replace them. */
  generateKey?: () => StaticKeyPair;
  request?: typeof requestOnChannel;
  now?: () => Date;
  /** PAN-5019 WI-6: the phone's current notification preferences, carried in the exchange body. */
  notificationPreferences?: () => { revision: number; prefs: PhoneNotificationPreferences };
  /** Called after the machine record is written when the answer has `notificationPreferencesStored: true`. */
  onPreferencesStored?: (environmentId: string, revision: number) => void;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function parseJson(body: Uint8Array): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(decoder.decode(body));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function exchangeLabel(label: string): string {
  const trimmed = label.trim().slice(0, 64).trim();
  return trimmed.length > 0 ? trimmed : 'Phone';
}

export async function pairMachine(linkText: string, deps: PairingDeps): Promise<PairedMachine> {
  const link = parsePhonePairLink(linkText);
  if (!link) throw new PairingError(pairingText.notALink());
  const entry = deps.machines().find((m) => m.environmentId === link.environmentId);
  if (!entry) throw new PairingError(pairingText.notInDirectory());
  const label = entry.label;
  if (entry.publicKeyHex !== link.machineKeyHex) throw new PairingError(pairingText.keyMismatch(label));
  if (!entry.online) throw new PairingError(pairingText.offline(label));

  const localKey = (deps.generateKey ?? generateStaticKeyPair)();
  const request = deps.request ?? requestOnChannel;
  const { stream } = await deps.connection.openPairing(link.environmentId, label, link.code, localKey);
  try {
    const env = await request(stream, { method: 'GET', path: '/api/environment' });
    const descriptor = env.response.status === 200 ? (parseJson(env.response.body) as EnvironmentDescriptor | null) : null;
    if (descriptor?.capabilities?.phoneApp !== true) throw new ConnectionError('outdated', connectionText.outdated(label));
    if (descriptor.machineKey !== link.machineKeyHex) throw new ConnectionError('identity', connectionText.identity(label));

    const notificationPreferences = deps.notificationPreferences?.();
    const body = {
      v: 1,
      clientId: deps.identity.clientId,
      label: exchangeLabel(deps.phoneLabel),
      pushKeyHex: deps.identity.pushPublicKeyHex,
      ...(notificationPreferences ? { notificationPreferences: notificationPreferences.prefs } : {}),
    };
    const exchange = await request(stream, {
      method: 'POST',
      path: '/api/phones/exchange',
      headers: { 'Content-Type': 'application/json' },
      body: encoder.encode(JSON.stringify(body)),
    });
    const answer = parseJson(exchange.response.body);
    if (exchange.response.status === 409 && answer?.code === 'link-key-in-use') throw new PairingError(pairingText.alreadyPaired(label));
    if (exchange.response.status !== 200) {
      throw new PairingError(typeof answer?.error === 'string' ? answer.error : `${label} refused the pairing (HTTP ${exchange.response.status}).`);
    }
    const answered = answer?.descriptor as EnvironmentDescriptor | undefined;
    if (answered?.machineKey !== link.machineKeyHex) throw new ConnectionError('identity', connectionText.identity(label));
    if (typeof answer?.token !== 'string' || typeof answer.tokenId !== 'string') {
      throw new PairingError(`${label} sent an incomplete pairing answer.`);
    }

    const record: PairedMachine = {
      environmentId: link.environmentId,
      label,
      machineKeyHex: link.machineKeyHex,
      linkPublicKeyHex: bytesToHex(localKey.publicKey),
      linkSecretKeyHex: bytesToHex(localKey.secretKey),
      token: answer.token,
      tokenId: answer.tokenId,
      pairedAt: (deps.now?.() ?? new Date()).toISOString(),
    };
    const machines = [...(await readMachines()).filter((m) => m.environmentId !== record.environmentId), record];
    await writeMachines(machines);
    useShellStore.getState().setMachines(machines);
    if (answer?.notificationPreferencesStored === true && notificationPreferences) {
      deps.onPreferencesStored?.(link.environmentId, notificationPreferences.revision);
    }
    return record;
  } finally {
    stream.destroy();
  }
}
