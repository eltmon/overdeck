/**
 * Actor stamp on forwarded link requests (PAN-4645 FR-4, WI-4). A leaf module.
 *
 * The linking machine's server adds `x-overdeck-link-actor: operator | agent:<id>`
 * and optionally `x-overdeck-link-ceiling: <scope,scope>` to every request it
 * forwards. The linked machine trusts the stamp only inside a secure channel
 * (the caller checks that), lets it only narrow the machine token's scopes, and
 * treats a missing stamp as an agent.
 */
import { ACCESS_TOKEN_SCOPES, type AccessTokenScope, type MachineAccess } from '../access-tokens.js';

export const LINK_ACTOR_HEADER = 'x-overdeck-link-actor';
export const LINK_CEILING_HEADER = 'x-overdeck-link-ceiling';

export type LinkActor = 'operator' | { agentId: string };

const KNOWN_SCOPES: readonly string[] = ACCESS_TOKEN_SCOPES;
const AGENT_ID = /^[A-Za-z0-9._:/-]{1,200}$/;

/**
 * Parse the two stamp headers. No actor header ⇒ `{ agentId: 'unknown' }`;
 * an `agent-fenced` link downgrades `operator` to `{ agentId: 'operator-fenced' }`;
 * unknown ceiling scopes are dropped and an empty ceiling means no ceiling.
 */
export function parseLinkActor(
  actorHeader: string | undefined,
  ceilingHeader: string | undefined,
  access: MachineAccess,
): { actor: LinkActor; ceiling: AccessTokenScope[] | null } {
  let actor: LinkActor = { agentId: 'unknown' };
  const stamp = actorHeader?.trim() ?? '';
  if (stamp === 'operator') {
    actor = access === 'operator' ? 'operator' : { agentId: 'operator-fenced' };
  } else if (stamp.startsWith('agent:')) {
    const agentId = stamp.slice('agent:'.length);
    actor = { agentId: AGENT_ID.test(agentId) ? agentId : 'unknown' };
  }
  const ceiling = (ceilingHeader ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope): scope is AccessTokenScope => scope !== '' && KNOWN_SCOPES.includes(scope));
  return { actor, ceiling: ceilingHeader === undefined || ceilingHeader.trim() === '' ? null : ceiling };
}

/** The record's scopes narrowed by the ceiling (intersection); a ceiling can never add a scope. */
export function effectiveScopes(recordScopes: readonly AccessTokenScope[], ceiling: readonly AccessTokenScope[] | null): AccessTokenScope[] {
  if (ceiling === null) return [...recordScopes];
  return recordScopes.filter((scope) => ceiling.includes(scope));
}
