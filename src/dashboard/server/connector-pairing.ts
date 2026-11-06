/**
 * Connector pairing intents (PAN-4927 W-CONN1; PAN-4949 D-6, D-7).
 *
 * "Connect a bot" issues an ordinary one-time `odp_` pairing code and notes,
 * by the code's pairingId, that it was issued for an Overdeck connector with
 * the operator's chosen name and scopes. The connector exchange takes that
 * intent; the browser, machine and phone exchanges check for it and refuse a
 * connector code.
 *
 * Intents live only in this process's memory, like the codes themselves, so a
 * dashboard restart drops both together. An intent expires with its code (10
 * minutes) but is kept one more TTL, so a lapsed connector code still never
 * pairs anything else; it is pruned on the next issue after that.
 */
import { pairingSecrets } from '@overdeck/anywhere-channel';
import { nodeCrypto } from '@overdeck/anywhere-channel/node';
import { buildConnectorPairLink } from '@overdeck/contracts';

import type { AccessTokenScope } from '../../lib/access-token-records.js';
import { ensureMachineKey, publicKeyHex } from '../../lib/anywhere/machine-key.js';
import { ensureEnvironmentIdentity } from '../../lib/environment-identity.js';
import { issuePairingCredential, PAIRING_CREDENTIAL_TTL_MS } from './pairing-credentials.js';

export interface ConnectorPairingIntent {
  name: string;
  scopes: AccessTokenScope[];
  /** Epoch ms; the code's own expiry. */
  expiresAt: number;
}

/** pairingId → intent. */
const intents = new Map<string, ConnectorPairingIntent>();

function prune(now: number): void {
  for (const [pairingId, intent] of intents) {
    if (now > intent.expiresAt + PAIRING_CREDENTIAL_TTL_MS) intents.delete(pairingId);
  }
}

/** Issue a pairing code for a connector and remember its intent by pairingId (10-minute expiry). */
export async function issueConnectorPairing(input: { name: string; scopes: readonly AccessTokenScope[] }): Promise<{ pairingString: string; expiresAt: string }> {
  const identity = await ensureEnvironmentIdentity();
  const machineKeyHex = publicKeyHex(await ensureMachineKey());
  prune(Date.now());
  const issued = issuePairingCredential();
  const { pairingId } = pairingSecrets(nodeCrypto, issued.credential);
  intents.set(pairingId, { name: input.name, scopes: [...input.scopes], expiresAt: Date.parse(issued.expiresAt) });
  const pairingString = buildConnectorPairLink({ environmentId: identity.environmentId, machineKeyHex, code: issued.credential, machineLabel: identity.label });
  return { pairingString, expiresAt: issued.expiresAt };
}

/** Remove and return the intent of `pairingId` when it has not expired; null otherwise. Every call removes it. */
export function takeConnectorIntent(pairingId: string): ConnectorPairingIntent | null {
  const intent = intents.get(pairingId);
  intents.delete(pairingId);
  if (intent === undefined || Date.now() > intent.expiresAt) return null;
  return intent;
}

/** True when `pairingId` was issued for a connector (expired or not). Never removes it. */
export function hasConnectorIntent(pairingId: string): boolean {
  return intents.has(pairingId);
}

/** True when the raw `odp_` code was issued for a connector. */
export function isConnectorCode(code: string): boolean {
  return hasConnectorIntent(pairingSecrets(nodeCrypto, code).pairingId);
}

/** Test-only: forget every intent. */
export function _resetConnectorPairingForTests(): void {
  intents.clear();
}
