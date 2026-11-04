/**
 * Agent MCP tokens (PAN-4927 W-TOK1, D-6/D-7/D-8). Reads the registry fresh
 * (never the snapshot) so CLI processes work. Mint at launch is W-INJ1's.
 *
 * Each managed agent or conversation (the owner) holds at most one active
 * `kind: 'token'` record that names it through `agentId`, `agentKind` and
 * `role`. Its plaintext lives only in `<dir>/mcp-token` (mode 0600). The
 * scopes come from `AGENT_TOKEN_SCOPES` and never include `admin`, `forward`,
 * `read:settings` or `read:costs`.
 *
 * `ensureAgentMcpToken` is the only helper that throws. The revoke helpers run
 * on stop paths, so they log one warning and resolve on any failure. Log lines
 * name the agent id and token id, never the token.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createAccessToken,
  listAccessTokens,
  readActiveAccessTokenRecord,
  revokeAccessTokensMatching,
  type AccessTokenScope,
} from '../access-tokens.js';
import { getAgentDir, getAgentState } from '../agents/agent-state-read.js';
import { normalizeAgentId } from '../agents/identity.js';
import { removeAgentSecretsDir } from '../agents/state-dir-removal.js';
import type { Role } from '../agents/role.js';

export const AGENT_TOKEN_FILE = 'mcp-token';
export type AgentTokenRole = Role | 'conversation';

const OPERATE_SCOPES: readonly AccessTokenScope[] = ['read:events', 'read:state', 'read:conversations', 'tell', 'operate'];
const REVIEW_SCOPES: readonly AccessTokenScope[] = ['read:events', 'read:state', 'read:conversations', 'tell'];

/** PAN-4927 D-8: scopes by role. Never admin, forward, read:settings or read:costs. */
export const AGENT_TOKEN_SCOPES: Readonly<Record<AgentTokenRole, readonly AccessTokenScope[]>> = {
  work: OPERATE_SCOPES,
  worker: OPERATE_SCOPES,
  plan: OPERATE_SCOPES,
  strike: OPERATE_SCOPES,
  sequencer: OPERATE_SCOPES,
  knowledge: OPERATE_SCOPES,
  flywheel: OPERATE_SCOPES,
  review: REVIEW_SCOPES,
  test: REVIEW_SCOPES,
  ship: REVIEW_SCOPES,
  conversation: ['read:events', 'read:state', 'read:conversations', 'tell', 'operate', 'approve'],
};

const TOKEN_FORMAT = /^odk_[0-9a-f]{64}$/;
const MAX_NAME_LENGTH = 200;

export interface AgentTokenOwner {
  agentId: string;
  agentKind: 'agent' | 'conversation';
  role: AgentTokenRole;
  dir: string;
}

/** `<dir>/mcp-token`. W-INJ1 uses this to name the file in MCP configs. */
export function agentMcpTokenPath(dir: string): string {
  return join(dir, AGENT_TOKEN_FILE);
}

/** D-2: an agent owner's id is normalized (`PAN-1` → `agent-pan-1`); a conversation name is kept as is. */
function ownerId(agentId: string, agentKind: 'agent' | 'conversation'): string {
  return agentKind === 'agent' ? normalizeAgentId(agentId) : agentId;
}

async function readTokenFile(tokenFile: string): Promise<string | null> {
  try {
    const content = (await readFile(tokenFile, 'utf8')).trim();
    return TOKEN_FORMAT.test(content) ? content : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function sameScopes(granted: readonly string[], expected: readonly AccessTokenScope[]): boolean {
  const set = new Set(granted);
  return set.size === expected.length && expected.every((scope) => set.has(scope));
}

async function writeTokenFile(dir: string, tokenFile: string, token: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = `${tokenFile}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${token}\n`, { mode: 0o600 });
    await rename(temp, tokenFile);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

/** D-4/D-5: reuse or mint; writes `<dir>/mcp-token` 0600. Throws on a corrupt registry or a mint that does not persist. */
export async function ensureAgentMcpToken(owner: AgentTokenOwner): Promise<{ tokenFile: string; tokenId: string }> {
  const agentId = ownerId(owner.agentId, owner.agentKind);
  const { agentKind, role, dir } = owner;
  const scopes = AGENT_TOKEN_SCOPES[role];
  const tokenFile = agentMcpTokenPath(dir);

  const existing = await readTokenFile(tokenFile);
  if (existing) {
    const record = await readActiveAccessTokenRecord(existing);
    if (record && record.kind === 'token' && record.agentId === agentId && record.agentKind === agentKind && record.role === role && sameScopes(record.scopes, scopes)) {
      return { tokenFile, tokenId: record.id };
    }
  }

  // D-5: another process can overwrite the registry between our write and the
  // next read (no cross-process lock), so check the mint landed and retry once.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await revokeAccessTokensMatching((record) => record.kind === 'token' && record.agentId === agentId && record.agentKind === agentKind);
    const { token, record } = await createAccessToken({
      name: `agent:${role}:${agentId}`.slice(0, MAX_NAME_LENGTH),
      kind: 'token',
      scopes: [...scopes],
      agentId,
      agentKind,
      role,
    });
    await writeTokenFile(dir, tokenFile, token);
    if (await readActiveAccessTokenRecord(token)) return { tokenFile, tokenId: record.id };
    console.warn(`[agent-token] token ${record.id} for ${agentId} is missing from the registry after mint`);
  }
  throw new Error(`agent token for ${agentId} did not persist in the access-token registry`);
}

/** Revoke every active token of the owner, unlink its token file and delete its `secrets/` directory (PAN-4941). Never throws; returns the count revoked. */
export async function revokeAgentMcpTokens(agentId: string, opts: { agentKind?: 'agent' | 'conversation'; dir?: string } = {}): Promise<number> {
  const agentKind = opts.agentKind ?? 'agent';
  const id = ownerId(agentId, agentKind);
  try {
    const revoked = await revokeAccessTokensMatching((record) => record.kind === 'token' && record.agentId === id && record.agentKind === agentKind);
    // C-1: a conversation's directory is never guessed; only the caller knows it.
    const dir = opts.dir ?? (agentKind === 'agent' ? getAgentDir(id) : undefined);
    if (dir !== undefined) {
      await unlink(agentMcpTokenPath(dir)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await removeAgentSecretsDir(dir);
    }
    return revoked.length;
  } catch (error) {
    console.warn(`[agent-token] revoke failed for ${id}: ${(error as Error).message}`);
    return 0;
  }
}

/** D-12. Never throws. */
export async function revokeAgentMcpTokensForIssue(issueId: string): Promise<number> {
  const issue = issueId.toLowerCase();
  try {
    const owners = new Set<string>();
    for (const record of await listAccessTokens()) {
      if (record.revokedAt || record.agentKind !== 'agent' || record.agentId === undefined) continue;
      if (getAgentState(record.agentId)?.issueId?.toLowerCase() === issue) owners.add(record.agentId);
    }
    let count = 0;
    for (const agentId of owners) count += await revokeAgentMcpTokens(agentId);
    return count;
  } catch (error) {
    console.warn(`[agent-token] revoke failed for issue ${issueId}: ${(error as Error).message}`);
    return 0;
  }
}
