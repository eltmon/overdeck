/**
 * Linked conversations in the dashboard (PAN-4650 WI-8, FR-3).
 *
 * A linked row is a conversation another machine owns. Its `name` is the
 * linked name `@<environmentId>/<ownerName>`, so every REST call that builds
 * `/api/conversations/${name}/…` reaches the owner through this server's
 * proxy unchanged. Its `id` is negative and unstable, so API paths and
 * routes use the name, never the id. Live streams and terminals go over the
 * linked WebSocket pipes (`/ws/linked/<env>/rpc|terminal`).
 */
import { parseLinkedConversationName } from '@overdeck/contracts';

import { rpcUrlWithPath, WsTransport, getTransport, type TransportPool } from './wsTransport';

export function isLinkedConversation(conv: { origin?: string } | null | undefined): boolean {
  return conv?.origin === 'linked';
}

/** The name a conversation's API paths use: the linked name for linked rows, else the local name. */
export function conversationApiName(conv: { name: string }): string {
  return conv.name;
}

/** The `/conv/<key>` route key: the linked name for linked rows, else the local row id. */
export function conversationRouteKey(conv: { id: number; name: string; origin?: string }): string {
  return isLinkedConversation(conv) ? conv.name : String(conv.id);
}

type LinkedLookupRow = { name: string; origin?: string; machineLabel?: string; remoteName?: string };

/**
 * The merged-list row a linked key opens (PAN-4871): the row named `key`, else
 * the linked row on the machine labelled `<target>` with owner name `<name>`.
 * Null for a local key or when no linked row matches.
 */
export function findLinkedConversationRow<T extends LinkedLookupRow>(rows: readonly T[], key: string): T | null {
  const linked = parseLinkedConversationName(key);
  if (!linked) return null;
  return rows.find((row) => row.name === key)
    ?? rows.find((row) => isLinkedConversation(row) && row.machineLabel === linked.target && row.remoteName === linked.name)
    ?? null;
}

/** `/ws/linked/<env>/terminal` for a linked conversation name, else null. */
export function terminalWsPathFor(name: string): string | null {
  const linked = parseLinkedConversationName(name);
  return linked ? `/ws/linked/${encodeURIComponent(linked.target)}/terminal` : null;
}

const linkedTransports = new Map<string, WsTransport>();

function linkedPool(environmentId: string): TransportPool {
  const pool: TransportPool = {
    current() {
      let transport = linkedTransports.get(environmentId);
      if (!transport) {
        transport = new WsTransport(rpcUrlWithPath(`/ws/linked/${encodeURIComponent(environmentId)}/rpc`), pool);
        linkedTransports.set(environmentId, transport);
      }
      return transport;
    },
    reset(failed) {
      if (linkedTransports.get(environmentId) !== failed) return;
      linkedTransports.delete(environmentId);
      failed.dispose();
    },
  };
  return pool;
}

const pools = new Map<string, TransportPool>();

/** The RPC transport for a conversation and the name the owner knows it by. */
export function transportForConversation(name: string): { transport: WsTransport; subscribeName: string } {
  const linked = parseLinkedConversationName(name);
  if (!linked) return { transport: getTransport(), subscribeName: name };
  let pool = pools.get(linked.target);
  if (!pool) {
    pool = linkedPool(linked.target);
    pools.set(linked.target, pool);
  }
  return { transport: pool.current(), subscribeName: linked.name };
}

/** Test seam: dispose every linked transport. */
export function resetLinkedTransportsForTests(): void {
  for (const transport of linkedTransports.values()) transport.dispose();
  linkedTransports.clear();
  pools.clear();
}
