/**
 * PAN-4820 WI-1: the issue file's `pipeline: deft` key.
 *
 * Real files under a temp OVERDECK_HOME and a real temp git repo as the plan
 * home. `commitPlanArtifacts` stays real; `pushPlanArtifacts` is mocked (no
 * remote). The skill catalog is mocked so validation does not depend on the
 * machine's installed skills.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { overdeckHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'deft-pipeline-home-'));
  process.env.OVERDECK_HOME = home;
  return { overdeckHome: home };
});

vi.mock('../../skill-overrides/catalog.js', () => ({
  listSkillCatalog: vi.fn(async () => [{ name: 'grilling', description: '', origin: 'overdeck' }]),
  listPackCatalog: vi.fn(async () => []),
  readInstalledClaudePluginNames: vi.fn(async () => new Set<string>()),
}));

vi.mock('../../overdeck/plan-artifact-commit.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../overdeck/plan-artifact-commit.js')>()),
  pushPlanArtifacts: vi.fn(async () => ({ pushed: false, skipped: true, reason: 'main has no upstream' })),
}));

import { invalidateProjectsConfigCache } from '../../projects.js';
import { issueSkillOverridesPath, setIssuePipeline, setSkillOverride } from '../../skill-overrides/store.js';
import { isDeftPipelineIssue, readIssuePipeline } from '../issue-pipeline.js';

const projectsPath = join(overdeckHome, 'projects.yaml');
let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

const issuePath = () => issueSkillOverridesPath(repo, 'TST-1');

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'deft-pipeline-repo-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@overdeck.local');
  git('config', 'user.name', 'Overdeck Test');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'README.md'), 'seed\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: seed');
  writeFileSync(projectsPath, `projects:\n  tst:\n    name: Test\n    path: ${repo}\n    issue_prefix: TST\n`);
  invalidateProjectsConfigCache();
});

afterAll(() => {
  rmSync(overdeckHome, { recursive: true, force: true });
});

describe('readIssuePipeline', () => {
  it('reads overdeck when the issue file is missing', async () => {
    expect(existsSync(issuePath())).toBe(false);
    expect(await readIssuePipeline('TST-1')).toBe('overdeck');
    expect(await isDeftPipelineIssue('TST-1')).toBe(false);
  });

  it('reads deft when the issue file contains pipeline: deft', async () => {
    mkdirSync(join(repo, '.pan', 'skill-overrides'), { recursive: true });
    writeFileSync(issuePath(), 'issue: TST-1\npipeline: deft\n');
    expect(await readIssuePipeline('tst-1')).toBe('deft');
    expect(await isDeftPipelineIssue('TST-1')).toBe(true);
  });

  it('reads overdeck for any other pipeline value', async () => {
    mkdirSync(join(repo, '.pan', 'skill-overrides'), { recursive: true });
    writeFileSync(issuePath(), 'issue: TST-1\npipeline: other\n');
    expect(await readIssuePipeline('TST-1')).toBe('overdeck');
  });

  it('reads overdeck for an issue no project owns', async () => {
    expect(await readIssuePipeline('ZZZ-1')).toBe('overdeck');
  });
});

describe('setIssuePipeline', () => {
  it('writes pipeline: deft and commits it with the pipeline subject', async () => {
    const result = await setIssuePipeline('tst-1', 'deft');

    expect(result).toMatchObject({ committed: true, pushed: false });
    expect(readFileSync(issuePath(), 'utf8')).toContain('pipeline: deft');
    expect(git('log', '-1', '--format=%s')).toBe('chore(workspace): pipeline for TST-1\n');
    expect(await readIssuePipeline('TST-1')).toBe('deft');
  });

  it('is a no-op when the pipeline already matches', async () => {
    await setIssuePipeline('TST-1', 'deft');
    expect(await setIssuePipeline('TST-1', 'deft')).toEqual({});
    expect(await setIssuePipeline('TST-2', 'overdeck')).toEqual({});
  });

  it('keeps pipeline: deft when a pack toggle rewrites the issue file', async () => {
    writeFileSync(
      join(overdeckHome, 'config.yaml'),
      `skills:\n  packs:\n    mattpocock:\n      url: https://github.com/mattpocock/skills\n      ref: v1.2.3\n      commit: ${'c'.repeat(40)}\n`,
    );
    await setIssuePipeline('TST-1', 'deft');

    await setSkillOverride({ level: 'issue', issueId: 'TST-1', pack: 'mattpocock', enabled: true });

    const text = readFileSync(issuePath(), 'utf8');
    expect(text).toContain('pipeline: deft');
    expect(text).toContain('mattpocock: true');
    expect(await readIssuePipeline('TST-1')).toBe('deft');
  });

  it('removes the key and deletes the file when no skills or packs remain', async () => {
    await setIssuePipeline('TST-1', 'deft');

    const result = await setIssuePipeline('TST-1', 'overdeck');

    expect(result).toMatchObject({ committed: true });
    expect(existsSync(issuePath())).toBe(false);
    expect(git('show', '--name-status', '--format=', 'HEAD')).toContain('D\t.pan/skill-overrides/TST-1.yaml');
    expect(await readIssuePipeline('TST-1')).toBe('overdeck');
  });

  it('removes only the key when skill overrides remain', async () => {
    await setSkillOverride({ level: 'issue', issueId: 'TST-1', skill: 'grilling', enabled: false });
    await setIssuePipeline('TST-1', 'deft');

    await setIssuePipeline('TST-1', 'overdeck');

    const text = readFileSync(issuePath(), 'utf8');
    expect(text).not.toContain('pipeline');
    expect(text).toContain('grilling: false');
  });

  it('rejects an issue no project owns', async () => {
    await expect(setIssuePipeline('ZZZ-1', 'deft')).rejects.toMatchObject({ code: 'unknown-issue' });
  });
});
