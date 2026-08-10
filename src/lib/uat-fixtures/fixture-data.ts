/**
 * UAT fixture data builders (PAN-3362).
 *
 * Pure, dependency-light builders for the obviously-fake `FIX-1` issue
 * fixture set seeded into workspace containers so UI-redesign browser UAT
 * can render a live-looking issue without a tracker connection. Every
 * identifying literal is exported as a named constant so the seed writer
 * (seed.ts), the CLI command, and tests all share one source of truth.
 *
 * These builders perform no I/O — src/lib/uat-fixtures/seed.ts writes the
 * returned values through the canonical write doors (registerProjectSync,
 * CacheService.set, saveOverdeckAgentStateSync, upsertReviewStatusSync,
 * emitActivityEntryDurable) plus a direct file write for the xBRIEF plan.
 */

import { join } from 'node:path';

import { getOverdeckHome } from '../paths.js';
import type { ProjectConfig } from '../projects.js';
import type { AgentState, Role } from '../agents/agent-state.js';
import type { ReviewStatus } from '../review-status.js';
import type { EmitActivityOptions } from '../activity-logger.js';
import type { XBriefDocument, XBriefItem, XBriefSubItem } from '../xbrief/types.js';
import type { ContinueState } from '../xbrief/continue-state.js';
import type { CanonicalState } from '../shadow-state.js';

/** Reserved project key. Never register a real project under this key. */
export const FIXTURE_PROJECT_KEY = 'uat-fixtures';
/** Reserved issue-identifier prefix — never used by a real project. */
export const FIXTURE_ISSUE_PREFIX = 'FIX';
/** The single fixture issue's identifier. */
export const FIXTURE_ISSUE_ID = 'FIX-1';
export const FIXTURE_ISSUE_NUMBER = 1;
/** Fake "owner/repo" the fixture issue claims to live in — does not exist. */
export const FIXTURE_SOURCE_REPO = 'uat-fixtures/repo';
/**
 * Container-local, container-writable path for the fixture project — derived
 * from the current OVERDECK_HOME (not hardcoded) so it always matches where
 * seed.ts actually writes the plan/continue files, even under an overridden
 * container-local home (review finding, PAN-3362 cycle 3).
 */
export function fixtureProjectPath(): string {
  return join(getOverdeckHome(), FIXTURE_PROJECT_KEY, 'repo');
}
/**
 * Container-local path of the seeded FIX-1 workspace directory itself
 * (`<fixtureProjectPath>/workspaces/feature-fix-1`) — the same path
 * `GET /api/workspaces/FIX-1` derives independently from the registered
 * project path and issue id, so this must stay in lockstep with that
 * derivation (see getWorkspaceRoute in workspace-data.ts).
 */
export function fixtureWorkspacePath(): string {
  return join(fixtureProjectPath(), 'workspaces', 'feature-fix-1');
}
/** Cached-issue id, matching the `github-${owner}-${repo}-${number}` shape. */
export const FIXTURE_ISSUE_CACHE_ID = 'github-uat-fixtures-repo-1';
/** Cached-project id, matching the `github-${owner}-${repo}` shape. */
export const FIXTURE_PROJECT_CACHE_ID = 'github-uat-fixtures-repo';
/** Title prefix that marks every fixture-issue title as obviously fake. */
export const FIXTURE_TITLE_PREFIX = '[FIXTURE]';
/** Label applied to the fixture issue. */
export const FIXTURE_LABEL = 'uat-fixture';
/** Banner text explaining the fixture is not real pipeline state. */
export const FIXTURE_DESCRIPTION_BANNER =
  'This is a seeded UAT fixture issue, not real pipeline state. It was created ' +
  'by `pan admin seed-uat-fixtures` so browser verification has a live-looking ' +
  'issue to render inside an isolated workspace container.';
/**
 * Marker file written at the fixture workspace root so `GET /api/workspaces/FIX-1`
 * recognizes the seeded directory as a valid workspace structure — that route
 * treats a workspace with none of {.git, api/.git, fe/.git, src/.git,
 * .devcontainer, CLAUDE.md} as `corrupted: true` (review finding, PAN-3362 UAT
 * cycle 1). CLAUDE.md is the only one of those markers with no other consumer
 * (`.devcontainer` would additionally trip Docker stack-health/container-ops
 * code paths that expect a real compose file).
 */
export const FIXTURE_WORKSPACE_CLAUDE_MD =
  `# ${FIXTURE_TITLE_PREFIX} uat-fixtures/repo\n\n` +
  'This file exists only so the seeded workspace directory satisfies the ' +
  '`GET /api/workspaces/FIX-1` structure check. It is not a real project ' +
  'CLAUDE.md and carries no instructions.\n';
