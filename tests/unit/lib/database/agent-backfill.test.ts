/**
 * Tests for agent-backfill.ts (PAN-1908).
 *
 * Verifies the one-time versioned backfill from state.json into the SQLite
 * agents table and the manual `pan admin db rebuild-agents` path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, type SqliteDatabase } from '../../../../src/lib/database/driver.js';
import { initSchema } from '../../../../src/lib/database/schema.js';

let testDb: SqliteDatabase;
let tmpHome: string;
let originalHome: string | undefined;

vi.mock('../../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

beforeEach(() => {
  testDb = openDatabase(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);

  tmpHome = mkdtempSync(join(tmpdir(), 'pan-backfill-home-'));
  originalHome = process.env.PANOPTICON_HOME;
  process.env.PANOPTICON_HOME = tmpHome;
  delete process.env.PANOPTICON_TMUX_SOCKET_NAME;
});

afterEach(() => {
  testDb.close();
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome === undefined) {
    delete process.env.PANOPTICON_HOME;
  } else {
    process.env.PANOPTICON_HOME = originalHome;
  }
});

import {
  backfillAgentsFromStateJsonSync,
  type BackfillAgentsResult,
} from '../../../../src/lib/database/agent-backfill.js';
import { getAgent } from '../../../../src/lib/database/agents-db.js';

function writeAgentState(agentId: string, state: Record<string, unknown>): void {
  const dir = join(tmpHome, 'agents', agentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state), 'utf-8');
}

describe('backfillAgentsFromStateJsonSync', () => {
  it('persists one agents-table row per existing state.json', () => {
    writeAgentState('agent-pan-1908', {
      id: 'agent-pan-1908',
      issueId: 'PAN-1908',
      role: 'work',
      model: 'claude-opus-4-8',
      status: 'stopped',
      workspace: '/workspaces/feature-pan-1908',
      startedAt: '2026-06-15T00:00:00.000Z',
    });
    writeAgentState('agent-pan-1909', {
      id: 'agent-pan-1909',
      issueId: 'PAN-1909',
      role: 'plan',
      model: 'claude-sonnet-4-6',
      status: 'stopped',
      workspace: '/workspaces/feature-pan-1909',
      startedAt: '2026-06-15T01:00:00.000Z',
    });

    const result = backfillAgentsFromStateJsonSync(testDb);

    expect(result.processed).toBe(2);
    expect(result.skipped).toBe(0);
    expect(getAgent('agent-pan-1908')?.issueId).toBe('PAN-1908');
    expect(getAgent('agent-pan-1909')?.issueId).toBe('PAN-1909');
  });

  it('is idempotent by id', () => {
    writeAgentState('agent-pan-1908', {
      id: 'agent-pan-1908',
      issueId: 'PAN-1908',
      role: 'work',
      status: 'stopped',
      workspace: '/workspaces/feature-pan-1908',
      startedAt: '2026-06-15T00:00:00.000Z',
    });

    backfillAgentsFromStateJsonSync(testDb);
    const second = backfillAgentsFromStateJsonSync(testDb);

    expect(second.processed).toBe(1);
    expect(testDb.prepare('SELECT COUNT(*) AS c FROM agents').get() as { c: number }).toEqual({ c: 1 });
  });

  it('marks running agents stopped when no live tmux session exists', () => {
    writeAgentState('agent-pan-1908', {
      id: 'agent-pan-1908',
      issueId: 'PAN-1908',
      role: 'work',
      status: 'running',
      workspace: '/workspaces/feature-pan-1908',
      startedAt: '2026-06-15T00:00:00.000Z',
    });

    const result = backfillAgentsFromStateJsonSync(testDb, {
      listLiveSessions: () => new Set(),
    });

    expect(result.markedStopped).toBe(1);
    const row = getAgent('agent-pan-1908');
    expect(row?.status).toBe('stopped');
    expect(row?.stoppedAt).toBeDefined();
  });

  it('keeps running agents running when a live tmux session matches', () => {
    writeAgentState('agent-pan-1908', {
      id: 'agent-pan-1908',
      issueId: 'PAN-1908',
      role: 'work',
      status: 'running',
      workspace: '/workspaces/feature-pan-1908',
      startedAt: '2026-06-15T00:00:00.000Z',
    });

    const result = backfillAgentsFromStateJsonSync(testDb, {
      listLiveSessions: () => new Set(['agent-pan-1908']),
    });

    expect(result.markedStopped).toBe(0);
    expect(getAgent('agent-pan-1908')?.status).toBe('running');
  });

  it('skips directories with missing or invalid state.json', () => {
    writeAgentState('agent-valid', {
      id: 'agent-valid',
      issueId: 'PAN-VALID',
      role: 'work',
      status: 'stopped',
      workspace: '/workspaces/feature-pan-valid',
      startedAt: '2026-06-15T00:00:00.000Z',
    });
    mkdirSync(join(tmpHome, 'agents', 'agent-no-state'), { recursive: true });
    writeAgentState('agent-no-role', { id: 'agent-no-role', status: 'stopped' });

    const result = backfillAgentsFromStateJsonSync(testDb);

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(2);
    expect(getAgent('agent-valid')).toBeDefined();
    expect(getAgent('agent-no-state')).toBeNull();
    expect(getAgent('agent-no-role')).toBeNull();
  });
});

describe('PAN-1908 backfill isolation (AC-2)', () => {
  it('only backfillAgentsFromStateJsonSync reaches into the agents directory', () => {
    const { readFileSync } = require('node:fs');
    const { resolve } = require('node:path');

    const srcRoot = resolve(__dirname, '../../../../src');
    const runtimePaths = [
      resolve(srcRoot, 'lib/agents.ts'),
      resolve(srcRoot, 'lib/cloister/deacon.ts'),
      resolve(srcRoot, 'lib/cloister/service.ts'),
    ];

    // Runtime status/listing functions must query the SQLite agents table,
    // not enumerate the filesystem. Janitorial cleanup paths (stale directory
    // purge, specialist runtime recovery, completion-marker fallback) are
    // outside this scope and remain filesystem-based.
    const runtimeFunctions = [
      'function listRunningAgentsSync',
      'function countRunningAgents',
      'function listAgentStates',
      'function resolveAgentTargetSync',
      'function autoResumeStoppedWorkAgents',
      'function recoverOrphanedAgents',
      'function nudgeStalledResumeWorkAgents',
      'function nudgeIdleWorkAgentsWithOpenBeads',
      'function checkOrphanedReviewStatuses',
      'function checkMissingReviewStatuses',
      'function reconcileClosedIssueAgents',
      'function reconcileOrphanProposedSpecs',
      'function cleanupOrphanReviewerSessions',
    ];

    const offenders: string[] = [];
    for (const file of runtimePaths) {
      const source = readFileSync(file, 'utf-8');
      const functionPattern = new RegExp(
        `(${runtimeFunctions.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[\\s\\S]*?(?=\\n(?:export |function |const |let |var |class |interface |type |// eslint))`,
        'g',
      );
      let match: RegExpExecArray | null;
      while ((match = functionPattern.exec(source)) !== null) {
        const body = match[0];
        if (/readdirSync\s*\(\s*[^)]*agents/i.test(body)) {
          offenders.push(`${file}:${match[1]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
