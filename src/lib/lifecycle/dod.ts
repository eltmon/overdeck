/** Shared Definition-of-Done row definitions and gate result types. */

export type DodRowId =
  | 'review'
  | 'tests'
  | 'verification'
  | 'merged'
  | 'post-merge'
  | 'main-verify'
  | 'ship'
  | 'deploy'
  | 'teardown';

export interface DodRowDef {
  id: DodRowId;
  num: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  title: string;
  expected: string;
  overridable: boolean;
}

export const DOD_ROWS: readonly DodRowDef[] = [
  {
    id: 'review',
    num: 1,
    title: 'Review passed',
    expected: 'reviewStatus: passed, or tracker-closed with landed work and no negative review verdict',
    overridable: true,
  },
  {
    id: 'tests',
    num: 2,
    title: 'Tests passed',
    expected: 'testStatus: passed, or tracker-closed with landed work (negative verdict requires main verification pass)',
    overridable: true,
  },
  {
    id: 'verification',
    num: 3,
    title: 'Verification green on the branch',
    expected: 'verificationStatus: passed, or tracker-closed with landed work (negative verdict requires main verification pass)',
    overridable: true,
  },
  { id: 'merged', num: 4, title: 'Merged to main', expected: 'PR merged on the forge (feature or strike head), or branch work contained in main (non-PR landing)', overridable: true },
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
    id: 'ship',
    num: 7,
    title: 'Version strings propagated',
    expected: 'every declared version_sync.expect path reports the batch version',
    overridable: true,
  },
  {
    id: 'deploy',
    num: 8,
    title: 'Deployed',
    expected: 'live server build includes the merged commit',
    overridable: true,
  },
  {
    id: 'teardown',
    num: 9,
    title: 'Close-out teardown verified',
    expected: 'workspace and configured branches removed, planning archived, issue closed, and Docker network removed',
    overridable: false,
  },
];

export function acceptFlagFor(row: DodRowDef): string {
  return `--accept-${row.id}`;
}

export function canAcceptDodMisses(actor: string): boolean {
  return !actor.startsWith('flywheel-');
}

export const BRANCH_ABSENT_MERGE_ERROR = 'Feature branch is absent; positive merge evidence is required';

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
  /** PAN-3211: set only for abandoned dispositions, persisted beside the gate rows. */
  disposition?: { reason: string; by: string };
}

/**
 * PAN-3211: the gate result for an abandoned disposition — every row skipped
 * with the operator's note, so the durable audit shows the gate was
 * deliberately not evaluated rather than silently green.
 */
export function buildAbandonedDodGate(reason: string, by: string): DodGateResult {
  return {
    rows: DOD_ROWS.map(row => ({
      ...row,
      status: 'skip' as const,
      observed: `gate not evaluated — abandoned disposition recorded by ${by}: ${reason}`,
    })),
    misses: [],
    accepted: [],
    passed: true,
    disposition: { reason, by },
  };
}
