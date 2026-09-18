/**
 * PAN-3917 W1: item status and claims live in
 * `<planHome>/.pan/continues/<ISSUE>.xbrief.json`, and `markItemDone` refuses
 * a completion git cannot corroborate.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ItemNotVerifiable,
  claimItem,
  continueStatePath,
  markItemDone,
  readContinueState,
  readItemStatuses,
  readItemStatusesAsync,
  setItemStatus,
} from '../../../../src/lib/xbrief/continue-state.js';

const ISSUE = 'PAN-3917';
const ITEM = 'w1-plan-home';

let root: string;
let planHome: string;
let remote: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** A commit in the shape WORKER-RULES mandates: `Item:` in its own paragraph. */
function commitWithItemTrailer(cwd: string, itemId: string, file: string): void {
  writeFileSync(join(cwd, file), `${file}\n`, 'utf8');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-m', `feat(cli): ${file}\n\nItem: ${itemId}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'continue-state-'));
  planHome = join(root, 'repo');
  remote = join(root, 'remote.git');
  mkdirSync(planHome, { recursive: true });
  git(root, 'init', '--bare', '-q', remote);
  git(planHome, 'init', '-q', '-b', 'main');
  git(planHome, 'config', 'user.email', 'test@overdeck.local');
  git(planHome, 'config', 'user.name', 'Overdeck Test');
  git(planHome, 'config', 'commit.gpgsign', 'false');
  git(planHome, 'remote', 'add', 'origin', remote);
  writeFileSync(join(planHome, 'README.md'), 'seed\n', 'utf8');
  git(planHome, 'add', '-A');
  git(planHome, 'commit', '-q', '-m', 'chore: seed');
  git(planHome, 'push', '-q', '-u', 'origin', 'main');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('continue file location', () => {
  it('writes under <planHome>/.pan/continues and nowhere else', () => {
    setItemStatus(planHome, ISSUE, ITEM, 'in_progress');
    const path = continueStatePath(planHome, ISSUE);
    expect(path).toBe(join(planHome, '.pan', 'continues', 'PAN-3917.xbrief.json'));
    expect(existsSync(path)).toBe(true);
    expect(readItemStatuses(planHome, ISSUE)).toEqual({ [ITEM]: 'in_progress' });
  });

  it('reads an absent file as no statuses rather than throwing', async () => {
    expect(readItemStatuses(planHome, 'PAN-0')).toEqual({});
    await expect(readItemStatusesAsync(planHome, 'PAN-0')).resolves.toEqual({});
  });
});

describe('claimItem', () => {
  it('round-trips the claim through the continue file', () => {
    const claim = claimItem(planHome, ISSUE, ITEM, 'agent-7');
    expect(claim.claimedBy).toBe('agent-7');
    expect(claim.status).toBe('in_progress');
    expect(Date.parse(claim.claimedAt!)).not.toBeNaN();

    const reread = readContinueState(planHome, ISSUE)!;
    expect(reread.issueId).toBe(ISSUE);
    expect(reread.items?.[ITEM]).toEqual(claim);
  });

  it('keeps an existing status when re-claiming', () => {
    setItemStatus(planHome, ISSUE, ITEM, 'blocked');
    expect(claimItem(planHome, ISSUE, ITEM, 'agent-9').status).toBe('blocked');
  });
});

describe('markItemDone', () => {
  const options = { requireTrailer: `Item: ${ITEM}`, requirePushed: true };

  it('refuses when no commit carries the Item trailer, and writes nothing', async () => {
    commitWithItemTrailer(planHome, 'w2-other-item', 'other.ts');
    git(planHome, 'push', '-q', 'origin', 'main');

    await expect(markItemDone(planHome, ISSUE, ITEM, options)).rejects.toBeInstanceOf(ItemNotVerifiable);
    expect(existsSync(continueStatePath(planHome, ISSUE))).toBe(false);
  });

  it('does not match a trailer by prefix', async () => {
    commitWithItemTrailer(planHome, `${ITEM}-extra`, 'extra.ts');
    git(planHome, 'push', '-q', 'origin', 'main');

    await expect(markItemDone(planHome, ISSUE, ITEM, options)).rejects.toThrow(/Item: w1-plan-home/);
  });

  it('refuses while the branch is ahead of its upstream', async () => {
    commitWithItemTrailer(planHome, ITEM, 'work.ts');

    await expect(markItemDone(planHome, ISSUE, ITEM, options)).rejects.toThrow(/ahead of its upstream/);
    expect(existsSync(continueStatePath(planHome, ISSUE))).toBe(false);
  });

  it('refuses when the branch has no upstream at all', async () => {
    git(planHome, 'checkout', '-q', '-b', 'cut/w1');
    commitWithItemTrailer(planHome, ITEM, 'work.ts');

    await expect(markItemDone(planHome, ISSUE, ITEM, options)).rejects.toThrow(/no upstream/);
  });

  it('records the item when the trailer is present and the branch is pushed', async () => {
    commitWithItemTrailer(planHome, ITEM, 'work.ts');
    git(planHome, 'push', '-q', 'origin', 'main');

    const done = await markItemDone(planHome, ISSUE, ITEM, options);
    expect(done.status).toBe('completed');
    expect(Date.parse(done.doneAt!)).not.toBeNaN();
    expect(readItemStatuses(planHome, ISSUE)).toEqual({ [ITEM]: 'completed' });
  });

  it('preserves an existing claim on the item it completes', async () => {
    claimItem(planHome, ISSUE, ITEM, 'agent-7');
    commitWithItemTrailer(planHome, ITEM, 'work.ts');
    git(planHome, 'push', '-q', 'origin', 'main');

    const done = await markItemDone(planHome, ISSUE, ITEM, options);
    expect(done.claimedBy).toBe('agent-7');
  });

  it('skips the push check when requirePushed is false', async () => {
    commitWithItemTrailer(planHome, ITEM, 'work.ts');

    const done = await markItemDone(planHome, ISSUE, ITEM, { requireTrailer: `Item: ${ITEM}`, requirePushed: false });
    expect(done.status).toBe('completed');
  });
});
