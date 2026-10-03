/**
 * Conversation effort (PAN-4254): validation, pi canonicalization and launch
 * resolution for every conversation door. Launch levels come from
 * resolveEffort (src/lib/agents/resolve-effort.ts); this module only adds the
 * two conversation-specific carve-outs — pi's off/minimal and opencode's
 * free-form variants.
 */
import { isEffortLevel } from '@overdeck/contracts';
import { resolveEffort } from '../agents/resolve-effort.js';
import type { RuntimeName } from '../runtimes/types.js';

const OPENCODE_EFFORT_PATTERN = /^[a-z][a-z0-9_-]*$/;
const PI_BELOW_LOW = new Set(['off', 'minimal']);

/** pi's off/minimal are stored and launched as `low` (D4); every other value is unchanged. */
export function canonicalConversationEffort(value: string): string {
  return PI_BELOW_LOW.has(value) ? 'low' : value;
}

/** True when a conversation door may accept `value` for `harness` (D3, D4, D7). */
export function isValidConversationEffort(value: string, harness: RuntimeName): boolean {
  const canonical = canonicalConversationEffort(value);
  if (isEffortLevel(canonical)) return true;
  return harness === 'opencode' && OPENCODE_EFFORT_PATTERN.test(value);
}

export interface ConversationEffortInput {
  effort?: string | null;
  model?: string;
  harness: RuntimeName;
  issueId?: string;
}

/**
 * The level a conversation launches at. Canonical (or pi off/minimal) values
 * and absent values go through resolveEffort and are clamped to the model and
 * harness; an opencode variant passes through. Throws InvalidEffortError for
 * anything else.
 */
export function resolveConversationEffort(input: ConversationEffortInput): string {
  const raw = input.effort?.trim() || undefined;
  if (raw && input.harness === 'opencode' && !isEffortLevel(raw) && OPENCODE_EFFORT_PATTERN.test(raw)) return raw;
  return resolveEffort({
    explicit: raw === undefined ? undefined : canonicalConversationEffort(raw),
    issueId: input.issueId,
    model: input.model,
    harness: input.harness,
  }).effort;
}
