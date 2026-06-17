import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let TEST_HOME: string;
const originalHome = process.env.HOME;
const originalPanopticonHome = process.env.PANOPTICON_HOME;

async function resetDb() {
  const { resetDatabase } = await import('../index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-export-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.HOME = TEST_HOME;
  process.env.PANOPTICON_HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  process.env.HOME = originalHome;
  process.env.PANOPTICON_HOME = originalPanopticonHome;
  if (TEST_HOME && existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
});

async function seedConversation(name: string, overrides: Record<string, unknown> = {}) {
  const { getDatabase } = await import('../index.js');
  const db = getDatabase();
  db.prepare(`
    INSERT INTO conversations (
      name, tmux_session, status, cwd, issue_id, created_at,
      claude_session_id, title, title_seed, model, harness
    ) VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    `tmux-${name}`,
    '/work/project',
    overrides.issueId ?? null,
    overrides.createdAt ?? new Date().toISOString(),
    overrides.claudeSessionId ?? null,
    overrides.title ?? null,
    overrides.titleSeed ?? null,
    overrides.model ?? null,
    overrides.harness ?? null,
  );
}

async function seedFavorite(itemId: string) {
  const { getDatabase } = await import('../index.js');
  const db = getDatabase();
  db.prepare(`INSERT INTO favorites (type, item_id, created_at) VALUES ('conversation', ?, ?)`)
    .run(itemId, new Date().toISOString());
}

describe('exportData', () => {
  it('exports conversations and favorites without derivable rollups', async () => {
    await seedConversation('conv-1', { title: 'Alpha', titleSeed: 'alpha-seed', model: 'claude-sonnet-4', harness: 'claude-code' });
    await seedConversation('conv-2', { title: 'Beta', issueId: 'PAN-1937' });
    await seedFavorite('conv-1');

    const { exportData } = await import('../export-data.js');
    const result = exportData();

    expect(result.coreBundle.conversations).toHaveLength(2);
    expect(result.coreBundle.favorites).toHaveLength(1);

    const alpha = result.coreBundle.conversations.find((c) => c.name === 'conv-1');
    expect(alpha).toMatchObject({
      title: 'Alpha',
      titleSeed: 'alpha-seed',
      model: 'claude-sonnet-4',
      harness: 'claude-code',
    });
    // Derivative columns must not appear in the export shape.
    expect(alpha).not.toHaveProperty('totalCost');
    expect(alpha).not.toHaveProperty('totalTokens');
    expect(alpha).not.toHaveProperty('messageCount');
  });

  it('decouples cost ledger from core bundle', async () => {
    await seedConversation('conv-cost');

    const { getDatabase } = await import('../index.js');
    const db = getDatabase();
    db.prepare(`
      INSERT INTO cost_events (ts, agent_id, issue_id, session_type, provider, model, input, output, cache_read, cache_write, cost)
      VALUES (?, 'agent-pan-1937', 'PAN-1937', 'implementation', 'anthropic', 'claude-sonnet-4', 100, 50, 0, 0, 0.01)
    `).run(new Date().toISOString());

    const { exportData } = await import('../export-data.js');
    const withCost = exportData({ includeCostLedger: true });
    const withoutCost = exportData({ includeCostLedger: false });

    expect(withCost.costLedger).toHaveLength(1);
    expect(withoutCost.costLedger).toHaveLength(0);
    expect(withCost.coreBundle).toEqual(withoutCost.coreBundle);
  });

  it('excludes pre-2025-12 seed cost rows', async () => {
    const { getDatabase } = await import('../index.js');
    const db = getDatabase();
    db.prepare(`
      INSERT INTO cost_events (ts, agent_id, issue_id, session_type, provider, model, input, output, cache_read, cache_write, cost)
      VALUES (?, 'agent-1', 'PAN-1', 'implementation', 'anthropic', 'claude-sonnet-4', 1, 1, 0, 0, 0.01)
    `).run('2025-06-01T00:00:00.000Z');
    db.prepare(`
      INSERT INTO cost_events (ts, agent_id, issue_id, session_type, provider, model, input, output, cache_read, cache_write, cost)
      VALUES (?, 'agent-pan-1937', 'PAN-1937', 'implementation', 'anthropic', 'claude-sonnet-4', 1, 1, 0, 0, 0.01)
    `).run(new Date().toISOString());

    const { exportData } = await import('../export-data.js');
    const result = exportData({ includeCostLedger: true });

    expect(result.costLedger).toHaveLength(1);
    expect(result.costLedger[0]!.agentId).toBe('agent-pan-1937');
  });
});

describe('importCoreBundle', () => {
  it('imports conversations and favorites idempotently', async () => {
    await seedConversation('conv-1', { title: 'Alpha' });
    await seedFavorite('conv-1');

    const { exportData, importCoreBundle } = await import('../export-data.js');
    const exported = exportData().coreBundle;

    // Reset DB before importing.
    await resetDb();

    const result = importCoreBundle(exported);
    expect(result.conversationsImported).toBe(1);
    expect(result.favoritesImported).toBe(1);

    const { listConversations, listFavoritedIds } = await import('../conversations-db.js');
    const conversations = listConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.title).toBe('Alpha');
    expect(listFavoritedIds('conversation')).toContain('conv-1');

    // Re-import should be a no-op (idempotent).
    const reimport = importCoreBundle(exported);
    expect(reimport.conversationsImported).toBe(1);
    expect(listConversations()).toHaveLength(1);
  });

  it('rebuilds handoff and cleared-to references by name', async () => {
    await seedConversation('source');
    await seedConversation('target');

    const { getDatabase } = await import('../index.js');
    const db = getDatabase();
    const targetId = (db.prepare('SELECT id FROM conversations WHERE name = ?').get('target') as { id: number }).id;
    db.prepare('UPDATE conversations SET handoff_target_conv_id = ? WHERE name = ?').run(targetId, 'source');

    const { exportData, importCoreBundle } = await import('../export-data.js');
    const exported = exportData().coreBundle;

    await resetDb();
    importCoreBundle(exported);

    const { getConversationByName } = await import('../conversations-db.js');
    const source = getConversationByName('source');
    expect(source?.handoffTargetConvId).toBeDefined();
    const target = getConversationByName('target');
    expect(target?.id).toBe(source?.handoffTargetConvId);
  });
});
