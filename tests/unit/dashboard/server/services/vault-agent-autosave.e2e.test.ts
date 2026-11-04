/**
 * PAN-4647 WI-4 (FR-4, NFR-4): two machines in one process, switched by HOME
 * and OVERDECK_HOME, sharing one `dir:` backend. Machine A has a stopped work
 * agent whose transcript the real pipeline-agent lister and the real queued
 * settle path save; machine B joins, syncs, and sees it as a read-only copy.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPipelineAgentSubjectLister } from '../../../../../src/dashboard/server/services/vault-agent-subjects.js';
import { settleOnQueue } from '../../../../../src/dashboard/server/services/vault-service.js';
import { refreshBrowseCache } from '../../../../../src/lib/vault/browse.js';
import { readVaultConfig } from '../../../../../src/lib/vault/config.js';
import { readSessionRecord, refName } from '../../../../../src/lib/vault/format.js';
import { joinVault } from '../../../../../src/lib/vault/join-core.js';
import { readListCache } from '../../../../../src/lib/vault/local-index.js';
import { DIR_BACKEND_PREFIX, openVaultContext } from '../../../../../src/lib/vault/open.js';
import { setupVault } from '../../../../../src/lib/vault/setup-core.js';
import { syncOnce } from '../../../../../src/lib/vault/sync.js';

const SESSION = '99994647-0000-4000-8000-000000000000';
const AGENT_ID = 'agent-pan-9999';

function user(text: string, cwd: string): string {
  return JSON.stringify({ type: 'user', sessionId: SESSION, cwd, message: { role: 'user', content: text } });
}
function assistant(text: string, cwd: string): string {
  return JSON.stringify({ type: 'assistant', sessionId: SESSION, cwd, message: { role: 'assistant', model: 'claude-fable-5-1', content: [{ type: 'text', text }] } });
}

describe('Pipeline-agent autosave across two machines (PAN-4647 WI-4)', () => {
  let root: string;
  let originalEnv: { home?: string; overdeck?: string };

  function useMachine(name: string): void {
    const home = join(root, name);
    process.env.HOME = home;
    process.env.OVERDECK_HOME = join(home, '.overdeck');
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-4647-agent-autosave-e2e-'));
    originalEnv = { home: process.env.HOME, overdeck: process.env.OVERDECK_HOME };
  });

  afterEach(() => {
    if (originalEnv.home === undefined) delete process.env.HOME; else process.env.HOME = originalEnv.home;
    if (originalEnv.overdeck === undefined) delete process.env.OVERDECK_HOME; else process.env.OVERDECK_HOME = originalEnv.overdeck;
    rmSync(root, { recursive: true, force: true });
  });

  it("a finished work agent's transcript is a read-only copy on the other machine after one sync", async () => {
    const backend = `${DIR_BACKEND_PREFIX}${join(root, 'backend')}`;

    // --- Machine A: set up the vault and the stopped agent's state ---
    useMachine('machine-a');
    const setup = await setupVault({ url: backend, passphrase: { mode: 'none' } });
    expect(setup.status).toBe('created');
    if (setup.status !== 'created') return;
    const recoveryPhrase = setup.recoveryPhrase!;
    expect(recoveryPhrase).toBeTruthy();

    // Not a git checkout, so WIP capture reports no-git and adds nothing.
    const cwd = join(root, 'project');
    mkdirSync(cwd, { recursive: true });

    const transcriptPath = join(root, 'machine-a', '.claude', 'projects', '-w-feature-pan-9999', `${SESSION}.jsonl`);
    mkdirSync(join(root, 'machine-a', '.claude', 'projects', '-w-feature-pan-9999'), { recursive: true });
    writeFileSync(
      transcriptPath,
      `${[
        user('<pasted_content id="x">kickoff</pasted_content>', cwd),
        assistant('Looking into it.', cwd),
        user('thanks', cwd),
      ].join('\n')}\n`,
    );

    const overdeckHome = join(root, 'machine-a', '.overdeck');
    const agentDir = join(overdeckHome, 'agents', AGENT_ID);
    mkdirSync(agentDir, { recursive: true });
    const now = new Date();
    const stoppedAt = new Date(now.getTime() - 60_000).toISOString();
    writeFileSync(
      join(agentDir, 'state.json'),
      JSON.stringify({
        id: AGENT_ID,
        issueId: 'PAN-9999',
        role: 'work',
        status: 'stopped',
        harness: 'claude-code',
        workspace: cwd,
        model: 'claude-fable-5-1',
        startedAt: new Date(now.getTime() - 120_000).toISOString(),
        stoppedAt,
      }),
    );
    writeFileSync(
      join(agentDir, 'sessions.json'),
      `${JSON.stringify({ sessionId: SESSION, at: now.toISOString(), source: 'test', harness: 'claude-code', path: transcriptPath })}\n`,
    );

    const subjects = await createPipelineAgentSubjectLister()();
    expect(subjects).toHaveLength(1);
    const [subject] = subjects;
    expect(subject).toMatchObject({ harness: 'claude-code', transcriptPath, recordTitle: 'PAN-9999 work agent (agent-pan-9999)' });

    const outcome = await settleOnQueue(subject!.transcriptPath, subject!.harness, 'auto', { recordTitle: subject!.recordTitle });
    expect(outcome.status).toBe('settled');
    if (outcome.status !== 'settled') return;
    expect(outcome.result.verdict).toBe('append');
    const vaultId = outcome.result.vaultId;

    // --- Machine B: join, sync, list and browse the record ---
    useMachine('machine-b');
    const joined = await joinVault({ url: backend, secret: { kind: 'phrase', value: recoveryPhrase } });
    expect(joined.status).toBe('joined');
    const opened = await openVaultContext();
    expect(opened.status).toBe('open');
    if (opened.status !== 'open') return;
    await syncOnce({ store: opened.vault.store, keys: opened.vault.keys, config: await readVaultConfig() });

    const row = (await readListCache()).find((entry) => entry.vaultId === vaultId);
    expect(row).toMatchObject({ vaultId, title: 'PAN-9999 work agent (agent-pan-9999)', harness: 'claude-code', ownerIsHere: false });

    const name = refName('record', vaultId, opened.vault.keys.K_ref);
    const ref = await opened.vault.store.readRef(name);
    expect(ref).not.toBeNull();
    const record = await readSessionRecord(name, ref!.value, opened.vault.keys);
    expect(record && 'settlements' in record ? record.settlements.at(-1)?.lines : null).toBe(3);

    const refreshed = await refreshBrowseCache({ store: opened.vault.store, keys: opened.vault.keys });
    const copy = refreshed.copies.find((entry) => entry.vaultId === vaultId);
    expect(copy).toBeDefined();
    const lines = readFileSync(copy!.path, 'utf8').split('\n').filter((line) => line.length > 0);
    expect(lines).toHaveLength(3);
  });
});