export const FIXTURE_CANONICAL_STATUS: CanonicalState = 'in_progress';
/** Fake branch name for the fixture work agent. */
export const FIXTURE_BRANCH = 'feature/fix-1';
/** Fake model identifier used on every fixture agent row. */
export const FIXTURE_AGENT_MODEL = 'fixture/uat-seed';
/** Fake PR fields — the repo `uat-fixtures/repo` does not exist. */
export const FIXTURE_PR_URL = 'https://github.com/uat-fixtures/repo/pull/1';
export const FIXTURE_PR_NUMBER = 1;
export const FIXTURE_PR_HEAD_SHA = 'fix7ure0000000000000000000000000000000f';

export const FIXTURE_WORK_AGENT_ID = 'agent-fix-1-work';
export const REVIEW_SPECIALIST_ROLES = ['security', 'correctness', 'performance', 'requirements'] as const;
export type ReviewSpecialistRole = (typeof REVIEW_SPECIALIST_ROLES)[number];

export function fixtureReviewAgentId(role: ReviewSpecialistRole): string {
  return `agent-fix-1-review-${role}`;
}

/** xBRIEF plan id for the fixture workspace's seeded plan. */
export const FIXTURE_XBRIEF_PLAN_ID = 'fix-1';
export const FIXTURE_XBRIEF_PLAN_UID = '00000000-0000-4000-8000-0000000fix01';

/** The cached-GitHub-shape normalized issue served from IssueDataService's L2 cache. */
export interface FixtureNormalizedIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  author: string;
  status: string;
  canonicalStatus: CanonicalState;
  state: CanonicalState;
  priority: number;
  labels: string[];
  url: string;
  createdAt: string;
  updatedAt: string;
  project: { id: string; name: string; color: string; icon: string };
  source: 'github';
  sourceRepo: string;
}

/** Builds the cached-GitHub-shape fixture issue (see issue-data-service.ts's github normalizer). */
export function fixtureNormalizedIssue(now: string = new Date().toISOString()): FixtureNormalizedIssue {
  return {
    id: FIXTURE_ISSUE_CACHE_ID,
    identifier: FIXTURE_ISSUE_ID,
    title: `${FIXTURE_TITLE_PREFIX} Seeded UAT fixture issue`,
    description: FIXTURE_DESCRIPTION_BANNER,
    author: 'uat-fixture-seeder',
    status: 'In Progress',
    canonicalStatus: FIXTURE_CANONICAL_STATUS,
    state: FIXTURE_CANONICAL_STATUS,
    priority: 3,
    labels: [FIXTURE_LABEL],
    url: `https://github.com/${FIXTURE_SOURCE_REPO}/issues/${FIXTURE_ISSUE_NUMBER}`,
    createdAt: now,
    updatedAt: now,
    project: {
      id: FIXTURE_PROJECT_CACHE_ID,
      name: FIXTURE_SOURCE_REPO,
      color: '#333',
      icon: 'github',
    },
    source: 'github',
    sourceRepo: FIXTURE_SOURCE_REPO,
  };
}

/** Builds the fixture project's ProjectConfig — deliberately carries no tracker fields. */
export function fixtureProjectConfig(): ProjectConfig {
  return {
    name: FIXTURE_PROJECT_KEY,
    path: fixtureProjectPath(),
    issue_prefix: FIXTURE_ISSUE_PREFIX,
  };
}

/** Builds the work agent row plus the four review-convoy sub-role rows. */
export function fixtureAgentStates(now: string = new Date().toISOString()): AgentState[] {
  const workspace = fixtureWorkspacePath();
  const workRole: Role = 'work';
  const reviewRole: Role = 'review';

  const work: AgentState = {
    id: FIXTURE_WORK_AGENT_ID,
    issueId: FIXTURE_ISSUE_ID,
    workspace,
    role: workRole,
    model: FIXTURE_AGENT_MODEL,
    status: 'stopped',
    startedAt: now,
    lastActivity: now,
    branch: FIXTURE_BRANCH,
  };

  const reviewers: AgentState[] = REVIEW_SPECIALIST_ROLES.map((role) => ({
    id: fixtureReviewAgentId(role),
    issueId: FIXTURE_ISSUE_ID,
    workspace,
    role: reviewRole,
    model: FIXTURE_AGENT_MODEL,
    status: 'stopped',
    startedAt: now,
    lastActivity: now,
    reviewSubRole: role,
  }));

  return [work, ...reviewers];
}

/** Builds the fixture ReviewStatus row: convoy approved, tests passed, PR present. */
export function fixtureReviewStatus(now: string = new Date().toISOString()): ReviewStatus {
  return {
    issueId: FIXTURE_ISSUE_ID,
    reviewStatus: 'passed',
    testStatus: 'passed',
    updatedAt: now,
    readyForMerge: true,
    prUrl: FIXTURE_PR_URL,
    prNumber: FIXTURE_PR_NUMBER,
    prHeadSha: FIXTURE_PR_HEAD_SHA,
  };
}

