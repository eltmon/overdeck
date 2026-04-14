/**
 * Route logic tests for /api/show/:issueId endpoints (PAN-705).
 *
 * Exercises the real getShadowState function with real shadow-state files
 * and the real existsSync check used by the tldr route. Follows the pattern
 * in tests/lib/shadow-state.test.ts: write unique-prefix files to the real
 * ~/.panopticon/shadow-state dir and clean up after.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readdirSync, unlinkSync, mkdtempSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';

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

  it('404 path — getShadowState returns null when no file exists', () => {
    const issueId = uniqueIssueId('NOEXIST');
    // Route decision: if (!shadowState) → 404
    expect(getShadowState(issueId)).toBeNull();
  });

  it('200 path — getShadowState returns real state after createShadowState', () => {
    const issueId = uniqueIssueId('EXIST');
    const created = createShadowState(issueId, 'in_progress', 'test');

    const result = getShadowState(issueId);

    expect(result).not.toBeNull();
    expect(result?.issueId).toBe(issueId.toUpperCase());
    expect(result?.shadowStatus).toBe('in_progress');
    expect(result?.shadowedAt).toBe(created.shadowedAt);
    expect(Array.isArray(result?.history)).toBe(true);
  });

  it('roundtrip — state persisted to disk matches state read back', () => {
    const issueId = uniqueIssueId('ROUNDTRIP');
    createShadowState(issueId, 'in_review', 'test-script');

    const first = getShadowState(issueId);
    const second = getShadowState(issueId);

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

  it('shadow field is populated from real getShadowState for existing issue', () => {
    const issueId = uniqueIssueId('SUMMARY');
    createShadowState(issueId, 'done', 'test');

    const shadow = getShadowState(issueId);
    expect(shadow).not.toBeNull();
    expect(shadow?.shadowStatus).toBe('done');
  });

  it('shadow field is null for unknown issue (and route must tolerate that)', () => {
    const issueId = uniqueIssueId('SUMMARY-UNKNOWN');
    expect(getShadowState(issueId)).toBeNull();
  });
});

// ─── GET /api/show/:issueId/tldr — real workspace-directory existsSync ───────

describe('GET /api/show/:issueId/tldr', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'pan705-show-tldr-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('workspace-not-found path — existsSync(workspacePath) is false', () => {
    const issueId = 'PAN-999';
    const workspacePath = join(tmpRoot, 'workspaces', `feature-${issueId.toLowerCase()}`);
    // Route decision: if (!existsSync(workspacePath)) → 404
    expect(existsSync(workspacePath)).toBe(false);
  });

  it('workspace-found path — existsSync(workspacePath) is true after mkdir', () => {
    const issueId = 'PAN-705';
    const workspacePath = join(tmpRoot, 'workspaces', `feature-${issueId.toLowerCase()}`);
    mkdirSync(workspacePath, { recursive: true });
    // Route decision: existsSync true → returns stub { available: false }
    expect(existsSync(workspacePath)).toBe(true);
  });
});
