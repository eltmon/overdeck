import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';

import {
  FIXTURE_ISSUE_ID,
  FIXTURE_LABEL,
  FIXTURE_PROJECT_CACHE_ID,
  FIXTURE_PROJECT_KEY,
  FIXTURE_TITLE_PREFIX,
  REVIEW_SPECIALIST_ROLES,
  fixtureActivityEntries,
  fixtureAgentStates,
  fixtureContinueJson,
  fixtureNormalizedIssue,
  fixtureProjectConfig,
  fixtureReviewAgentId,
  fixtureReviewStatus,
  fixtureXBriefDoc,
} from '../../../../src/lib/uat-fixtures/fixture-data.js';
import { readPlanSync } from '../../../../src/lib/xbrief/io.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Every string value nested inside a JSON-serializable object, for a real-tracker-leak sweep. */
function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) allStrings(item, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) allStrings(v, out);
  }
  return out;
}

describe('fixtureNormalizedIssue', () => {
  it('matches the GitHub cache shape with fake markers (AC-1)', () => {
    const issue = fixtureNormalizedIssue();
    expect(issue.identifier).toBe('FIX-1');
    expect(issue.identifier).toBe(FIXTURE_ISSUE_ID);
    expect(issue.canonicalStatus).toBeTruthy();
    expect(issue.labels).toContain(FIXTURE_LABEL);
    expect(issue.project.id).toBe('github-uat-fixtures-repo');
    expect(issue.project.id).toBe(FIXTURE_PROJECT_CACHE_ID);
    expect(issue.title.startsWith(FIXTURE_TITLE_PREFIX)).toBe(true);
  });
});

describe('fixtureAgentStates', () => {
  it('returns one work row and four named review-convoy rows (AC-2)', () => {
    const agents = fixtureAgentStates();
    expect(agents).toHaveLength(5);

    const work = agents.find((a) => a.role === 'work');
    expect(work).toBeDefined();
    expect(work?.branch).toBe('feature/fix-1');

    for (const role of REVIEW_SPECIALIST_ROLES) {
      const expectedId = fixtureReviewAgentId(role);
      const row = agents.find((a) => a.id === expectedId);
      expect(row, `expected a review row named ${expectedId}`).toBeDefined();
      expect(row?.reviewSubRole).toBe(role);
    }
  });
});

describe('fixtureXBriefDoc / fixtureProjectConfig', () => {
  it('produces a doc that parses via the repo xBRIEF reader with 3 items of 2 ACs each (AC-3)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'uat-fixture-xbrief-'));
    tempDirs.push(dir);
    const planPath = join(dir, 'spec.vbrief.json');
    writeFileSync(planPath, JSON.stringify(fixtureXBriefDoc(), null, 2));

    const doc = readPlanSync(planPath);
    expect(doc.plan.items).toHaveLength(3);
    for (const item of doc.plan.items) {
      const acs = item.items ?? item.subItems ?? [];
      expect(acs).toHaveLength(2);
      for (const ac of acs) {
        expect(ac.metadata?.kind).toBe('acceptance_criterion');
      }
    }
  });

  it('produces a ProjectConfig with no tracker fields (AC-3)', () => {
    const cfg = fixtureProjectConfig() as Record<string, unknown>;
    expect(cfg.name).toBe(FIXTURE_PROJECT_KEY);
    for (const forbidden of ['tracker', 'github_repo', 'linear_team', 'rally_project', 'gitlab_repo']) {
      expect(cfg[forbidden]).toBeUndefined();
    }
  });
});

describe('fixture builders — no real-tracker leakage (AC-4)', () => {
  it('contains no "eltmon/" or real tracker hostname in any builder output', () => {
    const outputs = [
      fixtureNormalizedIssue(),
      fixtureProjectConfig(),
      fixtureAgentStates(),
      fixtureReviewStatus(),
      fixtureActivityEntries(),
      fixtureXBriefDoc(),
      fixtureContinueJson(),
    ];

    const banned = ['eltmon/', 'linear.app', 'app.linear.app', 'rallydev.com'];
    for (const output of outputs) {
      for (const str of allStrings(output)) {
        for (const term of banned) {
          expect(str.toLowerCase(), `found banned term "${term}" in: ${str}`).not.toContain(term);
        }
      }
    }
  });
});
