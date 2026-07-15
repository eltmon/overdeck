/** Mechanical Definition-of-Done row checks. */

import { getReviewStatusSync, type ReviewStatus } from '../review-status.js';
import {
  getProjectConfigFromWorkspacePath,
  readIssueRecordSync,
  resolveProjectForIssue,
  type PanIssuePipelineRecord,
} from '../pan-dir/record.js';
import { DOD_ROWS, type DodRowId, type DodRowResult } from './dod.js';

type StatusSource =
  | { source: 'live'; status: ReviewStatus }
  | { source: 'journal'; status: PanIssuePipelineRecord }
  | null;

export interface DodStatusRowDeps {
  getReviewStatus: (issueId: string) => ReviewStatus | null;
  getJournalStatus: (issueId: string) => PanIssuePipelineRecord | null;
}

const defaultDeps: DodStatusRowDeps = {
  getReviewStatus: getReviewStatusSync,
  getJournalStatus: issueId => {
    const project = resolveProjectForIssue(issueId) ?? getProjectConfigFromWorkspacePath(process.cwd());
    return readIssueRecordSync(project, issueId)?.pipeline ?? null;
  },
};

function rowDefinition(id: DodRowId) {
  const row = DOD_ROWS.find(candidate => candidate.id === id);
  if (!row) throw new Error(`Unknown DoD row: ${id}`);
  return row;
}

function result(id: DodRowId, status: DodRowResult['status'], observed: string): DodRowResult {
  const row = rowDefinition(id);
  return { id, num: row.num, title: row.title, expected: row.expected, observed, status };
}

function loadStatus(issueId: string, deps: DodStatusRowDeps): StatusSource {
  try {
    const live = deps.getReviewStatus(issueId);
    if (live) return { source: 'live', status: live };
    const journal = deps.getJournalStatus(issueId);
    return journal ? { source: 'journal', status: journal } : null;
  } catch {
    return null;
  }
}

function checkVerdict(
  issueId: string,
  id: 'review' | 'tests',
  field: 'reviewStatus' | 'testStatus',
  deps: DodStatusRowDeps,
): DodRowResult {
  const loaded = loadStatus(issueId, deps);
  if (!loaded) return result(id, 'miss', 'no review status or journal record found');

  const value = loaded.status[field];
  const source = loaded.source === 'journal' ? ' from pipeline journal' : '';
  const policy = value === 'skipped' ? ' (skipped per issue policy)' : '';
  const observed = `${field}: ${value ?? 'missing'}${source}${policy}`;
  return result(id, value === 'passed' || value === 'skipped' ? 'pass' : 'miss', observed);
}

export function checkReviewRow(issueId: string, deps: DodStatusRowDeps = defaultDeps): DodRowResult {
  return checkVerdict(issueId, 'review', 'reviewStatus', deps);
}

export function checkTestsRow(issueId: string, deps: DodStatusRowDeps = defaultDeps): DodRowResult {
  return checkVerdict(issueId, 'tests', 'testStatus', deps);
}

export function checkVerificationRow(issueId: string, deps: DodStatusRowDeps = defaultDeps): DodRowResult {
  const loaded = loadStatus(issueId, deps);
  if (!loaded) return result('verification', 'miss', 'no review status or journal record found');

  const value = loaded.status.verificationStatus;
  const commit = loaded.status.lastVerifiedCommit;
  const source = loaded.source === 'journal' ? ' from pipeline journal' : '';
  const policy = value === 'skipped' ? ' (skipped per issue policy)' : '';
  const commitNote = commit ? ` at ${commit}` : '';
  const observed = `verificationStatus: ${value ?? 'missing'}${commitNote}${source}${policy}`;
  const acceptedStatus = value === 'passed' || value === 'skipped';
  const hasRequiredCommit = loaded.source === 'journal' || Boolean(commit);
  return result('verification', acceptedStatus && hasRequiredCommit ? 'pass' : 'miss', observed);
}
