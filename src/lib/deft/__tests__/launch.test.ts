/**
 * PAN-3943 WI-6/WI-7: the managed-mode decision store and Deft launch
 * resolution, against real files under a temp OVERDECK_HOME.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';

const { overdeckHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'deft-launch-home-'));
  process.env.OVERDECK_HOME = home;
  return { overdeckHome: home };
});

import { invalidateProjectsConfigCache } from '../../projects.js';
import { writePackEntry } from '../../skill-packs/sources.js';
import { applyDeftLaunch, DEFT_CLI_DENY, DEFT_FLAG_MARKER, resolveDeftLaunch } from '../launch.js';
import { disableDeftManaged, enableDeftManaged, readDeftIntegration } from '../project-mode.js';

const projectsPath = join(overdeckHome, 'projects.yaml');
const DIGEST = 'a'.repeat(64);

function writeProjects(text: string): void {
  writeFileSync(projectsPath, text);
  invalidateProjectsConfigCache();
}

function readProjects(): { projects: Record<string, Record<string, unknown>> } {
  return parseYaml(readFileSync(projectsPath, 'utf8'));
}

const scratch = mkdtempSync(join(tmpdir(), 'deft-launch-src-'));

afterAll(() => {
  rmSync(overdeckHome, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('project-mode', () => {
  beforeEach(() => {
    writeProjects(
      'projects:\n' +
        '  tst:\n    name: Test\n    path: /repo/tst\n    issue_prefix: TST\n    skill_pack_overrides:\n      deft: true\n' +
        '  other:\n    name: Other\n    path: /repo/other\n',
    );
  });

  it('reads null when no decision is stored', async () => {
    expect(await readDeftIntegration('tst')).toBeNull();
    expect(await readDeftIntegration('missing')).toBeNull();
  });

  it('round-trips enable and disable without losing unrelated keys', async () => {
    const before = readProjects();
    await enableDeftManaged('tst', DIGEST, new Date('2026-09-29T12:00:00.000Z'));
    invalidateProjectsConfigCache();
    expect(await readDeftIntegration('tst')).toEqual({
      mode: 'managed',
      plan_digest: DIGEST,
      enabled_at: '2026-09-29T12:00:00.000Z',
    });
    const enabled = readProjects();
    expect(enabled.projects['other']).toEqual(before.projects['other']);
    expect(enabled.projects['tst']).toMatchObject({ ...before.projects['tst'] });

    expect(await disableDeftManaged('tst')).toBe(true);
    invalidateProjectsConfigCache();
    expect(readProjects()).toEqual(before);
    expect(await readDeftIntegration('tst')).toBeNull();
    expect(await disableDeftManaged('tst')).toBe(false);
  });

  it('rejects an unknown project and a malformed digest without writing', async () => {
    const before = readFileSync(projectsPath, 'utf8');
    await expect(enableDeftManaged('missing', DIGEST)).rejects.toThrow('unknown project: missing');
    await expect(enableDeftManaged('tst', 'abc')).rejects.toThrow('invalid plan digest');
    expect(readFileSync(projectsPath, 'utf8')).toBe(before);
  });

  it('ignores a malformed stored decision', async () => {
    writeProjects('projects:\n  tst:\n    name: Test\n    path: /repo/tst\n    deft_integration:\n      mode: full\n');
    expect(await readDeftIntegration('tst')).toBeNull();
  });
});

describe('resolveDeftLaunch and applyDeftLaunch', () => {
  const PACK_COMMIT = 'e'.repeat(40);
  const FLAG = '.deft-directive-disable';
  const DIRECTIVE_FILES: Record<string, string> = {
    'AGENTS.md': '# Agents\n\n<!-- deft:managed-section v3 -->\nDeft rules.\n',
    'package.json': JSON.stringify({ name: 'app', devDependencies: { '@deftai/directive': '^0.119.10' } }),
    '.claude/settings.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ command: 'deft-hook start' }] }] } }),
    '.claude/skills/deft-directive-glossary/SKILL.md': '---\nname: deft-directive-glossary\n---\n',
  };
  let base: string;
  let projectDir: string;
  let envFile: string;

  function git(root: string, ...args: string[]): string {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  }

  /** A committed git repo at `<base>/<name>` holding `files`. */
  function repo(name: string, files: Record<string, string>): string {
    const root = join(base, name);
    mkdirSync(root, { recursive: true });
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.email', 'test@overdeck.local');
    git(root, 'config', 'user.name', 'Overdeck Test');
    git(root, 'config', 'commit.gpgsign', 'false');
    for (const [path, content] of Object.entries({ 'README.md': 'seed\n', ...files })) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'chore: seed');
    return root;
  }

  function setToggles(opts: { project?: boolean; issue?: boolean } = {}): void {
    const projectPacks = opts.project === undefined ? '' : `    skill_pack_overrides:\n      deft: ${opts.project}\n`;
    writeProjects(`projects:\n  tst:\n    name: Test\n    path: ${projectDir}\n    issue_prefix: TST\n${projectPacks}`);
    const issueFile = join(projectDir, '.pan', 'skill-overrides', 'TST-1.yaml');
    rmSync(issueFile, { force: true });
    if (opts.issue !== undefined) {
      mkdirSync(dirname(issueFile), { recursive: true });
      writeFileSync(issueFile, `packs:\n  deft: ${opts.issue}\n`);
    }
  }

  async function launch(cwd: string, deftSkillsMounted = true) {
    const plan = await resolveDeftLaunch({ cwd, projectKey: 'tst', deftSkillsMounted });
    const warnings = await applyDeftLaunch(plan, cwd, envFile);
    return { plan, warnings };
  }

  const porcelain = (root: string): string => git(root, 'status', '--porcelain');
  const envText = (): string | null => (existsSync(envFile) ? readFileSync(envFile, 'utf8') : null);

  beforeEach(async () => {
    base = mkdtempSync(join(scratch, 'case-'));
    projectDir = join(base, 'project');
    mkdirSync(projectDir, { recursive: true });
    envFile = join(base, 'launch', 'agent-1', 'deft.env');
    setToggles();
    await writePackEntry({
      id: 'deft',
      url: 'https://github.com/eltmon/directive',
      ref: 'master',
      commit: PACK_COMMIT,
      adapter: 'deft-readonly',
    });
  });

  it('denies Deft CLIs outside a Directive project and writes nothing', async () => {
    const root = repo('plain-app', {});
    const { plan } = await launch(root);
    expect(plan).toEqual({
      directive: false,
      killSwitch: false,
      writeFlag: false,
      orchestrator: false,
      denyCli: true,
      hideSkills: [],
      provenance: '[launcher] deft: pack master (eeeeeeeeeeee); project not directive; read-only',
    });
    expect(envText()).toBeNull();
    expect(existsSync(join(root, FLAG))).toBe(false);
    expect(porcelain(root)).toBe('');
    expect((await resolveDeftLaunch({ cwd: root, projectKey: 'tst', deftSkillsMounted: false })).denyCli).toBe(false);
  });

  it('turns on the kill switch for an issue-level off in an issue worktree', async () => {
    setToggles({ issue: false });
    const root = repo('feature-tst-1', DIRECTIVE_FILES);
    const { plan, warnings } = await launch(root);
    expect(warnings).toEqual([]);
    expect(plan).toMatchObject({
      directive: true,
      killSwitch: true,
      writeFlag: true,
      orchestrator: false,
      denyCli: false,
      hideSkills: ['deft-directive-glossary'],
    });
    expect(plan.provenance).toBe('[launcher] deft: pack master (eeeeeeeeeeee); project directive engine ^0.119.10; kill switch');
    expect(envText()).toBe('DEFT_DIRECTIVE_DISABLE=1\n');
    expect(readFileSync(join(root, FLAG), 'utf8')).toBe(
      `${DEFT_FLAG_MARKER}\n# Remove with: pan skills set --pack deft inherit --issue TST-1\n`,
    );
    expect(porcelain(root)).toBe('');

    await launch(root);
    const exclude = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split('\n').filter((line) => line === `/${FLAG}`)).toHaveLength(1);
    expect(porcelain(root)).toBe('');
  });

  it('exports the kill switch but writes no flag outside an issue worktree', async () => {
    setToggles({ project: false });
    const root = repo('directive-app', DIRECTIVE_FILES);
    const { plan } = await launch(root);
    expect(plan).toMatchObject({ killSwitch: true, writeFlag: false });
    expect(envText()).toBe('DEFT_DIRECTIVE_DISABLE=1\n');
    expect(existsSync(join(root, FLAG))).toBe(false);
    expect(porcelain(root)).toBe('');
  });

  it('leaves a Directive project untouched by default', async () => {
    const root = repo('feature-tst-1', DIRECTIVE_FILES);
    const { plan } = await launch(root);
    expect(plan).toMatchObject({ directive: true, killSwitch: false, writeFlag: false, orchestrator: false, hideSkills: [] });
    expect(plan.provenance.endsWith('; untouched')).toBe(true);
    expect(envText()).toBeNull();
    expect(existsSync(join(root, FLAG))).toBe(false);
    expect(porcelain(root)).toBe('');
  });

  it('exports the orchestrator in a managed project that is not off', async () => {
    setToggles({ project: true });
    await enableDeftManaged('tst', 'a'.repeat(64));
    invalidateProjectsConfigCache();
    const root = repo('feature-tst-1', DIRECTIVE_FILES);
    const { plan } = await launch(root);
    expect(plan).toMatchObject({ orchestrator: true, killSwitch: false });
    expect(plan.provenance.endsWith('; managed')).toBe(true);
    expect(envText()).toBe('DEFT_ORCHESTRATOR=overdeck\n');
    expect(porcelain(root)).toBe('');
  });

  it('removes its own flag on re-enable and never a user-written one', async () => {
    setToggles({ issue: false });
    const root = repo('feature-tst-1', DIRECTIVE_FILES);
    await launch(root);
    expect(existsSync(join(root, FLAG))).toBe(true);

    setToggles();
    await launch(root);
    expect(existsSync(join(root, FLAG))).toBe(false);
    expect(envText()).toBeNull();

    writeFileSync(join(root, FLAG), 'user flag\n');
    await launch(root);
    expect(readFileSync(join(root, FLAG), 'utf8')).toBe('user flag\n');
  });

  it('never modifies a tracked flag', async () => {
    setToggles({ issue: false });
    const marked = `${DEFT_FLAG_MARKER}\ncommitted by someone\n`;
    const root = repo('feature-tst-1', { ...DIRECTIVE_FILES, [FLAG]: marked });

    setToggles();
    const { warnings } = await launch(root);
    expect(warnings).toEqual([expect.stringContaining('is tracked')]);
    expect(readFileSync(join(root, FLAG), 'utf8')).toBe(marked);

    rmSync(join(root, FLAG));
    setToggles({ issue: false });
    const second = await launch(root);
    expect(second.warnings).toEqual([expect.stringContaining('is tracked')]);
    expect(existsSync(join(root, FLAG))).toBe(false);
  });

  it('keeps the exact Claude deny list', () => {
    expect(DEFT_CLI_DENY).toEqual([
      'Bash(directive:*)',
      'Bash(deft:*)',
      'Bash(deft-hook:*)',
      'Bash(npx @deftai/directive:*)',
      'Bash(npm install @deftai/directive:*)',
      'Bash(npm i @deftai/directive:*)',
      'Bash(pnpm add @deftai/directive:*)',
      'Bash(git config core.hooksPath:*)',
    ]);
  });
});
