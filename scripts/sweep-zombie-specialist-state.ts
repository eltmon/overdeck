#!/usr/bin/env bun
/**
 * One-shot zombie-sweep for ~/.panopticon/agents/ — removes specialist
 * state.json dirs left behind by the incomplete post-merge cleanup
 * (pre-fix, the merge-agent only deleted agent-<issue> and planning-<issue>
 *  but never the agent-<issue>-{review,review-*,test,ship} specialist dirs).
 *
 * Safety rules — a dir is swept iff ALL of the following hold:
 *   1. Its state.json exists and parses.
 *   2. Its `role` is a specialist role: review, test, ship, or any sub-role
 *      (work agents and work-slots are NEVER swept).
 *   3. The issue tracker reports the issue as CLOSED.
 *   4. The work-agent state dir for the issue is already gone (sanity check —
 *      confirms the merge teardown actually ran for this issue).
 *
 * Prints a plan; pass --apply to actually delete.
 */

import { readdir, readFile, rm, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const AGENTS_DIR = join(homedir(), '.panopticon', 'agents');
const APPLY = process.argv.includes('--apply');

const SPECIALIST_ROLES = new Set(['review', 'test', 'ship']);

interface AgentState {
  id?: string;
  issueId?: string;
  role?: string;
}

async function loadState(dir: string): Promise<AgentState | null> {
  try {
    const raw = await readFile(join(AGENTS_DIR, dir, 'state.json'), 'utf-8');
    return JSON.parse(raw) as AgentState;
  } catch {
    return null;
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function issueIsClosed(issueId: string): Promise<boolean | null> {
  const m = issueId.match(/^[A-Za-z]+-(\d+)$/);
  if (!m) return null; // non-numeric (e.g. PAN-TEST-1) — skip
  const num = m[1];
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['issue', 'view', num, '--repo', 'eltmon/panopticon-cli', '--json', 'state'],
      { encoding: 'utf-8' },
    );
    const parsed = JSON.parse(stdout) as { state?: string };
    return parsed.state === 'CLOSED';
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const entries = await readdir(AGENTS_DIR);
  const issueClosedCache = new Map<string, boolean | null>();
  const toDelete: string[] = [];
  const skipped: Array<{ dir: string; reason: string }> = [];

  for (const dir of entries) {
    if (!dir.startsWith('agent-')) {
      skipped.push({ dir, reason: 'not an agent dir' });
      continue;
    }
    const state = await loadState(dir);
    if (!state) {
      skipped.push({ dir, reason: 'no state.json' });
      continue;
    }
    const role = state.role;
    if (!role || !SPECIALIST_ROLES.has(role)) {
      skipped.push({ dir, reason: `role=${role ?? 'unknown'} (not a specialist)` });
      continue;
    }
    const issueId = state.issueId;
    if (!issueId) {
      skipped.push({ dir, reason: 'no issueId' });
      continue;
    }
    if (!issueClosedCache.has(issueId)) {
      issueClosedCache.set(issueId, await issueIsClosed(issueId));
    }
    const closed = issueClosedCache.get(issueId);
    if (closed !== true) {
      skipped.push({ dir, reason: `issue ${issueId} not confirmed CLOSED (state=${closed === null ? 'unknown' : 'open'})` });
      continue;
    }
    const workDir = join(AGENTS_DIR, `agent-${issueId.toLowerCase()}`);
    if (await dirExists(workDir)) {
      skipped.push({ dir, reason: `work agent state still present for ${issueId} — refusing to sweep` });
      continue;
    }
    toDelete.push(dir);
  }

  console.log(`Plan: would delete ${toDelete.length} zombie specialist dir(s).`);
  for (const d of toDelete) console.log(`  rm -rf ${join(AGENTS_DIR, d)}`);
  if (skipped.length > 0) {
    console.log(`\nSkipped ${skipped.length} dir(s):`);
    for (const { dir, reason } of skipped) console.log(`  ${dir}: ${reason}`);
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to delete.');
    return;
  }

  let removed = 0;
  for (const d of toDelete) {
    try {
      await rm(join(AGENTS_DIR, d), { recursive: true, force: true });
      removed++;
    } catch (err) {
      console.warn(`Failed to remove ${d}: ${(err as Error).message}`);
    }
  }
  console.log(`\nRemoved ${removed} dir(s).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
