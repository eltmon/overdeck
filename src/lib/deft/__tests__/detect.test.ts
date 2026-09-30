/**
 * PAN-3943 WI-4: Directive project detection reads fixture trees and never
 * writes to them.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFT_FLAG_MARKER, detectDirectiveProject, findRepoRoot } from '../detect.js';

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'deft-detect-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
}

/** sha256 of every file path and content under `dir`, so any write shows up as a change. */
function treeHash(dir: string): string {
  const hash = createHash('sha256');
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const path = join(rel, name);
      if (statSync(join(dir, path)).isDirectory()) walk(path);
      else hash.update(path).update('\0').update(readFileSync(join(dir, path))).update('\0');
    }
  };
  walk('');
  return hash.digest('hex');
}

const directiveFiles = (pin = '^0.119.10'): Record<string, string> => ({
  'AGENTS.md': '# Agents\n\n<!-- deft:managed-section v3 -->\nDeft rules.\n<!-- /deft:managed-section -->\n',
  'package.json': JSON.stringify({ name: 'app', devDependencies: { '@deftai/directive': pin } }),
  '.claude/settings.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ command: 'npx deft-hook session-start' }] }] } }),
  '.claude/skills/deft-directive-glossary/SKILL.md': '---\nname: deft-directive-glossary\n---\n',
  '.agents/skills/deft-directive-glossary/SKILL.md': '---\nname: deft-directive-glossary\n---\n',
  '.codex/skills/deft-directive-build/SKILL.md': '---\nname: deft-directive-build\n---\n',
  '.claude/skills/user-skill/SKILL.md': '---\nname: user-skill\n---\n',
  '.githooks/pre-commit': '#!/bin/sh\n',
  'xbrief/PROJECT-DEFINITION.xbrief.json': '{}',
  '.deft-directive-disable': `${DEFT_FLAG_MARKER}\n# Remove with: pan skills set --pack deft inherit --issue TST-1\n`,
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('detectDirectiveProject', () => {
  it('reports nothing for an empty project', async () => {
    const root = fixture({});
    expect(await detectDirectiveProject(root)).toEqual({
      root,
      isDirectiveProject: false,
      coreVersion: null,
      pinnedEngine: null,
      managedSection: null,
      agentHookFiles: [],
      gitHooksPath: null,
      hasGithooksDir: false,
      pointerSkills: [],
      xbriefProjectDefinition: false,
      killSwitch: { present: false, overdeckOwned: false },
      permanentOptOut: false,
      killSwitchSupported: null,
    });
  });

  it('reads every deposit signal and leaves the tree byte-identical', async () => {
    const root = fixture(directiveFiles());
    const before = treeHash(root);
    const detection = await detectDirectiveProject(root);
    expect(treeHash(root)).toBe(before);
    expect(detection).toMatchObject({
      isDirectiveProject: true,
      coreVersion: null,
      pinnedEngine: '^0.119.10',
      managedSection: 'v3',
      agentHookFiles: ['.claude/settings.json'],
      hasGithooksDir: true,
      pointerSkills: ['deft-directive-build', 'deft-directive-glossary'],
      xbriefProjectDefinition: true,
      killSwitch: { present: true, overdeckOwned: true },
      permanentOptOut: false,
      killSwitchSupported: true,
    });
  });

  it('reports an engine older than 0.92.0 as not supporting the kill switch', async () => {
    const detection = await detectDirectiveProject(fixture(directiveFiles('0.91.3')));
    expect(detection.killSwitchSupported).toBe(false);
  });

  it('prefers .deft/core/VERSION and reports an unparseable version as unknown', async () => {
    const supported = await detectDirectiveProject(fixture({ '.deft/core/VERSION': 'v0.92.0\n' }));
    expect(supported).toMatchObject({ isDirectiveProject: true, coreVersion: 'v0.92.0', killSwitchSupported: true });
    const prerelease = await detectDirectiveProject(fixture({ '.deft/core/VERSION': '0.20.0-rc.3\n' }));
    expect(prerelease.killSwitchSupported).toBeNull();
  });

  it('marks a user-written flag and the permanent opt-out', async () => {
    const detection = await detectDirectiveProject(
      fixture({ '.deft/core/VERSION': '0.119.10', '.deft-directive-disable': '', '.no-deft-directive': '' }),
    );
    expect(detection.killSwitch).toEqual({ present: true, overdeckOwned: false });
    expect(detection.permanentOptOut).toBe(true);
  });

  it('reads core.hooksPath only for a Directive project', async () => {
    const directive = fixture(directiveFiles());
    git(directive, 'init', '-q');
    git(directive, 'config', 'core.hooksPath', '.githooks');
    expect((await detectDirectiveProject(directive)).gitHooksPath).toBe('.githooks');

    const plain = fixture({ 'README.md': '# app\n' });
    git(plain, 'init', '-q');
    git(plain, 'config', 'core.hooksPath', '.githooks');
    expect((await detectDirectiveProject(plain)).gitHooksPath).toBeNull();
  });
});

describe('findRepoRoot', () => {
  it('walks up to the directory holding .git, file or dir', async () => {
    const root = fixture({ '.git': 'gitdir: /elsewhere\n', 'a/b/c.txt': '' });
    expect(await findRepoRoot(join(root, 'a', 'b'))).toBe(root);
  });

  it('returns cwd when no .git is found', async () => {
    const root = fixture({ 'a/b/c.txt': '' });
    const cwd = join(root, 'a', 'b');
    expect(await findRepoRoot(cwd)).toBe(cwd);
  });
});
