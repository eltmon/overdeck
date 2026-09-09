import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { copyOverdeckSettingsToWorkspaceSync } from '../../src/lib/workspace-manager.js';
import { isHarnessNativeTarget } from '../../src/lib/workspace-manager/create.js';

describe('copyOverdeckSettingsToWorkspaceSync', () => {
  let root: string;
  let workspace: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-wm-test-'));
    workspace = join(root, 'workspace');
    mkdirSync(join(workspace, '.claude'), { recursive: true });
    previousHome = process.env.HOME;
    process.env.HOME = root;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('copies only Overdeck-owned settings and preserves native workspace files byte-for-byte', () => {
    mkdirSync(join(root, '.overdeck'), { recursive: true });
    writeFileSync(join(root, '.overdeck', 'settings.json'), '{"theme":"dark"}\n');
    const nativeSettings = join(workspace, '.claude', 'settings.json');
    const nativeMcp = join(workspace, '.claude', 'mcp.json');
    writeFileSync(nativeSettings, '{"native":"settings-sentinel"}\n');
    writeFileSync(nativeMcp, '{"native":"mcp-sentinel"}\n');

    const result = copyOverdeckSettingsToWorkspaceSync(workspace);

    expect(result.errors).toEqual([]);
    expect(result.copied).toEqual([join(workspace, '.overdeck', 'settings.json')]);
    expect(readFileSync(nativeSettings, 'utf-8')).toBe('{"native":"settings-sentinel"}\n');
    expect(readFileSync(nativeMcp, 'utf-8')).toBe('{"native":"mcp-sentinel"}\n');
  });

  it('does not create a native harness directory when none exists', () => {
    rmSync(join(workspace, '.claude'), { recursive: true, force: true });
    copyOverdeckSettingsToWorkspaceSync(workspace);
    expect(existsSync(join(workspace, '.claude'))).toBe(false);
  });
});

describe('workspace native harness target guard', () => {
  it.each([
    'CLAUDE.md',
    'agents.MD',
    '.cursorrules',
    '.windsurfrules',
    '.github/copilot-instructions.md',
    'nested/../CLAUDE.md',
    '.github/instructions/../copilot-instructions.md',
    '../CLAUDE.md',
    '/tmp/AGENTS.md',
  ])('blocks protected or escaping target %s', (target) => {
    expect(isHarnessNativeTarget(target)).toBe(true);
  });

  it('allows an Overdeck-owned project context target', () => {
    expect(isHarnessNativeTarget('.overdeck/context/project.md')).toBe(false);
  });
});
