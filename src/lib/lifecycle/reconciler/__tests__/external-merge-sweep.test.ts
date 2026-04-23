import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetDatabase, closeDatabase, getDatabase } from '../../../database/index.js';
import { tick } from '../loop.js';

const ORIGINAL_GITHUB_REPOS = process.env.GITHUB_REPOS;

describe('external merge sweep (PAN-805)', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'pan-reconciler-'));
    process.env.PANOPTICON_HOME = tempHome;
    process.env.GITHUB_REPOS = 'PAN:eltmon/panopticon-cli';
    resetDatabase();

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeDatabase();
    rmSync(tempHome, { recursive: true, force: true });
    if (ORIGINAL_GITHUB_REPOS !== undefined) {
      process.env.GITHUB_REPOS = ORIGINAL_GITHUB_REPOS;
    } else {
      delete process.env.GITHUB_REPOS;
    }
    delete process.env.PANOPTICON_HOME;
  });

  it('detects external merge, updates canonical_state, applies merged label, and audits', async () => {
    const db = getDatabase();

    // Seed local issue_state as in_progress (not merged)
    const oldTime = new Date(Date.now() - 60000).toISOString();
    db.prepare(
      `INSERT INTO issue_state (issue_id, canonical_state, last_synced_at, updated_at)
       VALUES (?, ?, ?, ?)`
    ).run('PAN-789', 'in_progress', oldTime, oldTime);

    // Mock GitHub: listIssues returns a closed issue without merged label
    // listIssueLabels returns empty (so push will add merged)
    // addLabel succeeds
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const url = String(_url);
      if (url.includes('/issues?') && init?.method === 'GET') {
        return new Response(
          JSON.stringify([
            { number: 789, state: 'closed', labels: [] },
          ]),
          { status: 200 }
        );
      }
      if (url.endsWith('/labels') && init?.method === 'GET') {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.endsWith('/labels') && init?.method === 'POST') {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    // Drive two reconciler ticks:
    // Tick 1: external-merge-sweep detects closure → canonical_state = merged
    // Tick 2: push step applies the merged label
    const config = { repo: 'eltmon/panopticon-cli', githubToken: 'fake-token', intervalMs: 30000 };
    const state = { running: false, timer: null, mutex: false };

    await tick(config, state);
    const rowAfterSweep = db
      .prepare('SELECT canonical_state FROM issue_state WHERE issue_id = ?')
      .get('PAN-789') as { canonical_state: string };
    expect(rowAfterSweep.canonical_state).toBe('merged');

    await tick(config, state);

    // Assert merged label was applied
    const addLabelCall = vi.mocked(global.fetch).mock.calls.find(
      ([url, init]) => String(url).includes('/issues/789/labels') && (init as any)?.method === 'POST'
    );
    expect(addLabelCall).toBeDefined();

    // Assert audit trail contains external_merge_detected reason
    const audits = db
      .prepare('SELECT * FROM label_sync_audit WHERE issue_id = ? ORDER BY attempted_at')
      .all('PAN-789') as Array<{ reason: string | null; outcome: string }>;

    expect(audits.length).toBeGreaterThanOrEqual(1);
    const auditWithReason = audits.find((a) => a.reason === 'external_merge_detected');
    expect(auditWithReason).toBeDefined();
  });
});
