/**
 * The link supervisor's dynamic routes from the overdeck.ai directory (PRD PAN-2356 D-2356-7).
 *
 * A linked machine gets directory routes only while the directory lists it online with the same
 * public key the link pinned; the directory never vouches for a key (D-18). The routes are
 * `rtc://<id>` (direct), `rtc+turn://<id>` (relay, when the plan includes it) and the addresses the
 * peer published to the directory, all with source `directory`. They are never written to
 * machine-links.json.
 */
import type { DirectoryMachine } from '@overdeck/contracts';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { type LinkRoute, parseRouteUrl } from '../../../lib/anywhere/routes.js';

export interface DirectoryView {
  isOnline(): boolean;
  relayEntitled(): boolean;
  machine(environmentId: string): DirectoryMachine | null;
}

export function directoryRoutesFor(link: MachineLink, directory: DirectoryView | null): LinkRoute[] {
  if (!directory?.isOnline()) return [];
  const peer = directory.machine(link.environmentId);
  if (!peer || !peer.online || peer.publicKeyHex !== link.machineKey) return [];
  const addedAt = peer.lastSeenAt;
  const routes: LinkRoute[] = [];
  for (const endpoint of peer.endpoints) {
    try {
      const parsed = parseRouteUrl(endpoint.url);
      if (parsed.transport !== 'rtc') routes.push({ url: parsed.url, kind: endpoint.kind, source: 'directory', addedAt });
    } catch {
      // A malformed address from the directory is skipped, not trusted.
    }
  }
  routes.push({ url: `rtc://${link.environmentId}`, kind: 'direct', source: 'directory', addedAt });
  if (directory.relayEntitled()) routes.push({ url: `rtc+turn://${link.environmentId}`, kind: 'relay', source: 'directory', addedAt });
  return routes;
}
