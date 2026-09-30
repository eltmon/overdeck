/**
 * Session Vault browse copies in the dashboard (PAN-4436, PAN-2609 FR-4).
 *
 * After each successful vault sync cycle, the vault service calls this
 * module's `onVaultSyncReport` listener inside its one-at-a-time queue. The
 * listener refreshes the browse cache (`src/lib/vault/browse.ts`, the engine
 * half), then reconciles the `vault-<vaultId>` conversation rows to exactly the
 * set of cache entries it kept, through the browse-row door
 * (`conversation-vault-rows.ts`). One `conversation.created` event per refresh
 * that changed any row makes open conversation lists refetch.
 */
import type { OpenVault } from '../../../lib/vault/open.js';
import { refreshBrowseCache } from '../../../lib/vault/browse.js';
import { listVaultBrowseConversations } from '../../../lib/overdeck/conversations.js';
import {
  removeVaultBrowseRow,
  upsertVaultBrowseRow,
  vaultBrowseConversationName,
  vaultIdFromBrowseName,
} from '../../../lib/overdeck/conversation-vault-rows.js';
import { getEventStore } from '../event-store.js';
import { onVaultSyncReport } from './vault-service.js';

export interface VaultBrowseServiceDeps {
  refreshBrowseCache?: typeof refreshBrowseCache;
  upsertVaultBrowseRow?: typeof upsertVaultBrowseRow;
  removeVaultBrowseRow?: typeof removeVaultBrowseRow;
  listVaultBrowseConversations?: typeof listVaultBrowseConversations;
  emit?: (conversationName: string) => void;
}

let unsubscribe: (() => void) | null = null;
const warned = new Set<string>();

function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

function emitConversationCreated(conversationName: string): void {
  getEventStore().emitOnly({ type: 'conversation.created', timestamp: new Date().toISOString(), payload: { conversationName } });
}

export async function refreshVaultBrowseCopies(
  vault: OpenVault,
  deps: VaultBrowseServiceDeps = {},
): Promise<{ inserted: number; updated: number; removed: number; failed: number }> {
  const refresh = deps.refreshBrowseCache ?? refreshBrowseCache;
  const upsert = deps.upsertVaultBrowseRow ?? upsertVaultBrowseRow;
  const remove = deps.removeVaultBrowseRow ?? removeVaultBrowseRow;
  const listRows = deps.listVaultBrowseConversations ?? listVaultBrowseConversations;
  const emit = deps.emit ?? emitConversationCreated;
  const counts = { inserted: 0, updated: 0, removed: 0, failed: 0 };

  let result: Awaited<ReturnType<typeof refreshBrowseCache>>;
  try {
    result = await refresh({ store: vault.store, keys: vault.keys });
  } catch (error) {
    warnOnce(`[vault] browse refresh failed: ${(error as Error).message}`);
    return counts;
  }

  let firstChanged: string | null = null;
  for (const copy of result.copies) {
    const outcome = upsert(copy);
    if (outcome === 'conflict') {
      warnOnce(`[vault] browse copy ${vaultBrowseConversationName(copy.vaultId)} skipped: a local conversation holds that name`);
      continue;
    }
    if (outcome === 'unchanged') continue;
    counts[outcome] += 1;
    firstChanged ??= vaultBrowseConversationName(copy.vaultId);
  }

  const keep = new Set([...result.copies, ...result.failed].map((entry) => entry.vaultId));
  const stale = new Set(result.removed);
  for (const row of listRows()) {
    const vaultId = vaultIdFromBrowseName(row.name);
    if (vaultId && !keep.has(vaultId)) stale.add(vaultId);
  }
  for (const vaultId of stale) {
    if (!remove(vaultId)) continue;
    counts.removed += 1;
    firstChanged ??= vaultBrowseConversationName(vaultId);
  }

  counts.failed = result.failed.length;
  for (const { vaultId, message } of result.failed) warnOnce(`[vault] browse refresh failed for ${vaultId}: ${message}`);
  if (firstChanged) emit(firstChanged);
  return counts;
}

/** Idempotent: registers one sync-report listener. */
export function startVaultBrowseService(deps: VaultBrowseServiceDeps = {}): void {
  if (unsubscribe) return;
  unsubscribe = onVaultSyncReport(async (_report, vault) => {
    await refreshVaultBrowseCopies(vault, deps);
  });
}

export function stopVaultBrowseService(): void {
  unsubscribe?.();
  unsubscribe = null;
}
