/**
 * Conversations door for Session Vault browse copies (PAN-4436, PAN-2609 FR-4).
 *
 * A browse copy is a `conversations` row named `vault-<vaultId>` with
 * `origin = 'vault'` and `status = 'ended'`: a read-only view of a record another
 * machine owns. It has no `conversation_files` row, so no cost ledger join or
 * session-id correlation reaches it. The rows derive entirely from the vault
 * browse cache; the vault browse service reconciles them after each sync cycle.
 */
import { randomUUID } from 'node:crypto';
import { getOverdeckDatabase } from './infra.js';
import type { LegacyConversation } from './conversations.js';

export const VAULT_BROWSE_PREFIX = 'vault-';

export interface VaultBrowseRowInput {
  vaultId: string;
  title: string;
  harness: 'claude-code' | 'codex';
  ownerLabel: string;
  cwd: string;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export function vaultBrowseConversationName(vaultId: string): string {
  return `${VAULT_BROWSE_PREFIX}${vaultId}`;
}

/** The vault id a browse-copy name carries, or null for any other name. */
export function vaultIdFromBrowseName(name: string): string | null {
  return name.startsWith(VAULT_BROWSE_PREFIX) ? name.slice(VAULT_BROWSE_PREFIX.length) : null;
}

export function isVaultBrowseConversation(conv: Pick<LegacyConversation, 'origin'>): boolean {
  return conv.origin === 'vault';
}

export function vaultBrowseReadOnlyMessage(conv: Pick<LegacyConversation, 'name' | 'vaultOwnerLabel'>): string {
  const vaultId = vaultIdFromBrowseName(conv.name) ?? conv.name;
  return `Read-only copy from ${conv.vaultOwnerLabel ?? 'another machine'}. To continue it here, run: pan vault resume ${vaultId}`;
}

function toMillisOrNow(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Date.now() : ms;
}

interface ExistingBrowseRow {
  origin: string;
  title: string | null;
  cwd: string;
  harness: string | null;
  model: string | null;
  ended_at: number | null;
  vault_owner_label: string | null;
}

/**
 * Insert or refresh the browse row of one cached record. Only the display
 * fields change on refresh; archive state, project and favorites stay. A local
 * row holding the name is a conflict and is never touched.
 */
export function upsertVaultBrowseRow(input: VaultBrowseRowInput): 'inserted' | 'updated' | 'unchanged' | 'conflict' {
  const db = getOverdeckDatabase();
  const name = vaultBrowseConversationName(input.vaultId);
  const endedAt = toMillisOrNow(input.updatedAt);
  const existing = db
    .prepare(`SELECT origin, title, cwd, harness, model, ended_at, vault_owner_label FROM conversations WHERE name = ?`)
    .get(name) as ExistingBrowseRow | undefined;
  if (existing && existing.origin !== 'vault') return 'conflict';
  if (existing && existing.title === input.title && existing.cwd === input.cwd && existing.harness === input.harness
    && existing.model === input.model && existing.ended_at === endedAt && existing.vault_owner_label === input.ownerLabel) {
    return 'unchanged';
  }
  db.prepare(`
    INSERT INTO conversations
      (id, name, cwd, harness, model, title, title_source, created_at, archived_at, tmux_session,
       status, ended_at, fork_retry_count, origin, vault_owner_label)
    VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, NULL, ?, 'ended', ?, 0, 'vault', ?)
    ON CONFLICT(name) DO UPDATE SET
      title = excluded.title, cwd = excluded.cwd, harness = excluded.harness, model = excluded.model,
      ended_at = excluded.ended_at, vault_owner_label = excluded.vault_owner_label
    WHERE conversations.origin = 'vault'
  `).run(
    randomUUID(),
    name,
    input.cwd,
    input.harness,
    input.model,
    input.title,
    toMillisOrNow(input.createdAt),
    `conv-${name}`,
    endedAt,
    input.ownerLabel,
  );
  return existing ? 'updated' : 'inserted';
}

/**
 * Delete the browse row of `vaultId`. Every link that points at it (forks,
 * critics, handoffs, clears) is detached first so a fork never blocks removal.
 * Returns true when a row was deleted.
 */
export function removeVaultBrowseRow(vaultId: string): boolean {
  const db = getOverdeckDatabase();
  const name = vaultBrowseConversationName(vaultId);
  let removed = false;
  db.transaction(() => {
    const row = db.prepare(`SELECT id FROM conversations WHERE name = ? AND origin = 'vault'`).get(name) as { id: string } | undefined;
    if (!row) return;
    for (const column of ['parent_conversation_id', 'critic_of_conversation_id', 'handoff_target_conv_id', 'cleared_to_conv_id']) {
      db.prepare(`UPDATE conversations SET ${column} = NULL WHERE ${column} = ?`).run(row.id);
    }
    // A browse row is written without files; clearing any stray one keeps the delete from failing its foreign key.
    db.prepare(`DELETE FROM conversation_files WHERE conversation_id = ?`).run(row.id);
    db.prepare(`DELETE FROM favorites WHERE type = ? AND item_id = ?`).run('conversation', name);
    db.prepare(`DELETE FROM conversations WHERE id = ?`).run(row.id);
    removed = true;
  })();
  return removed;
}
