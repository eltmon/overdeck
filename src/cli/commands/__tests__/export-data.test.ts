import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

let TEST_HOME: string;
const originalHome = process.env.HOME;
const originalPanopticonHome = process.env.PANOPTICON_HOME;

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-export-data-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.HOME = TEST_HOME;
  process.env.PANOPTICON_HOME = TEST_HOME;
});

afterEach(async () => {
  const { resetDatabase } = await import('../../../lib/database/index.js');
  resetDatabase();
  process.env.HOME = originalHome;
  process.env.PANOPTICON_HOME = originalPanopticonHome;
  if (TEST_HOME && existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
});

async function seedConversation(name: string, overrides: Record<string, unknown> = {}) {
  const { getDatabase } = await import('../../../lib/database/index.js');
  const db = getDatabase();
  db.prepare(
    `INSERT INTO conversations (
      name, tmux_session, status, cwd, issue_id, created_at, claude_session_id,
      title, title_seed, model, effort, harness
    ) VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    name,
    `tmux-${name}`,
    '/home/test/project',
    overrides.issueId ?? null,
    new Date().toISOString(),
    overrides.claudeSessionId ?? null,
    overrides.title ?? null,
    overrides.titleSeed ?? null,
    overrides.model ?? null,
    overrides.effort ?? null,
    overrides.harness ?? null,
  );
}

async function seedFavorite(itemId: string) {
  const { getDatabase } = await import('../../../lib/database/index.js');
  const db = getDatabase();
  db.prepare(`INSERT INTO favorites (type, item_id, created_at) VALUES (?, ?, ?)`).run(
    'conversation',
    itemId,
    new Date().toISOString(),
  );
}

describe('exportDataCommand', () => {
  it('exports core bundle and cost ledger', async () => {
    await seedConversation('conv-one', { title: 'One', titleSeed: 'seed-one' });
    await seedConversation('conv-two', { title: 'Two' });
    await seedFavorite('conv-one');

    const { getDatabase } = await import('../../../lib/database/index.js');
    const db = getDatabase();
    db.prepare(
      `INSERT INTO cost_events (ts, agent_id, issue_id, session_type, provider, model, input, output, cache_read, cache_write, cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      '2026-01-01T00:00:00.000Z',
      'agent-pan-1234',
      'PAN-1234',
      'work',
      'anthropic',
      'claude-sonnet-4',
      100,
      50,
      0,
      0,
      0.05,
    );

    const { exportDataCommand } = await import('../export-data.js');

    const output: unknown[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(' '));

    try {
      await exportDataCommand({ json: true, includeCostLedger: true, bundleJsonl: false });
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(output[0] as string);
    expect(parsed.conversations).toBe(2);
    expect(parsed.favorites).toBe(1);
    expect(parsed.costLedgerRows).toBe(1);
    expect(parsed.corePath).toContain('panopticon-export-core-');
    expect(parsed.costLedgerPath).toContain('panopticon-export-cost-ledger-');
    expect(existsSync(parsed.corePath)).toBe(true);
    expect(existsSync(parsed.costLedgerPath)).toBe(true);
  });

  it('omits cost ledger when disabled', async () => {
    await seedConversation('conv-three');

    const { exportDataCommand } = await import('../export-data.js');

    const output: unknown[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(' '));

    try {
      await exportDataCommand({ json: true, includeCostLedger: false, bundleJsonl: false });
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(output[0] as string);
    expect(parsed.conversations).toBe(1);
    expect(parsed.costLedgerRows).toBe(0);
    expect(parsed.costLedgerPath).toBeNull();
  });
});
