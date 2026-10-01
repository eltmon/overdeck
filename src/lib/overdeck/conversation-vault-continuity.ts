/**
 * Dashboard conversation rows -> Session Vault round-trip states (PAN-4447 FR-3).
 *
 * Matches a conversation row to its native file in the machine-local vault
 * index, then looks up that path's round-trip state (`../vault/round-trip.js`).
 * A Claude row matches by native-file basename (`<claudeSessionId>.jsonl`); a
 * Codex row matches by the `<tmuxSession>` directory segment under
 * `<overdeckHome>/agents/`. Vault browse rows and every other harness return
 * null.
 */
import { basename, join, sep } from 'node:path';
import { getOverdeckHome } from '../paths.js';
import { readLocalIndex, type LocalIndex } from '../vault/local-index.js';
import { roundTripStates, type RoundTripState } from '../vault/round-trip.js';

export interface VaultContinuityLookup {
  states: Map<string, RoundTripState>;
  claudeByBasename: Map<string, string[]>;
  codexByTmuxSession: Map<string, string[]>;
}

export interface ConversationContinuityInput {
  origin: string;
  harness: string | null | undefined;
  claudeSessionId: string | null;
  tmuxSession: string;
}

const EMPTY_INDEX: Pick<LocalIndex, 'owned' | 'listCache'> = { owned: {}, listCache: [] };
const warnedMessages = new Set<string>();

/** Groups owned native paths by Claude basename and Codex tmuxSession, and computes their round-trip states. */
export function buildVaultContinuityLookup(index: Pick<LocalIndex, 'owned' | 'listCache'>, overdeckHome: string): VaultContinuityLookup {
  const claudeByBasename = new Map<string, string[]>();
  const codexByTmuxSession = new Map<string, string[]>();
  const agentsPrefix = join(overdeckHome, 'agents') + sep;
  const paths = Object.entries(index.owned).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  for (const [nativePath, entry] of paths) {
    if (entry.harness === 'claude-code') {
      const key = basename(nativePath);
      const list = claudeByBasename.get(key);
      if (list) list.push(nativePath);
      else claudeByBasename.set(key, [nativePath]);
      continue;
    }
    if (entry.harness === 'codex' && nativePath.startsWith(agentsPrefix)) {
      const rest = nativePath.slice(agentsPrefix.length);
      const boundary = rest.indexOf(sep);
      const tmuxSession = boundary === -1 ? rest : rest.slice(0, boundary);
      const list = codexByTmuxSession.get(tmuxSession);
      if (list) list.push(nativePath);
      else codexByTmuxSession.set(tmuxSession, [nativePath]);
    }
  }

  return { states: roundTripStates(index), claudeByBasename, codexByTmuxSession };
}

/** Reads the machine-local vault index and builds the lookup. A read failure warns once per message and falls back to an empty index. */
export async function loadVaultContinuityLookup(overdeckHome: string = getOverdeckHome()): Promise<VaultContinuityLookup> {
  let index: Pick<LocalIndex, 'owned' | 'listCache'>;
  try {
    index = await readLocalIndex();
  } catch (error) {
    const message = (error as Error).message;
    if (!warnedMessages.has(message)) {
      warnedMessages.add(message);
      console.warn(`[vault-continuity] ${message}`);
    }
    index = EMPTY_INDEX;
  }
  return buildVaultContinuityLookup(index, overdeckHome);
}

/** The round-trip state for a conversation row, or null for a vault browse row, an unsupported harness, or no native-file match. */
export function vaultContinuityFor(conv: ConversationContinuityInput, lookup: VaultContinuityLookup): RoundTripState | null {
  if (conv.origin === 'vault') return null;
  let candidates: string[] | undefined;
  if (conv.harness === 'claude-code' || conv.harness === null || conv.harness === undefined) {
    if (!conv.claudeSessionId) return null;
    candidates = lookup.claudeByBasename.get(`${conv.claudeSessionId}.jsonl`);
  } else if (conv.harness === 'codex') {
    candidates = lookup.codexByTmuxSession.get(conv.tmuxSession);
  } else {
    return null;
  }
  if (!candidates || candidates.length === 0) return null;
  return lookup.states.get(candidates[candidates.length - 1]!) ?? null;
}
