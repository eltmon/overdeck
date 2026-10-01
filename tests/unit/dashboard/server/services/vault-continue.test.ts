/** PAN-4437 WI-4: previewContinue and continueHere with every collaborator injected. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import {
  continueHere,
  ownerToken,
  previewContinue,
  type VaultContinueDeps,
} from '../../../../../src/dashboard/server/services/vault-continue.js';
import type { LegacyConversation } from '../../../../../src/lib/overdeck/conversations.js';
import { getOverdeckHome } from '../../../../../src/lib/paths.js';
import type { ProjectConfig } from '../../../../../src/lib/projects.js';
import { findProjectForGitOrigin } from '../../../../../src/lib/projects/origin-match.js';
import { sessionFilePath } from '../../../../../src/lib/runtimes/storage/claude-code.js';
import { driftNote } from '../../../../../src/lib/vault/continue-inspect.js';
import type { CwdState } from '../../../../../src/lib/vault/cwd-state.js';
import type { SessionRecord, WipSnapshotRef } from '../../../../../src/lib/vault/format.js';
import type { OpenVault } from '../../../../../src/lib/vault/open.js';
import type { ResolvedWorkspaceIntent } from '../../../../../src/lib/workspaces/create.js';

const VAULT_ID = 'abcdef12-3456-4789-8abc-def012345678';
const NEW_SESSION = '99999999-8888-4777-8666-555555555555';
const CWD = '/src/widget';
const VAULT: OpenVault = { config: {} as never, keys: {} as never, store: {} as never, rotatedAt: null };
const ME = { environmentId: 'env-here', label: 'laptop-b' } as Awaited<ReturnType<VaultContinueDeps['ensureEnvironmentIdentity']>>;

const CAPTURED: WipSnapshotRef = { base: 'b'.repeat(40), branch: 'main', tree: 't'.repeat(40), objects: ['o'], bytes: 10, at: '2026-09-30T10:00:00.000Z' };

function cwdState(overrides: Partial<CwdState> = {}): CwdState {
  return { gitOrigin: null, head: 'h', branch: 'main', dirty: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, ...overrides };
}

function record(overrides: Partial<SessionRecord> = {}, wip: WipSnapshotRef | null = CAPTURED, saved: CwdState | null = null): SessionRecord {
  return {
    v: 1,
    type: 'session',
    vaultId: VAULT_ID,
    owner: { environmentId: 'env-a', label: 'machine-a' },
    harness: 'claude-code',
    nativeSessionId: 'old',
    title: 'Fix the parser',
    model: 'claude-opus-5-5',
    project: null,
    cwd: CWD,
    gitOrigin: 'git@github.com:acme/widget.git',
    log: [],
    view: { fromChunk: 0, fromLine: 0 },
    parent: null,
    segments: [],
    settlements: [{ at: 'x', chunk: 'c', turn: 1, lines: 1, cwdState: saved, ...(wip ? { wip } : {}) }],
    lineage: [],
    tombstone: false,
    createdAt: 'x',
    updatedAt: 'x',
    endedAt: null,
    ...overrides,
  };
}

const PROJECTS = [{ key: 'widget', config: { name: 'widget', path: CWD, github_repo: 'acme/widget' } as ProjectConfig }];
const TOKEN = ownerToken('env-a');

interface Harness {
  deps: Partial<VaultContinueDeps>;
  log: string[];
  mocks: Record<string, ReturnType<typeof vi.fn>>;
}

function harness(rec: SessionRecord, options: { dirty?: boolean; existing?: string[]; projects?: typeof PROJECTS } = {}): Harness {
  const log: string[] = [];
  const existing = new Set(options.existing ?? [CWD]);
  const intent = (name: string, path: string | null, code?: string): ResolvedWorkspaceIntent => ({
    projectId: 'widget', kind: 'scratch', name, path, branchName: `scratch/${name}`, parentBranch: 'main', parentBranchGuessed: false,
    isGitRepository: true, wouldCreateWorktree: true, unregisteredTargetPath: false, branchCandidates: [],
    findings: code ? [{ field: 'name', code: code as 'path-exists', message: `Path already exists: ${path}` }] : [],
  });
  const mocks = {
    openVaultContext: vi.fn(async () => ({ status: 'open' as const, vault: VAULT })),
    readRecord: vi.fn(async () => rec),
    ensureEnvironmentIdentity: vi.fn(async () => ME),
    listProjectsAsync: vi.fn(async () => options.projects ?? PROJECTS),
    inspectContinue: vi.fn(async () => ({ wip: { kind: 'none' as const }, isGit: true, dirty: !!options.dirty, codePlacement: 'in-place' as const, drift: [] })),
    isWipPresent: vi.fn(async () => false),
    applyWipSnapshot: vi.fn(async ({ cwd }: { cwd: string }) => {
      log.push(`apply:${cwd}`);
      return { status: 'applied' as const, cwd, head: 'h', branch: 'main' };
    }),
    resolveWorkspaceCreateIntent: vi.fn(async ({ name }: { name?: string }) => {
      const path = `${CWD}/workspaces/scratch-${name}`;
      return intent(name!, path, existing.has(path) ? 'path-exists' : undefined);
    }),
    performWorkspaceCreate: vi.fn(async (i: ResolvedWorkspaceIntent) => {
      log.push(`workspace:${i.name}`);
      return { id: 'w' };
    }),
    adoptRecord: vi.fn(async (opts: { targetCwd: string }) => {
      log.push('adopt');
      return { adopted: true as const, vaultId: VAULT_ID, path: sessionFilePath(opts.targetCwd, NEW_SESSION), newSessionId: NEW_SESSION, lines: 3 };
    }),
    readCwdState: vi.fn(async () => cwdState({ dirty: !!options.dirty })),
    enqueueVaultOperation: vi.fn(<T>(label: string, run: () => Promise<T>) => {
      log.push(`queue:${label}`);
      return run();
    }),
    createVaultContinuedConversation: vi.fn((input: { name: string; cwd: string; title: string }) => {
      log.push('row');
      return { name: input.name, title: input.title, cwd: input.cwd } as LegacyConversation;
    }),
    launchVaultContinuedConversation: vi.fn(async () => undefined),
    allocateVaultContinueNames: vi.fn(() => ({ name: '20260930-abcd', tmuxSession: 'conv-20260930-abcd' })),
    recordCodexRolloutSession: vi.fn(),
    resolveCodexRolloutPath: vi.fn(async () => null as string | null),
    removeVaultBrowseRow: vi.fn(() => {
      log.push('remove-browse-row');
      return true;
    }),
    claudeProjectsRoot: vi.fn(() => '/home/u/.claude/projects'),
    pathIsDirectory: vi.fn(async (path: string) => existing.has(path)),
  };
  return { deps: { ...mocks, findProjectForGitOrigin } as unknown as Partial<VaultContinueDeps>, log, mocks };
}

const WRITE_DEPS = ['isWipPresent', 'applyWipSnapshot', 'performWorkspaceCreate', 'adoptRecord', 'createVaultContinuedConversation', 'launchVaultContinuedConversation', 'recordCodexRolloutSession', 'removeVaultBrowseRow', 'enqueueVaultOperation'];

beforeEach(() => vi.clearAllMocks());

describe('previewContinue (PAN-4437 WI-4)', () => {
  it('reports the saved cwd target and writes nothing', async () => {
    const h = harness(record());
    const result = await previewContinue(VAULT_ID, h.deps);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ target: { cwd: CWD, source: 'saved-cwd', projectKey: 'widget' }, ownerToken: TOKEN, ownedHere: false, resumable: true });
    for (const name of WRITE_DEPS) expect(h.mocks[name]).not.toHaveBeenCalled();
  });

  it('falls back to the matching project, then offers a clone, then explains no checkout', async () => {
    const elsewhere = record({ cwd: '/gone' });
    expect((await previewContinue(VAULT_ID, harness(elsewhere).deps)).body).toMatchObject({ target: { cwd: CWD, source: 'project' } });
    const clone = await previewContinue(VAULT_ID, harness(elsewhere, { projects: [] }).deps);
    expect(clone.body).toMatchObject({ target: null, noTargetReason: 'clone-offered', clone: { url: 'git@github.com:acme/widget.git', slug: 'acme/widget' } });
    const none = await previewContinue(VAULT_ID, harness(record({ cwd: '/gone', gitOrigin: null }), { projects: [] }).deps);
    expect(none.body).toMatchObject({ target: null, noTargetReason: 'no-checkout', clone: null });
  });

  it('marks other harnesses non-resumable and returns 409 when the vault is off', async () => {
    expect((await previewContinue(VAULT_ID, harness(record({ harness: 'opencode' })).deps)).body).toMatchObject({ resumable: false });
    const off = harness(record());
    off.mocks.openVaultContext.mockResolvedValue({ status: 'off' });
    expect(await previewContinue(VAULT_ID, off.deps)).toMatchObject({ status: 409, body: { code: 'vault-unavailable' } });
  });
});

describe('continueHere (PAN-4437 WI-4)', () => {
  it('ac: a clean target applies, adopts, creates the row and removes the browse row, in order, in one queue call', async () => {
    const h = harness(record());
    const result = await continueHere(VAULT_ID, { expectedOwnerToken: TOKEN }, h.deps);
    expect(result).toMatchObject({ status: 200, body: { conversation: { name: '20260930-abcd', cwd: CWD }, codeApplied: true, workspacePath: null } });
    expect(h.log).toEqual(['queue:continue', `apply:${CWD}`, 'adopt', 'row', 'remove-browse-row']);
    expect(h.mocks.enqueueVaultOperation).toHaveBeenCalledTimes(1);
    expect(h.mocks.adoptRecord).toHaveBeenCalledWith(expect.objectContaining({ projectsRoot: '/home/u/.claude/projects', targetCwd: CWD }));
    expect(h.mocks.launchVaultContinuedConversation).toHaveBeenCalledWith(expect.objectContaining({ name: '20260930-abcd' }), null);
  });

  it('a dirty target with a project gets a scratch workspace, retrying on path-exists', async () => {
    const h = harness(record(), { dirty: true, existing: [CWD, `${CWD}/workspaces/scratch-vault-abcdef12`] });
    const result = await continueHere(VAULT_ID, { expectedOwnerToken: TOKEN }, h.deps);
    const ws = `${CWD}/workspaces/scratch-vault-abcdef12-2`;
    expect(result).toMatchObject({ status: 200, body: { workspacePath: ws, conversation: { cwd: ws } } });
    expect(h.log).toEqual(['queue:continue', 'workspace:vault-abcdef12-2', `apply:${ws}`, 'adopt', 'row', 'remove-browse-row']);
  });

  it('ac: a dirty unregistered checkout returns dirty-unregistered before adoption', async () => {
    const h = harness(record({ gitOrigin: null }), { dirty: true, projects: [] });
    const result = await continueHere(VAULT_ID, { expectedOwnerToken: TOKEN }, h.deps);
    expect(result).toMatchObject({ status: 409, body: { code: 'dirty-unregistered' } });
    expect(h.mocks.adoptRecord).not.toHaveBeenCalled();
    expect(h.mocks.applyWipSnapshot).not.toHaveBeenCalled();
  });

  it('a dirty checkout that already holds the snapshot is used as is', async () => {
    const h = harness(record(), { dirty: true });
    h.mocks.isWipPresent.mockResolvedValue(true);
    const result = await continueHere(VAULT_ID, { expectedOwnerToken: TOKEN }, h.deps);
    expect(result).toMatchObject({ status: 200, body: { conversation: { cwd: CWD }, workspacePath: null } });
    expect(h.mocks.performWorkspaceCreate).not.toHaveBeenCalled();
    expect(h.mocks.applyWipSnapshot).not.toHaveBeenCalled();
  });

  it('a stale owner token returns already-continued with the new owner and writes nothing', async () => {
    const h = harness(record({ owner: { environmentId: 'env-c', label: 'machine-c' } }));
    const result = await continueHere(VAULT_ID, { expectedOwnerToken: TOKEN }, h.deps);
    expect(result).toMatchObject({ status: 409, body: { code: 'already-continued', label: 'machine-c', error: 'Already continued on machine-c.' } });
    expect(h.mocks.applyWipSnapshot).not.toHaveBeenCalled();
    expect(h.mocks.adoptRecord).not.toHaveBeenCalled();
  });

  it('ac: a CAS conflict returns already-continued with codeAppliedAt, no row and no browse-row removal', async () => {
    const h = harness(record());
    h.mocks.adoptRecord.mockResolvedValue({ adopted: false, alreadyContinuedOn: 'machine-c' });
    const result = await continueHere(VAULT_ID, { expectedOwnerToken: TOKEN }, h.deps);
    expect(result).toMatchObject({ status: 409, body: { code: 'already-continued', label: 'machine-c', codeAppliedAt: expect.any(String) } });
    expect(h.mocks.createVaultContinuedConversation).not.toHaveBeenCalled();
    expect(h.mocks.removeVaultBrowseRow).not.toHaveBeenCalled();
  });

  it('drift without onDrift returns 409 drift; note delivers driftNote', async () => {
    const drifted = record({}, null, cwdState({ branch: 'dev' }));
    const h = harness(drifted);
    expect(await continueHere(VAULT_ID, { expectedOwnerToken: TOKEN }, h.deps)).toMatchObject({ status: 409, body: { code: 'drift', fields: ['branch'] } });
    expect(h.mocks.adoptRecord).not.toHaveBeenCalled();
    const n = harness(drifted);
    expect((await continueHere(VAULT_ID, { expectedOwnerToken: TOKEN, onDrift: 'note' }, n.deps)).status).toBe(200);
    expect(n.mocks.launchVaultContinuedConversation).toHaveBeenCalledWith(expect.anything(), driftNote(['branch']));
  });

  it('codex adopts into the agent directory and records the rollout', async () => {
    const h = harness(record({ harness: 'codex' }, null));
    const rollout = join(getOverdeckHome(), 'agents', 'conv-20260930-abcd', 'codex-home', 'sessions', 'r.jsonl');
    h.mocks.adoptRecord.mockResolvedValue({ adopted: true, vaultId: VAULT_ID, path: rollout, newSessionId: NEW_SESSION, lines: 1 });
    h.mocks.resolveCodexRolloutPath.mockResolvedValue(rollout);
    const result = await continueHere(VAULT_ID, { expectedOwnerToken: TOKEN }, h.deps);
    expect(result.status).toBe(200);
    expect(h.mocks.adoptRecord).toHaveBeenCalledWith(expect.objectContaining({ codexHome: join(getOverdeckHome(), 'agents', 'conv-20260930-abcd', 'codex-home') }));
    expect(h.mocks.recordCodexRolloutSession).toHaveBeenCalledWith('conv-20260930-abcd', NEW_SESSION, rollout);
    expect(h.mocks.createVaultContinuedConversation).toHaveBeenCalledWith(expect.objectContaining({ harness: 'codex' }));
  });

  it('codex: a thread-id record failure does not fail an adopted continue', async () => {
    const h = harness(record({ harness: 'codex' }, null));
    const rollout = join(getOverdeckHome(), 'agents', 'conv-20260930-abcd', 'codex-home', 'sessions', 'r.jsonl');
    h.mocks.adoptRecord.mockResolvedValue({ adopted: true, vaultId: VAULT_ID, path: rollout, newSessionId: NEW_SESSION, lines: 1 });
    h.mocks.resolveCodexRolloutPath.mockResolvedValue(rollout);
    h.mocks.recordCodexRolloutSession.mockImplementation(() => { throw new Error('ENOENT'); });
    expect((await continueHere(VAULT_ID, { expectedOwnerToken: TOKEN }, h.deps)).status).toBe(200);
    expect(h.mocks.createVaultContinuedConversation).toHaveBeenCalled();
  });

  it('codex: a rollout the conversation would not resolve returns 500 and creates no row', async () => {
    const h = harness(record({ harness: 'codex' }, null));
    h.mocks.adoptRecord.mockResolvedValue({ adopted: true, vaultId: VAULT_ID, path: '/elsewhere/r.jsonl', newSessionId: NEW_SESSION, lines: 1 });
    h.mocks.resolveCodexRolloutPath.mockResolvedValue(null);
    expect((await continueHere(VAULT_ID, { expectedOwnerToken: TOKEN }, h.deps)).status).toBe(500);
    expect(h.mocks.createVaultContinuedConversation).not.toHaveBeenCalled();
  });

  it('a materialized path mismatch returns 500 and creates no row', async () => {
    const h = harness(record());
    h.mocks.adoptRecord.mockResolvedValue({ adopted: true, vaultId: VAULT_ID, path: '/elsewhere.jsonl', newSessionId: NEW_SESSION, lines: 1 });
    const result = await continueHere(VAULT_ID, { expectedOwnerToken: TOKEN }, h.deps);
    expect(result.status).toBe(500);
    expect(h.mocks.createVaultContinuedConversation).not.toHaveBeenCalled();
  });

  it('refuses other harnesses with 400 and records owned here with 409', async () => {
    expect(await continueHere(VAULT_ID, { expectedOwnerToken: TOKEN }, harness(record({ harness: 'opencode' })).deps))
      .toMatchObject({ status: 400, body: { error: 'opencode has no native resume. Run: pan vault resume abcdef12' } });
    const mine = harness(record({ owner: { environmentId: 'env-here', label: 'laptop-b' } }));
    expect(await continueHere(VAULT_ID, { expectedOwnerToken: TOKEN }, mine.deps)).toMatchObject({ status: 409, body: { code: 'owned-here' } });
  });

  it('a failed apply returns wip-failed and adopts nothing', async () => {
    const h = harness(record());
    h.mocks.applyWipSnapshot.mockResolvedValue({ status: 'failed', reason: 'bundle missing' });
    expect(await continueHere(VAULT_ID, { expectedOwnerToken: TOKEN }, h.deps))
      .toMatchObject({ status: 409, body: { code: 'wip-failed', error: 'Cannot apply the code snapshot: bundle missing' } });
    expect(h.mocks.adoptRecord).not.toHaveBeenCalled();
  });
});
