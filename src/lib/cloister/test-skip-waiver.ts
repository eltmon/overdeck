/**
 * Operator waiver for the test-skip gate's `removed-test` rule (PAN-3906, PAN-4438).
 *
 * The whole-diff balance and the deleted-subject exemption cover the mechanical
 * cases. What is left is a judgment call only a human can make: "these tests
 * are genuinely gone and nothing replaces them." `pan review waive-test-removal
 * <id> --reason "…"` (or the dashboard Test/Lint panel's waiver control) records
 * that judgment against ONE head anchor, so the waiver expires the moment the
 * branch moves — a new commit gets a fresh gate, not an open door. It never
 * waives an added `.skip`/`.only`.
 *
 * The waiver lives at `<workspace>/.overdeck/test-removal-waiver.json` —
 * untracked, so granting it never dirties the tree or moves HEAD. Both doors
 * (the CLI verb and the dashboard route) call `grantTestSkipWaiver` below,
 * which is operator-only at each door, not here.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getIssueWorkspacePath } from '../overdeck/issue-projects.js';
import { loadWorkspaceMetadata } from '../remote/workspace-metadata.js';
import { snapshotWorkspaceHeads } from '../git-utils.js';

/** `<workspace>/.overdeck/test-removal-waiver.json` — untracked, never committed. */
export const TEST_SKIP_WAIVER_RELATIVE_PATH = join('.overdeck', 'test-removal-waiver.json');

export interface TestSkipWaiver {
  /** Head anchor the waiver was granted against (`snapshotWorkspaceHeadsPromise` format). */
  sha: string;
  reason: string;
  at: string;
  /** Who granted it — an operator conversation id, or `operator` for a plain shell. */
  by?: string;
}

/** A waiver applies only to the exact head it was granted against. */
export function waiverCoversHead(waiver: TestSkipWaiver | undefined, head: string | undefined): boolean {
  if (!waiver?.sha || !head) return false;
  return waiver.sha.trim() === head.trim();
}

export function testSkipWaiverPath(workspacePath: string): string {
  return join(workspacePath, TEST_SKIP_WAIVER_RELATIVE_PATH);
}

/** The stored waiver, or null when absent, unreadable, or missing sha/reason/at strings. */
export function readTestSkipWaiver(workspacePath: string): TestSkipWaiver | null {
  try {
    const raw = readFileSync(testSkipWaiverPath(workspacePath), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<TestSkipWaiver>;
    if (typeof parsed.sha !== 'string' || typeof parsed.reason !== 'string' || typeof parsed.at !== 'string') {
      return null;
    }
    return { sha: parsed.sha, reason: parsed.reason, at: parsed.at, ...(parsed.by ? { by: parsed.by } : {}) };
  } catch {
    return null;
  }
}

/** mkdir -p `.overdeck`, write `<path>.tmp`, rename over `<path>`. */
export function writeTestSkipWaiver(workspacePath: string, waiver: TestSkipWaiver): void {
  const path = testSkipWaiverPath(workspacePath);
  mkdirSync(join(workspacePath, '.overdeck'), { recursive: true });
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(waiver, null, 2));
  renameSync(tmpPath, path);
}

/**
 * The waiver on a workspace when it covers `head`, else null.
 *
 * PAN-4438: the waiver used to live on the tracked continue file, which
 * deadlocked (writing it dirtied the tree; committing it moved HEAD past the
 * anchor it pinned). It now lives at an untracked workspace path instead.
 */
export function resolveActiveTestSkipWaiver(workspacePath: string, head: string | undefined): TestSkipWaiver | null {
  if (!head) return null;
  const waiver = readTestSkipWaiver(workspacePath);
  return waiver && waiverCoversHead(waiver, head) ? waiver : null;
}

export type GrantTestSkipWaiverResult =
  | { ok: true; waiver: TestSkipWaiver; workspacePath: string }
  | { ok: false; code: 'empty-reason' | 'no-workspace' | 'remote-workspace' | 'no-head' | 'head-moved'; message: string };

/**
 * Grant a waiver for `issueId`'s workspace, pinned to its current head anchor.
 * Refuses (and writes nothing) for an empty reason, a remote or missing
 * workspace, an unreadable head, or a dashboard-supplied `expectedHead` that no
 * longer matches the live anchor.
 */
export async function grantTestSkipWaiver(input: {
  issueId: string;
  reason: string;
  by: string;
  /** Dashboard only: the anchor the operator saw. A mismatch refuses with `head-moved`. */
  expectedHead?: string;
  now?: () => Date;
}): Promise<GrantTestSkipWaiverResult> {
  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, code: 'empty-reason', message: 'A reason is required to waive a test removal.' };
  }

  let isRemote = false;
  try {
    isRemote = loadWorkspaceMetadata(input.issueId)?.location === 'remote';
  } catch {
    isRemote = false;
  }
  if (isRemote) {
    return { ok: false, code: 'remote-workspace', message: 'Remote workspaces are not supported — grant the waiver from a local workspace.' };
  }

  const workspacePath = getIssueWorkspacePath(input.issueId);
  if (!workspacePath || !existsSync(workspacePath)) {
    return { ok: false, code: 'no-workspace', message: `No workspace found for ${input.issueId}.` };
  }

  const anchor = await snapshotWorkspaceHeads(input.issueId.toUpperCase(), workspacePath);
  if (!anchor) {
    return { ok: false, code: 'no-head', message: 'Could not read the workspace head — is it a readable git repository?' };
  }

  if (input.expectedHead !== undefined && input.expectedHead.trim() !== anchor) {
    return { ok: false, code: 'head-moved', message: 'The head moved since you last saw it — reload and grant again.' };
  }

  const now = input.now ?? (() => new Date());
  const waiver: TestSkipWaiver = { sha: anchor, reason, at: now().toISOString(), by: input.by };
  writeTestSkipWaiver(workspacePath, waiver);
  return { ok: true, waiver, workspacePath };
}
