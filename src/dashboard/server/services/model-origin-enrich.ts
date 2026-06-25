/**
 * PAN-2053: attach the read-only model-origin (weighted-distribution + FNV-1a
 * derivation) to session-tree nodes, so the agent right-click MODEL inspector can
 * explain why a weighted-role agent resolved to its model.
 *
 * Two surfaces build session nodes independently — the activity cockpit
 * (`command-deck.ts`) and the left project tree (`projects.ts`). Both call this so
 * the enrichment can never drift between them.
 */
import { getAgentStateSync, type Role } from '../../../lib/agents.js';
import { clearConfigCache, computeModelOrigin, loadConfigSync, type ModelOriginData } from '../../../lib/config-yaml.js';

/**
 * Map a session-node type to the pipeline Role whose model distribution it draws
 * from. Returns null for types that never sample a top-level weighted role
 * distribution: 'reviewer' (sub-role convoy — resolves via a sub-role scalar),
 * 'legacy', and anything unrecognized.
 */
export function sessionTypeToModelRole(type: string): Role | null {
  switch (type) {
    case 'work': return 'work';
    case 'review': return 'review';
    case 'test': return 'test';
    case 'ship':
    case 'merge': return 'ship';
    case 'planning': return 'plan';
    case 'strike': return 'strike';
    default: return null;
  }
}

/**
 * Mutate `sections` in place, attaching `modelOrigin` to each node whose role uses
 * a weighted distribution. Scalar roles are left untouched (the client renders the
 * resolved model with no bars/hash). Reconstructs the spawn key from the agent's
 * persisted `modelSpawnKey` (exact) or, for pre-PAN-2053 agents, `${role}:${issueId}`.
 * Wrapped so a config/state error can never break the tree.
 */
export function enrichSessionsWithModelOrigin(
  sections: Array<{ type: string; sessionId: string; modelOrigin?: ModelOriginData }>,
  fallbackIssueId: string,
): void {
  try {
    // Force a fresh config read: config-yaml is duplicated across several dashboard
    // bundle chunks (each with its own cache), so a settings-save's clearConfigCache()
    // may not have cleared THIS chunk's copy — leaving the inspector showing a stale
    // distribution after an operator edits weights (PAN-2055). Clearing here guarantees
    // the inspector always reflects the live config. Cheap on a read-path poll.
    clearConfigCache();
    const { config } = loadConfigSync();
    for (const section of sections) {
      const role = sessionTypeToModelRole(section.type);
      if (!role) continue;
      const state = getAgentStateSync(section.sessionId);
      const spawnKey = state?.modelSpawnKey ?? `${role}:${state?.issueId ?? fallbackIssueId}`;
      const origin = computeModelOrigin(role, spawnKey, config);
      if (origin) section.modelOrigin = origin;
    }
  } catch { /* config/state issues must never break the tree */ }
}
