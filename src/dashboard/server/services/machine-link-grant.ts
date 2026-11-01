/**
 * Mint a machine token for a peer whose key a secure channel proved, and optionally store the link
 * back to it (extracted from the pairing exchange for the approval exchange, PAN-2356 WI-14).
 *
 * D-4645-18: one active machine token per peer environment, so the environment's previous tokens
 * are revoked first. With `reverse`, the peer's token for this machine is stored as a link with
 * routes from the peer's advertised endpoints; a link it replaces gives up its old reverse token.
 */
import type { AdvertisedEndpoint } from '@overdeck/contracts';

import {
  createAccessToken,
  listActiveRecordsOfKind,
  MACHINE_TOKEN_SCOPES,
  type MachineAccess,
  type PublicAccessTokenRecord,
  revokeAccessToken,
} from '../../../lib/access-tokens.js';
import { upsertLink } from '../../../lib/anywhere/link-store.js';
import { type LinkRoute, mergeAdvertised } from '../../../lib/anywhere/routes.js';
import { notifyLinksChanged } from '../routes/machines.js';

export interface GrantMachineLinkInput {
  environmentId: string;
  label: string;
  /** The peer's machine key, 64 hex, as the channel handshake proved it. */
  peerKeyHex: string;
  access: MachineAccess;
  /** The peer's own token for this machine and its advertised endpoints: store the link back. */
  reverse?: { token: string; endpoints: AdvertisedEndpoint[] } | null;
}

export interface GrantMachineLinkResult {
  token: string;
  record: PublicAccessTokenRecord;
  reverseLinkId: string | null;
}

export class GrantMachineLinkError extends Error {}

export async function grantMachineLink(input: GrantMachineLinkInput): Promise<GrantMachineLinkResult> {
  for (const previous of listActiveRecordsOfKind('machine')) {
    if (previous.environmentId === input.environmentId) await revokeAccessToken(previous.id);
  }
  const { token, record } = await createAccessToken({
    name: `machine:${input.label}`,
    kind: 'machine',
    scopes: MACHINE_TOKEN_SCOPES(input.access),
    machineKey: input.peerKeyHex,
    environmentId: input.environmentId,
    access: input.access,
  });

  let reverseLinkId: string | null = null;
  if (input.reverse) {
    const now = new Date().toISOString();
    let routes: LinkRoute[];
    try {
      routes = mergeAdvertised([], input.reverse.endpoints, () => now);
    } catch (error) {
      await revokeAccessToken(record.id);
      throw new GrantMachineLinkError(`reverse.endpoints: ${(error as Error).message}`);
    }
    const { link, replaced } = await upsertLink({
      environmentId: input.environmentId,
      label: input.label,
      machineKey: input.peerKeyHex,
      token: input.reverse.token,
      access: input.access,
      reverseTokenId: record.id,
      routes,
    });
    if (replaced?.reverseTokenId && replaced.reverseTokenId !== record.id) await revokeAccessToken(replaced.reverseTokenId).catch(() => null);
    reverseLinkId = link.id;
    notifyLinksChanged();
  }
  return { token, record, reverseLinkId };
}
