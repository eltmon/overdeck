/** Shared Definition-of-Done row definitions and gate result types. */

export type DodRowId =
  | 'review'
  | 'tests'
  | 'verification'
  | 'merged'
  | 'post-merge'
  | 'main-verify'
  | 'deploy'
  | 'teardown';

export interface DodRowDef {
  id: DodRowId;
  num: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  title: string;
  expected: string;
  overridable: boolean;
}

export const DOD_ROWS: readonly DodRowDef[] = [
  { id: 'review', num: 1, title: 'Review passed', expected: 'reviewStatus: passed', overridable: true },
  { id: 'tests', num: 2, title: 'Tests passed', expected: 'testStatus: passed', overridable: true },
  {
    id: 'verification',
    num: 3,
    title: 'Verification green on the branch',
    expected: 'verificationStatus: passed at lastVerifiedCommit',
    overridable: true,
  },
  { id: 'merged', num: 4, title: 'Merged to main', expected: 'PR merged on the forge', overridable: true },
  {
    id: 'post-merge',
    num: 5,
    title: 'Post-merge lifecycle ran',
    expected: 'agents paused, workspace stack stopped, and verifying-on-main label applied',
    overridable: true,
  },
  {
    id: 'main-verify',
    num: 6,
    title: 'Verified on main',
    expected: 'merged commit verified on main',
    overridable: true,
  },
  {
    id: 'deploy',
    num: 7,
    title: 'Deployed',
    expected: 'live server build includes the merged commit',
    overridable: true,
  },
  {
    id: 'teardown',
    num: 8,
    title: 'Close-out teardown verified',
    expected: 'workspace and configured branches removed, planning archived, issue closed, and Docker network removed',
    overridable: false,
  },
];

export function acceptFlagFor(row: DodRowDef): string {
  return `--accept-${row.id}`;
}

export type DodRowStatus = 'pass' | 'miss' | 'skip';

export interface DodRowResult {
  id: DodRowId;
  num: DodRowDef['num'];
  title: string;
  expected: string;
  observed: string;
  status: DodRowStatus;
  acceptedBy?: {
    flag: string;
    by: string;
    at: string;
  };
}

export interface DodGateResult {
  rows: DodRowResult[];
  passed: boolean;
  misses: DodRowId[];
  accepted: DodRowId[];
}
