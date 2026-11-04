/**
 * PAN-4820 WI-9: Deft's human-merge policy (AD-15) and the auto-merge hold.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { deftAutoMergeHold, readDeftPolicy, requireHumanMergeOf } from '../policy.js';

const scratch = mkdtempSync(join(tmpdir(), 'deft-policy-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function worktreeWith(definition: string | null): string {
  const root = mkdtempSync(join(scratch, 'wt-'));
  if (definition !== null) {
    mkdirSync(join(root, 'xbrief'));
    writeFileSync(join(root, 'xbrief', 'PROJECT-DEFINITION.xbrief.json'), definition);
  }
  return root;
}

const withPolicy = (policy: unknown, key = 'x-directive/policy') => JSON.stringify({ plan: { id: 'p', [key]: policy } });

describe('requireHumanMergeOf', () => {
  it('follows a typed requireHumanMerge', async () => {
    expect(requireHumanMergeOf(await readDeftPolicy(worktreeWith(withPolicy({ requireHumanMerge: true }))))).toBe(true);
    expect(requireHumanMergeOf(await readDeftPolicy(worktreeWith(withPolicy({ requireHumanMerge: false, autoDeployOnMerge: true }))))).toBe(false);
  });

  it('is true for a malformed value', async () => {
    expect(requireHumanMergeOf(await readDeftPolicy(worktreeWith(withPolicy({ requireHumanMerge: 'no' }))))).toBe(true);
  });

  it('is true when absent and autoDeployOnMerge is true', async () => {
    expect(requireHumanMergeOf(await readDeftPolicy(worktreeWith(withPolicy({ autoDeployOnMerge: true }))))).toBe(true);
  });

  it('is false when absent and autoDeployOnMerge is not true', async () => {
    expect(requireHumanMergeOf(await readDeftPolicy(worktreeWith(withPolicy({ autoDeployOnMerge: 'yes' }))))).toBe(false);
    expect(requireHumanMergeOf(await readDeftPolicy(worktreeWith(JSON.stringify({ plan: { id: 'p' } }))))).toBe(false);
  });

  it('reads the legacy plan.policy key', async () => {
    expect(requireHumanMergeOf(await readDeftPolicy(worktreeWith(withPolicy({ requireHumanMerge: true }, 'policy'))))).toBe(true);
  });

  it('is true for a missing or unparseable file', async () => {
    expect(await readDeftPolicy(worktreeWith(null))).toEqual({ policy: null, readable: false });
    expect(requireHumanMergeOf(await readDeftPolicy(worktreeWith(null)))).toBe(true);
    expect(requireHumanMergeOf(await readDeftPolicy(worktreeWith('{ not json')))).toBe(true);
  });
});

describe('deftAutoMergeHold', () => {
  it('holds a Deft issue that requires a human merge', async () => {
    const worktree = worktreeWith(withPolicy({ requireHumanMerge: true }));
    expect(await deftAutoMergeHold('pan-1', { isDeft: async () => true, workspacePath: () => worktree }))
      .toBe('PAN-1 runs on Deft and requires a human merge');
  });

  it('holds a Deft issue without a workspace, because the policy is unknown', async () => {
    expect(await deftAutoMergeHold('PAN-1', { isDeft: async () => true, workspacePath: () => null })).not.toBeNull();
  });

  it('does not hold a Deft issue whose policy allows bot merges, or an Overdeck issue', async () => {
    const worktree = worktreeWith(withPolicy({ requireHumanMerge: false }));
    expect(await deftAutoMergeHold('PAN-1', { isDeft: async () => true, workspacePath: () => worktree })).toBeNull();
    expect(await deftAutoMergeHold('PAN-1', { isDeft: async () => false, workspacePath: () => null })).toBeNull();
  });
});
