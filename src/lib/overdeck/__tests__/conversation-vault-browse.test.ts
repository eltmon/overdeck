/**
 * PAN-4436: Session Vault browse copies in `conversations` — the origin columns,
 * the browse-row door, and the readers that must never see a browse row.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { HttpServerResponse } from 'effect/unstable/http';

// OVERDECK_HOME is captured when the path helpers load, so set it before the
// first dynamic import of the infra and conversation modules.
const TEST_HOME = join(tmpdir(), `vault-browse-rows-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;

vi.mock('../../../dashboard/server/event-store.js', () => ({ getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })) }));
vi.mock('../../../dashboard/server/services/dashboard-poll-snapshots.js', () => ({ getConversationLedgerCostsSnapshot: vi.fn(async () => []) }));
vi.mock('../conversation-liveness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation-liveness.js')>()),
  listLiveConversationSessions: vi.fn(async () => new Set<string>()),
  conversationHarnessAlive: vi.fn(async () => false),
}));

const { closeOverdeckDatabase, getOverdeckDatabase } = await import('../infra.js');
const { OVERDECK_MIGRATION_PATH } = await import('../paths.js');
const { openDatabase } = await import('../../database/driver.js');
const {
  archiveConversation,
  createConversation,
  getConversationByName,
  listConversations,
  listVaultBrowseConversations,
  setConversationClaudeSessionId,
  setConversationProjectKey,
} = await import('../conversations.js');
const { removeVaultBrowseRow, upsertVaultBrowseRow, vaultBrowseReadOnlyMessage } = await import('../conversation-vault-rows.js');
const { listConversationsForPullRequestSync } = await import('../conversation-pull-requests.js');
const { listSessionsFeed } = await import('../sessions-feed.js');
const { getConversationListWithVaultCopies, getEnrichedConversationList, invalidateConversationListEnrichmentCache } = await import('../conversation-list.js');
const { getConversationMessagesRead, resolveSessionFile } = await import('../conversation-reads.js');
const { getConversationLedgerCosts } = await import('../conversation-ledger-costs.js');
const { vaultBrowseFilePath } = await import('../../vault/browse.js');
const { handleConversationResume } = await import('../conversation-runtime.js');
const { handleConversationMessage } = await import('../conversation-message.js');
const { conversationHarnessAlive } = await import('../conversation-liveness.js');
const { replaceListCache, setOwnedTail } = await import('../../vault/local-index.js');

async function readResponse(response: HttpServerResponse.HttpServerResponse): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: response.status, body: JSON.parse(await HttpServerResponse.toWeb(response).text()) as Record<string, unknown> };
}

const CWD = join(TEST_HOME, 'projects', 'lexerra');

function vaultId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function input(id: string, extra: Partial<Parameters<typeof upsertVaultBrowseRow>[0]> = {}) {
  return {
    vaultId: id,
    title: 'saved on the laptop',
    harness: 'claude-code' as const,
    ownerLabel: 'laptop',
    cwd: '/home/other/proj',
    model: 'claude-opus-5-5',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
    ...extra,
  };
}

beforeAll(() => {
  mkdirSync(CWD, { recursive: true });
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('browse-row door (PAN-4436 WI-3)', () => {
  it('inserts an ended vault row with no conversation files', () => {
    const id = vaultId(1);
    expect(upsertVaultBrowseRow(input(id))).toBe('inserted');
    const row = getConversationByName(`vault-${id}`);
    expect(row).toMatchObject({
      origin: 'vault',
      status: 'ended',
      vaultOwnerLabel: 'laptop',
      title: 'saved on the laptop',
      titleSource: 'manual',
      tmuxSession: `conv-vault-${id}`,
      harness: 'claude-code',
      cwd: '/home/other/proj',
      archivedAt: null,
    });
    expect(row?.endedAt).not.toBeNull();
    const files = getOverdeckDatabase()
      .prepare(`SELECT COUNT(*) AS n FROM conversation_files cf JOIN conversations c ON c.id = cf.conversation_id WHERE c.name = ?`)
      .get(`vault-${id}`) as { n: number };
    expect(files.n).toBe(0);
    expect(vaultBrowseReadOnlyMessage(row!)).toBe(`Read-only copy from laptop. To continue it here, run: pan vault resume ${id}`);
  });

  it('reports updated for a new title and unchanged for identical input', () => {
    const id = vaultId(2);
    upsertVaultBrowseRow(input(id));
    expect(upsertVaultBrowseRow(input(id, { title: 'renamed' }))).toBe('updated');
    expect(getConversationByName(`vault-${id}`)?.title).toBe('renamed');
    expect(upsertVaultBrowseRow(input(id, { title: 'renamed' }))).toBe('unchanged');
  });

  it('never writes a null ended_at, even for an unparseable timestamp', () => {
    const id = vaultId(3);
    upsertVaultBrowseRow(input(id, { updatedAt: 'not a date', createdAt: 'nope' }));
    expect(getConversationByName(`vault-${id}`)?.endedAt).not.toBeNull();
  });

  it('keeps archive state and project key across an upsert', () => {
    const id = vaultId(4);
    upsertVaultBrowseRow(input(id));
    archiveConversation(`vault-${id}`);
    setConversationProjectKey(`vault-${id}`, 'overdeck');
    expect(upsertVaultBrowseRow(input(id, { title: 'new title' }))).toBe('updated');
    const row = getConversationByName(`vault-${id}`);
    expect(row?.archivedAt).not.toBeNull();
    expect(row?.projectKey).toBe('overdeck');
    expect(row?.title).toBe('new title');
  });

  it('returns conflict and leaves a local row holding the name untouched', () => {
    const id = vaultId(5);
    getOverdeckDatabase()
      .prepare(`INSERT INTO conversations (id, name, cwd, title, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('local-5', `vault-${id}`, CWD, 'local title', 1);
    expect(upsertVaultBrowseRow(input(id))).toBe('conflict');
    expect(getConversationByName(`vault-${id}`)).toMatchObject({ origin: 'local', title: 'local title', cwd: CWD });
    expect(removeVaultBrowseRow(id)).toBe(false);
    expect(getConversationByName(`vault-${id}`)).not.toBeNull();
  });

  it('listConversations omits browse rows; listVaultBrowseConversations returns only them', () => {
    const id = vaultId(6);
    upsertVaultBrowseRow(input(id));
    createConversation({ name: 'local-list-6', tmuxSession: 'conv-local-list-6', cwd: CWD, workspaceId: null });
    const local = listConversations();
    expect(local.map((row) => row.name)).toContain('local-list-6');
    expect(local.map((row) => row.name)).not.toContain(`vault-${id}`);
    expect(local.some((row) => row.origin === 'vault')).toBe(false);
    const browse = listVaultBrowseConversations();
    expect(browse.map((row) => row.name)).toContain(`vault-${id}`);
    expect(browse.every((row) => row.origin === 'vault')).toBe(true);
  });

  it('reserves the vault- name prefix', () => {
    expect(() => createConversation({ name: 'vault-x', tmuxSession: 'conv-vault-x', cwd: CWD, workspaceId: null }))
      .toThrow('conversation names starting with "vault-" are reserved for Session Vault browse copies');
  });

  it('removes a browse row that a local fork points at, detaching the fork', () => {
    const id = vaultId(7);
    upsertVaultBrowseRow(input(id));
    createConversation({ name: 'fork-of-7', tmuxSession: 'conv-fork-of-7', cwd: CWD, workspaceId: null, parentName: `vault-${id}` });
    expect(getConversationByName('fork-of-7')?.parentConversationId).not.toBeNull();
    expect(removeVaultBrowseRow(id)).toBe(true);
    expect(getConversationByName(`vault-${id}`)).toBeNull();
    expect(getConversationByName('fork-of-7')?.parentConversationId).toBeNull();
    expect(removeVaultBrowseRow(id)).toBe(false);
  });
});

describe('raw readers skip browse rows (PAN-4436 WI-4)', () => {
  it('the pull-request sweep never lists an unarchived browse row', () => {
    const id = vaultId(8);
    upsertVaultBrowseRow(input(id));
    createConversation({ name: 'local-pr-8', tmuxSession: 'conv-local-pr-8', cwd: CWD, workspaceId: null });
    const names = listConversationsForPullRequestSync().map((row) => row.name);
    expect(names).toContain('local-pr-8');
    expect(names).not.toContain(`vault-${id}`);
  });

  it('the managed-archived feed omits an archived browse row and keeps an archived local row', () => {
    const id = vaultId(9);
    upsertVaultBrowseRow(input(id));
    archiveConversation(`vault-${id}`);
    createConversation({ name: 'local-archived-9', tmuxSession: 'conv-local-archived-9', cwd: CWD, workspaceId: null });
    archiveConversation('local-archived-9');
    const names = listSessionsFeed({ source: 'managed-archived', limit: 200 }).rows.map((row) => row.conversationName);
    expect(names).toContain('local-archived-9');
    expect(names).not.toContain(`vault-${id}`);
  });
});

describe('browse rows in the list, transcript and cost (PAN-4436 WI-5)', () => {
  const id = vaultId(10);
  const name = `vault-${id}`;

  beforeAll(() => {
    upsertVaultBrowseRow(input(id));
    const path = vaultBrowseFilePath(id, 'claude-code');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, [
      JSON.stringify({ type: 'user', uuid: 'u-1', timestamp: '2026-09-02T09:00:00.000Z', message: { role: 'user', content: 'hello from the laptop' } }),
      JSON.stringify({
        type: 'assistant', uuid: 'a-1', timestamp: '2026-09-02T09:00:05.000Z',
        message: {
          id: 'msg_1', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'hello back from the laptop' }],
          usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      }),
    ].join('\n') + '\n');
    createConversation({ name: 'local-list-10', tmuxSession: 'conv-local-list-10', cwd: CWD, workspaceId: null });
  });

  it('GET /api/conversations adds browse rows after local rows on the first page only', async () => {
    invalidateConversationListEnrichmentCache();
    const rows = await getConversationListWithVaultCopies(500, 0) as Array<Record<string, unknown>>;
    const localIndex = rows.findIndex((row) => row.name === 'local-list-10');
    const browseIndex = rows.findIndex((row) => row.name === name);
    expect(localIndex).toBeGreaterThanOrEqual(0);
    expect(browseIndex).toBeGreaterThan(localIndex);
    expect(rows[browseIndex]).toMatchObject({
      origin: 'vault', vaultOwnerLabel: 'laptop', sessionAlive: false, isWorking: false, totalCost: 0, totalTokens: 0,
      pendingInputCount: 0, pendingInputKinds: [], transcriptMissing: false, needsTerminal: false, pullRequest: null,
    });
    expect(rows[browseIndex]!.lastActivityAt).toBe(rows[browseIndex]!.endedAt);
    const later = await getConversationListWithVaultCopies(500, 10) as Array<Record<string, unknown>>;
    expect(later.some((row) => row.origin === 'vault')).toBe(false);
  });

  it('the Agents Directory and lanes source never sees a browse row', async () => {
    invalidateConversationListEnrichmentCache();
    const rows = await getEnrichedConversationList(500, 0) as Array<Record<string, unknown>>;
    expect(rows.some((row) => row.origin === 'vault')).toBe(false);
  });

  it('resolveSessionFile returns the browse cache file, with the rollout- prefix for Codex', async () => {
    expect(await resolveSessionFile(getConversationByName(name)!)).toBe(vaultBrowseFilePath(id, 'claude-code'));
    const codexId = vaultId(11);
    upsertVaultBrowseRow(input(codexId, { harness: 'codex' }));
    const codexPath = await resolveSessionFile(getConversationByName(`vault-${codexId}`)!);
    expect(codexPath).toBe(vaultBrowseFilePath(codexId, 'codex'));
    expect(codexPath).toMatch(/rollout-/);
  });

  it('reading the messages returns the transcript at zero cost and writes no cost', async () => {
    const db = getOverdeckDatabase();
    const costEventsBefore = (db.prepare('SELECT COUNT(*) AS n FROM cost_events').get() as { n: number }).n;
    const read = await getConversationMessagesRead(name, { resolveSessionFile, shouldReportUnresolvedLiveSession: () => false });
    expect(read.status ?? 200).toBe(200);
    const body = read.body as { messages: unknown[]; totalCost: number; totalTokens: number };
    expect(JSON.stringify(body.messages)).toContain('hello from the laptop');
    expect(JSON.stringify(body.messages)).toContain('hello back from the laptop');
    expect(body.totalCost).toBe(0);
    expect(body.totalTokens).toBe(0);
    expect(getConversationByName(name)).toMatchObject({ totalCost: 0, totalTokens: 0 });
    expect((db.prepare('SELECT COUNT(*) AS n FROM cost_events').get() as { n: number }).n).toBe(costEventsBefore);
  });

  it('the conversation ledger costs never key a browse row', () => {
    getOverdeckDatabase()
      .prepare('INSERT INTO cost_events (ts, session_id, cost, input, output, cache_read, cache_write) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(Date.now(), id, 1.5, 10, 10, 0, 0);
    const row = getConversationByName(name)!;
    expect(getConversationLedgerCosts().has(String(row.id))).toBe(false);
  });
});

describe('browse rows refuse resume (PAN-4436 WI-6)', () => {
  it('resume returns 409 with the full vault id and starts nothing', async () => {
    const id = vaultId(12);
    upsertVaultBrowseRow(input(id));
    vi.mocked(conversationHarnessAlive).mockClear();
    const { status, body } = await readResponse(await handleConversationResume(`vault-${id}`, {}, { resolveSessionFile }));
    expect(status).toBe(409);
    expect(body).toEqual({
      error: `Read-only copy from laptop. To continue it here, run: pan vault resume ${id}`,
      code: 'vault-browse-copy',
    });
    // The guard returns before the first runtime probe, so no session is looked up or spawned.
    expect(conversationHarnessAlive).not.toHaveBeenCalled();
    expect(getConversationByName(`vault-${id}`)).toMatchObject({ status: 'ended' });
  });

  it('a message to a browse row is refused by the ended-row guard', async () => {
    const id = vaultId(13);
    upsertVaultBrowseRow(input(id));
    const { status } = await readResponse(await handleConversationMessage(`vault-${id}`, { message: 'hi' }));
    expect(status).toBe(422);
  });
});

describe('origin column top-ups (PAN-4436 WI-3)', () => {
  const COLUMNS = ['origin', 'vault_owner_label'];
  let dbPath = '';

  afterEach(() => {
    vi.restoreAllMocks();
    closeOverdeckDatabase();
    if (dbPath) rmSync(join(dbPath, '..'), { recursive: true, force: true });
    dbPath = '';
  });

  function columns(db: ReturnType<typeof getOverdeckDatabase>): string[] {
    return db.prepare('PRAGMA table_info(conversations)').all<{ name: string }>().map((column) => column.name);
  }

  it('adds both columns to a database created without them, silently on the second run', () => {
    const dir = join(TEST_HOME, 'pre-4436');
    mkdirSync(dir, { recursive: true });
    dbPath = join(dir, 'overdeck.db');

    // A database from before this change: the init migration without the two lines.
    const migration = readFileSync(OVERDECK_MIGRATION_PATH, 'utf8')
      .split('\n')
      .filter((line) => !/^\t`(origin|vault_owner_label)` /.test(line))
      .join('\n');
    const raw = openDatabase(dbPath);
    for (const statement of migration.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) raw.exec(trimmed);
    }
    for (const column of COLUMNS) expect(columns(raw)).not.toContain(column);
    raw.close();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const upgraded = getOverdeckDatabase(dbPath);
    for (const column of COLUMNS) expect(columns(upgraded)).toContain(column);
    upgraded.prepare('INSERT INTO conversations (id, name, cwd, created_at) VALUES (?, ?, ?, ?)').run('u1', 'probe', '/w', 1);
    expect(upgraded.prepare('SELECT origin FROM conversations WHERE id = ?').get('u1')).toEqual({ origin: 'local' });
    expect(errorSpy).not.toHaveBeenCalled();

    closeOverdeckDatabase();
    getOverdeckDatabase(dbPath);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('vault continuity on list rows (PAN-4447)', () => {
  it('conversation-list-continuity.ac1/ac3: a local row owned elsewhere gets vaultContinuity on both pages', async () => {
    const name = 'local-continuity-14';
    createConversation({ name, tmuxSession: `conv-${name}`, cwd: CWD, workspaceId: null });
    setConversationClaudeSessionId(name, 'session-continuity-14');
    const recordId = vaultId(14);
    await setOwnedTail(join(TEST_HOME, 'session-continuity-14.jsonl'), {
      vaultId: recordId, harness: 'claude-code', tail: { lineCount: 1, byteOffset: 10, lastHashes: [] },
    });
    await replaceListCache([
      { vaultId: recordId, title: 'continued elsewhere', harness: 'claude-code', ownerLabel: 'laptop', ownerIsHere: false, updatedAt: new Date().toISOString(), tombstone: false },
    ]);

    invalidateConversationListEnrichmentCache();
    const page1 = await getConversationListWithVaultCopies(500, 0) as Array<Record<string, unknown>>;
    const row = page1.find((r) => r.name === name);
    expect(row?.vaultContinuity).toEqual({ kind: 'continued-elsewhere', vaultId: recordId, ownerLabel: 'laptop' });

    invalidateConversationListEnrichmentCache();
    const page2 = await getConversationListWithVaultCopies(500, 1) as Array<Record<string, unknown>>;
    expect(page2.length).toBeGreaterThan(0);
    for (const r of page2) expect(r).toHaveProperty('vaultContinuity');
  });

  it('conversation-list-continuity.ac2: browse rows get vaultContinuity null', async () => {
    invalidateConversationListEnrichmentCache();
    const rows = await getConversationListWithVaultCopies(500, 0) as Array<Record<string, unknown>>;
    const browseRows = rows.filter((r) => r.origin === 'vault');
    expect(browseRows.length).toBeGreaterThan(0);
    for (const r of browseRows) expect(r.vaultContinuity).toBeNull();
  });
});
