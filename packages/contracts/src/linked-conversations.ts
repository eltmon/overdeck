// Linked conversations (PAN-4650, Anywhere W-CONV2).
//
// The owner machine shares the metadata of its local conversations with the
// machines linked to it; the viewing machine caches that list in
// `linked_conversations` and merges it into its own conversation list. The
// list hash lives in `src/lib/anywhere/shared-conversations.ts` because it
// needs `node:crypto`; this module holds only the shapes and name helpers.

import type { LinkState } from "./machines"

/** One conversation in an owner's shared list (FR-1 fields only, ≈300 bytes). */
export interface SharedConversationRow {
  name: string
  title: string | null
  nativeSessionId: string | null
  harness: string | null
  model: string | null
  status: "active" | "ended"
  sessionAlive: boolean
  isWorking: boolean
  lastActivityAt: string | null
  projectKey: string | null
  gitOrigin: string | null
  cwd: string | null
  issueId: string | null
  tmuxSession: string | null
  releasedTo: string | null
  createdAt: string
  /** The owner's `isResumableHarness(harness)`; the UI never compares harness names. */
  pullable: boolean
  /**
   * The Session Vault record the owner settles this conversation into, or null.
   * The viewer's saved copy of it is the browse row `vault-<vaultId>` (FR-2).
   */
  vaultId: string | null
  /**
   * Where the owner pulled this conversation from (adoption mints a new
   * session id, so this is how the old owner recognises it); absent from
   * owners older than PAN-4650 WI-11.
   */
  pulledFrom?: { environmentId: string; nativeSessionId: string } | null
  /**
   * Why the owner's launch failed (its `spawn_error`), so the viewer shows the
   * failure instead of an empty composer (PAN-4903). Sent only when set; absent
   * from older owners.
   */
  spawnError?: string | null
}

/** The owner's answer to `GET /api/machines/conversations`. */
export interface SharedConversationsResponse {
  environmentId: string
  sharing: boolean
  hash: string
  rows: SharedConversationRow[]
}

/** Fields a linked row carries in the viewing machine's merged list (D-4650-3). */
export interface LinkedConversationFields {
  origin: "linked"
  environmentId: string
  remoteName: string
  machineLabel: string
  machineState: LinkState
  machineLastSeenAt: string | null
  savedCopyName: string | null
  releasedTo: string | null
}

/** The viewing machine's name for a linked conversation: `@<environmentId>/<name>`. */
export function linkedConversationName(environmentId: string, name: string): string {
  return `@${environmentId}/${name}`
}

const LINKED_NAME = /^@([^/]+)\/([^/]+)$/

/**
 * Parse `@<target>/<name>`, where target is an environment id or a machine
 * label. Returns null for a local name or a malformed value.
 */
export function parseLinkedConversationName(value: string): { target: string; name: string } | null {
  const match = LINKED_NAME.exec(value)
  if (!match) return null
  return { target: match[1]!, name: match[2]! }
}
