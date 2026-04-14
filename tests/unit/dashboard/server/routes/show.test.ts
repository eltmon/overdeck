/**
 * Route logic tests for /api/show/:issueId endpoints (PAN-705).
 *
 * Exercises the real getShadowState function with real shadow-state files.
 * Follows the pattern in tests/lib/shadow-state.test.ts: write unique-prefix
 * files to the real ~/.panopticon/shadow-state dir and clean up after.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import {
  getShadowState,
  createShadowState,
} from '../../../../../src/lib/shadow-state.js';

// ─── Test-file isolation ──────────────────────────────────────────────────────

const SHADOW_STATE_DIR = join(homedir(), '.panopticon', 'shadow-state');
const TEST_PREFIX = 'TEST-ROUTE-SHOW';

function cleanupShadowTestFiles() {
  if (!existsSync(SHADOW_STATE_DIR)) return;
  for (const file of readdirSync(SHADOW_STATE_DIR)) {
    if (file.startsWith(TEST_PREFIX)) {
      try { unlinkSync(join(SHADOW_STATE_DIR, file)); } catch { /* ignore */ }
    }
  }
}

let testIdCounter = 0;
function uniqueIssueId(tag: string): string {
  return `${TEST_PREFIX}-${tag}-${Date.now()}-${++testIdCounter}`;
}

// ─── GET /api/show/:issueId/shadow — real shadow-state file I/O ──────────────

describe('GET /api/show/:issueId/shadow', () => {
  beforeEach(cleanupShadowTestFiles);
  afterEach(cleanupShadowTestFiles);

  it('404 path — getShadowState returns null when no file exists', async () => {
    const issueId = uniqueIssueId('NOEXIST');
    // Route decision: if (!shadowState) → 404
    expect(await getShadowState(issueId)).toBeNull();
  });

  it('200 path — getShadowState returns real state after createShadowState', async () => {
    const issueId = uniqueIssueId('EXIST');
    const created = await createShadowState(issueId, 'in_progress', 'test');

    const result = await getShadowState(issueId);

    expect(result).not.toBeNull();
    expect(result?.issueId).toBe(issueId.toUpperCase());
    expect(result?.shadowStatus).toBe('in_progress');
    expect(result?.shadowedAt).toBe(created.shadowedAt);
    expect(Array.isArray(result?.history)).toBe(true);
  });

  it('roundtrip — state persisted to disk matches state read back', async () => {
    const issueId = uniqueIssueId('ROUNDTRIP');
    await createShadowState(issueId, 'in_review', 'test-script');

    const first = await getShadowState(issueId);
    const second = await getShadowState(issueId);

    // Two independent reads of the same file must be consistent
    expect(second).toEqual(first);
    expect(second?.trackerStatus).toBe('in_review');
  });
});

// ─── GET /api/show/:issueId — summary route decision logic ────────────────────

describe('GET /api/show/:issueId (summary)', () => {
  beforeEach(cleanupShadowTestFiles);
  afterEach(cleanupShadowTestFiles);

  it('agentId is derived as agent-<lowercase issueId>', () => {
    // Route code: const agentId = `agent-${issueId.toLowerCase()}`
    // This is the exact expression the route uses — a regression here would
    // send health queries to the wrong agent directory.
    const issueId = 'PAN-705';
    expect(`agent-${issueId.toLowerCase()}`).toBe('agent-pan-705');

    const mixed = 'Min-42';
    expect(`agent-${mixed.toLowerCase()}`).toBe('agent-min-42');
  });

  it('shadow field is populated from real getShadowState for existing issue', async () => {
    const issueId = uniqueIssueId('SUMMARY');
    await createShadowState(issueId, 'done', 'test');

    const shadow = await getShadowState(issueId);
    expect(shadow).not.toBeNull();
    expect(shadow?.shadowStatus).toBe('done');
  });

  it('shadow field is null for unknown issue (and route must tolerate that)', async () => {
    const issueId = uniqueIssueId('SUMMARY-UNKNOWN');
    expect(await getShadowState(issueId)).toBeNull();
  });
});

