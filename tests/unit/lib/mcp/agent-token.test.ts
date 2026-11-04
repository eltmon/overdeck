/**
 * PAN-4930 W-4: agent MCP tokens — the D-8 scope table, mint and reuse of the
 * 0600 `mcp-token` file, revoke by owner and by issue, and the D-5 check that a
 * mint persisted. Uses the real registry module under a temp OVERDECK_HOME.
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../../../../src/lib/agents/agent-state-read.js';

const agentStates = vi.hoisted(() => new Map<string, { issueId: string }>());

vi.mock('../../../../src/lib/access-tokens.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/access-tokens.js')>();
  return { ...actual, readActiveAccessTokenRecord: vi.fn(actual.readActiveAccessTokenRecord) };
});

vi.mock('../../../../src/lib/agents/agent-state-read.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/agents/agent-state-read.js')>();
  return { ...actual, getAgentState: vi.fn((id: string) => (agentStates.get(id) ?? null) as AgentState | null) };
});

import {
  _resetAccessTokensForTests,
  _settleAccessTokenWritesForTests,
  listAccessTokens,
  readActiveAccessTokenRecord,
  revokeAccessToken,
} from '../../../../src/lib/access-tokens.js';
import type { Role } from '../../../../src/lib/agents/role.js';
import {
  AGENT_TOKEN_SCOPES,
  agentMcpTokenPath,
  ensureAgentMcpToken,
  revokeAgentMcpTokens,
  revokeAgentMcpTokensForIssue,
  type AgentTokenOwner,
} from '../../../../src/lib/mcp/agent-token.js';
import { addPullRequestWatch, listPullRequestWatches, type PullRequestWatchBaseline } from '../../../../src/lib/overdeck/pull-request-watches.js';

const WATCH_BASELINE: PullRequestWatchBaseline = { state: 'open', checks: 'pending', reviewState: 'none', mergeable: null };

const ROLES: Role[] = ['plan', 'work', 'review', 'test', 'ship', 'flywheel', 'strike', 'sequencer', 'knowledge', 'worker'];
const OPERATE = ['read:events', 'read:state', 'read:conversations', 'tell', 'operate'];
const REVIEW = ['read:events', 'read:state', 'read:conversations', 'tell'];

let home: string;
const originalHome = process.env.OVERDECK_HOME;

async function activeFor(agentId: string) {
  return (await listAccessTokens()).filter((record) => !record.revokedAt && record.agentId === agentId);
}

async function tokenIn(dir: string): Promise<string> {
  return (await readFile(agentMcpTokenPath(dir), 'utf8')).trim();
}

function workOwner(dir = join(home, 'agents', 'agent-pan-1')): AgentTokenOwner {
  return { agentId: 'agent-pan-1', agentKind: 'agent', role: 'work', dir };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4930-agent-token-'));
  process.env.OVERDECK_HOME = home;
  _resetAccessTokensForTests();
  agentStates.clear();
  vi.mocked(readActiveAccessTokenRecord).mockClear();
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  vi.restoreAllMocks();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('agent MCP tokens (PAN-4930 W-4)', () => {
  it('AGENT_TOKEN_SCOPES has the D-8 row for every role and never grants admin, forward, read:settings or read:costs', () => {
    expect(Object.keys(AGENT_TOKEN_SCOPES).sort()).toEqual([...ROLES, 'conversation'].sort());
    for (const role of ['work', 'worker', 'plan', 'strike', 'sequencer', 'knowledge', 'flywheel'] as const) {
      expect(AGENT_TOKEN_SCOPES[role], role).toEqual(OPERATE);
    }
    for (const role of ['review', 'test', 'ship'] as const) expect(AGENT_TOKEN_SCOPES[role], role).toEqual(REVIEW);
    expect(AGENT_TOKEN_SCOPES.conversation).toEqual([...OPERATE, 'approve']);
    for (const scopes of Object.values(AGENT_TOKEN_SCOPES)) {
      for (const forbidden of ['admin', 'forward', 'read:settings', 'read:costs']) expect(scopes).not.toContain(forbidden);
    }
  });

  it('mints a work agent one active token and a 0600 mcp-token file that verifies to it', async () => {
    const owner = workOwner();
    const { tokenFile, tokenId } = await ensureAgentMcpToken(owner);
    expect(tokenFile).toBe(join(owner.dir, 'mcp-token'));
    expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);

    const record = await readActiveAccessTokenRecord(await tokenIn(owner.dir));
    expect(record).toMatchObject({ id: tokenId, kind: 'token', agentId: 'agent-pan-1', agentKind: 'agent', role: 'work', name: 'agent:work:agent-pan-1', scopes: OPERATE });
    expect(await activeFor('agent-pan-1')).toHaveLength(1);
  });

  it('gives a review run the review scopes and a conversation approve', async () => {
    const review = await ensureAgentMcpToken({ agentId: 'review-run-1', agentKind: 'agent', role: 'review', dir: join(home, 'agents', 'review-run-1') });
    const conv = await ensureAgentMcpToken({ agentId: 'my-conv', agentKind: 'conversation', role: 'conversation', dir: join(home, 'conversations', 'conv-my-conv') });
    const records = await listAccessTokens();
    expect(records.find((record) => record.id === review.tokenId)?.scopes).toEqual(REVIEW);
    expect(records.find((record) => record.id === conv.tokenId)).toMatchObject({ agentKind: 'conversation', role: 'conversation', scopes: [...OPERATE, 'approve'] });
  });

  it('reuses the token while the file and record are intact', async () => {
    const first = await ensureAgentMcpToken(workOwner());
    const second = await ensureAgentMcpToken(workOwner());
    expect(second.tokenId).toBe(first.tokenId);
    expect(await activeFor('agent-pan-1')).toHaveLength(1);
  });

  it('re-mints after the file is deleted, the record is revoked, or the role changes', async () => {
    const owner = workOwner();
    const first = await ensureAgentMcpToken(owner);

    await rm(agentMcpTokenPath(owner.dir));
    const afterDelete = await ensureAgentMcpToken(owner);
    expect(afterDelete.tokenId).not.toBe(first.tokenId);

    await revokeAccessToken(afterDelete.tokenId);
    const afterRevoke = await ensureAgentMcpToken(owner);
    expect(afterRevoke.tokenId).not.toBe(afterDelete.tokenId);

    const afterRole = await ensureAgentMcpToken({ ...owner, role: 'review' });
    expect(afterRole.tokenId).not.toBe(afterRevoke.tokenId);

    const active = await activeFor('agent-pan-1');
    expect(active.map((record) => record.id)).toEqual([afterRole.tokenId]);
    expect(active[0]!.role).toBe('review');
  });

  it('revokeAgentMcpTokens leaves no active token and no file, and resolves 0 on a corrupt registry', async () => {
    const owner = workOwner();
    await ensureAgentMcpToken(owner);
    expect(await revokeAgentMcpTokens('agent-pan-1')).toBe(1);
    expect(await activeFor('agent-pan-1')).toEqual([]);
    await expect(stat(agentMcpTokenPath(owner.dir))).rejects.toMatchObject({ code: 'ENOENT' });

    await writeFile(join(home, 'access-tokens.json'), 'not json', { mode: 0o600 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(revokeAgentMcpTokens('agent-pan-1')).resolves.toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[agent-token] revoke failed for agent-pan-1'));
  });

  it('PAN-4943 WI-3: revokeAgentMcpTokens removes the owner watches and leaves other owners untouched', async () => {
    await ensureAgentMcpToken(workOwner());
    await addPullRequestWatch({ agentId: 'agent-pan-1', agentKind: 'agent', key: { host: 'github.com', repository: 'eltmon/overdeck', number: 1, url: 'https://github.com/eltmon/overdeck/pull/1' }, last: WATCH_BASELINE });
    await addPullRequestWatch({ agentId: 'conv-a', agentKind: 'conversation', key: { host: 'github.com', repository: 'eltmon/overdeck', number: 2, url: 'https://github.com/eltmon/overdeck/pull/2' }, last: WATCH_BASELINE });

    expect(await revokeAgentMcpTokens('agent-pan-1')).toBe(1);
    expect(await listPullRequestWatches({ agentId: 'agent-pan-1', agentKind: 'agent' })).toEqual([]);
    expect(await listPullRequestWatches({ agentId: 'conv-a', agentKind: 'conversation' })).toHaveLength(1);
  });

  it('PAN-4943 WI-3: a corrupt PR watch store still resolves (not rejects) and the token is still revoked', async () => {
    const owner = workOwner();
    await ensureAgentMcpToken(owner);
    await writeFile(join(home, 'pr-watches.json'), 'not json', { mode: 0o600 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The watch-removal failure is caught by the same outer catch as a corrupt
    // access-token registry, so it resolves 0 even though the token (revoked
    // before the watch store was touched) is already gone from the registry.
    await expect(revokeAgentMcpTokens('agent-pan-1')).resolves.toBe(0);
    expect(await activeFor('agent-pan-1')).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[agent-token] revoke failed for agent-pan-1'));
  });

  it('PAN-4941: revokeAgentMcpTokens deletes the owner secrets directory for an agent and for a conversation with dir', async () => {
    const agentDir = join(home, 'agents', 'agent-pan-1');
    await mkdir(join(agentDir, 'secrets'), { recursive: true, mode: 0o700 });
    await writeFile(join(agentDir, 'secrets', 'OPENAI_API_KEY'), 'v', { mode: 0o600 });
    await revokeAgentMcpTokens('agent-pan-1');
    await expect(stat(join(agentDir, 'secrets'))).rejects.toMatchObject({ code: 'ENOENT' });

    const convDir = join(home, 'conversations', 'conv-abc');
    await mkdir(join(convDir, 'secrets'), { recursive: true, mode: 0o700 });
    await writeFile(join(convDir, 'secrets', 'OPENAI_API_KEY'), 'v', { mode: 0o600 });
    await revokeAgentMcpTokens('abc', { agentKind: 'conversation', dir: convDir });
    await expect(stat(join(convDir, 'secrets'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('PAN-4941: a missing secrets directory is not an error', async () => {
    await ensureAgentMcpToken(workOwner());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(revokeAgentMcpTokens('agent-pan-1')).resolves.toBe(1);
    await expect(revokeAgentMcpTokens('abc', { agentKind: 'conversation', dir: join(home, 'conversations', 'conv-none') })).resolves.toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('normalizes a bare issue id, so a PAN-1 mint is revoked by agent-pan-1', async () => {
    await ensureAgentMcpToken({ ...workOwner(), agentId: 'PAN-1' });
    expect(await activeFor('agent-pan-1')).toHaveLength(1);
    expect(await revokeAgentMcpTokens('agent-pan-1')).toBe(1);
    expect(await activeFor('agent-pan-1')).toEqual([]);
  });

  it('a conversation revoke never touches an agent token with the same id', async () => {
    // A qualified id, so normalizeAgentId leaves the agent owner's id equal to the conversation name.
    const dir = join(home, 'agents', 'agent-x');
    await ensureAgentMcpToken({ agentId: 'agent-x', agentKind: 'agent', role: 'work', dir });
    expect(await revokeAgentMcpTokens('agent-x', { agentKind: 'conversation', dir: join(home, 'conversations', 'conv-agent-x') })).toBe(0);
    expect(await activeFor('agent-x')).toHaveLength(1);
    expect(await tokenIn(dir)).toMatch(/^odk_/);
  });

  it('revokeAgentMcpTokensForIssue revokes only the agents of that issue', async () => {
    agentStates.set('agent-pan-1', { issueId: 'pan-1' });
    agentStates.set('agent-pan-2', { issueId: 'PAN-2' });
    await ensureAgentMcpToken(workOwner());
    await ensureAgentMcpToken({ agentId: 'agent-pan-2', agentKind: 'agent', role: 'work', dir: join(home, 'agents', 'agent-pan-2') });

    expect(await revokeAgentMcpTokensForIssue('PAN-1')).toBe(1);
    expect(await activeFor('agent-pan-1')).toEqual([]);
    expect(await activeFor('agent-pan-2')).toHaveLength(1);
  });

  it('D-5: mints again when the first mint is not found, and rejects when neither persists', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(readActiveAccessTokenRecord).mockResolvedValueOnce(null);
    const { tokenId } = await ensureAgentMcpToken(workOwner());
    const active = await activeFor('agent-pan-1');
    expect(active.map((record) => record.id)).toEqual([tokenId]);
    expect((await listAccessTokens()).filter((record) => record.agentId === 'agent-pan-1')).toHaveLength(2);

    const other = workOwner(join(home, 'agents', 'agent-pan-9'));
    vi.mocked(readActiveAccessTokenRecord).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    await expect(ensureAgentMcpToken({ ...other, agentId: 'agent-pan-9' })).rejects.toThrow('agent token for agent-pan-9 did not persist in the access-token registry');
    expect(warn).toHaveBeenCalled();
  });
});