/**
 * Stable activity ids, one per fixtureActivityEntries() row. Fed to
 * emitActivityEntryOnce() as the idempotency key so a re-seed replaces these
 * four rows in place instead of appending duplicate visible lifecycle events.
 */
export const FIXTURE_ACTIVITY_IDS = {
  workCompleted: 'fix-1-activity-work-completed',
  reviewApproved: 'fix-1-activity-review-approved',
  testsPassed: 'fix-1-activity-tests-passed',
  seeded: 'fix-1-activity-seeded',
} as const;

/** Builds a short activity history for the fixture issue (work → review → tests). */
export function fixtureActivityEntries(): (EmitActivityOptions & { id: string })[] {
  return [
    {
      id: FIXTURE_ACTIVITY_IDS.workCompleted,
      source: 'work-agent',
      level: 'info',
      status: 'completed',
      message: `${FIXTURE_TITLE_PREFIX} Work agent completed implementation`,
      issueId: FIXTURE_ISSUE_ID,
    },
    {
      id: FIXTURE_ACTIVITY_IDS.reviewApproved,
      source: 'review-specialist',
      level: 'success',
      status: 'completed',
      message: `${FIXTURE_TITLE_PREFIX} Review convoy approved`,
      issueId: FIXTURE_ISSUE_ID,
    },
    {
      id: FIXTURE_ACTIVITY_IDS.testsPassed,
      source: 'test-specialist',
      level: 'success',
      status: 'completed',
      message: `${FIXTURE_TITLE_PREFIX} Tests passed`,
      issueId: FIXTURE_ISSUE_ID,
    },
    {
      id: FIXTURE_ACTIVITY_IDS.seeded,
      source: 'dashboard',
      level: 'info',
      message: `${FIXTURE_TITLE_PREFIX} Fixture seeded for UAT verification`,
      issueId: FIXTURE_ISSUE_ID,
    },
  ];
}

function fixtureXBriefItem(index: 1 | 2 | 3, now: string): XBriefItem {
  const id = `fix-item-${index}`;
  const acItems: XBriefSubItem[] = [1, 2].map((n) => ({
    id: `${id}.ac${n}`,
    title: `${FIXTURE_TITLE_PREFIX} Given the seeded fixture, when item ${index} is exercised, then criterion ${n} is observable`,
    status: 'pending',
    created: now,
    metadata: { kind: 'acceptance_criterion' },
  }));

  return {
    id,
    title: `${FIXTURE_TITLE_PREFIX} Fixture task ${index}`,
    status: 'pending',
    priority: 'medium',
    created: now,
    metadata: {
      difficulty: 'simple',
      kind: 'test',
      issueLabel: FIXTURE_ISSUE_ID.toLowerCase(),
      requiresInspection: false,
      readiness: 'ready',
      files_scope: [],
      files_scope_confidence: 'high',
    },
    narrative: { Action: `${FIXTURE_TITLE_PREFIX} Placeholder task ${index} used only to exercise the Plan tab.` },
    items: acItems,
  };
}

/** Builds a valid xBRIEF v0.8 document: 3 items, 2 acceptance criteria each. */
export function fixtureXBriefDoc(now: string = new Date().toISOString()): XBriefDocument {
  return {
    xBRIEFInfo: {
      version: '0.8',
      created: now,
      author: 'overdeck/uat-fixtures',
      description: `Fixture plan for ${FIXTURE_ISSUE_ID}: seeded UAT fixture issue`,
    },
    plan: {
      id: FIXTURE_XBRIEF_PLAN_ID,
      title: `${FIXTURE_TITLE_PREFIX} Seeded UAT fixture issue`,
      status: 'approved',
      uid: FIXTURE_XBRIEF_PLAN_UID,
      author: 'uat-fixtures-seeder',
      sequence: 1,
      created: now,
      updated: now,
      tags: [FIXTURE_LABEL],
      narratives: {
        Problem: FIXTURE_DESCRIPTION_BANNER,
        Proposal: 'No real work — this plan exists only to give the Plan tab a non-zero item count.',
        NonGoals: '- none',
      },
      items: [fixtureXBriefItem(1, now), fixtureXBriefItem(2, now), fixtureXBriefItem(3, now)],
      edges: [],
    },
  };
}

/** Builds the fixture workspace's continue.json. */
export function fixtureContinueJson(now: string = new Date().toISOString()): ContinueState {
  return {
    version: '1',
    issueId: FIXTURE_ISSUE_ID,
    created: now,
    updated: now,
    gitState: { branch: FIXTURE_BRANCH, dirty: false },
    decisions: [],
    hazards: [],
    resumePoint: null,
    agentModel: FIXTURE_AGENT_MODEL,
    sessionHistory: [
      {
        timestamp: now,
        reason: 'manual',
        note: `${FIXTURE_TITLE_PREFIX} Seeded by pan admin seed-uat-fixtures`,
        agentModel: FIXTURE_AGENT_MODEL,
      },
    ],
  };
}
