import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, lstatSync, existsSync, rmSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dedupeWorkspaceVenvs } from '../tldr-venv-dedupe.js';

function fakeDaemon() {
  return { stop: vi.fn(async () => {}), start: vi.fn(async () => {}) };
}

describe('dedupeWorkspaceVenvs', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tldr-dedupe-'));
    mkdirSync(join(root, '.venv', 'bin'), { recursive: true });
    writeFileSync(join(root, '.venv', 'bin', 'tldr'), '');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeRealVenv(workspacePath: string, withTldr = true): void {
    mkdirSync(join(workspacePath, '.venv', 'bin'), { recursive: true });
    if (withTldr) {
      writeFileSync(join(workspacePath, '.venv', 'bin', 'tldr'), '');
    }
  }

  it('converts a real workspace venv into a symlink and removes the old directory (AC1)', async () => {
    const ws = join(root, 'workspaces', 'feature-a');
    mkdirSync(ws, { recursive: true });
    makeRealVenv(ws);
    const du = vi.fn(async () => 42);
    const getDaemon = vi.fn(async () => fakeDaemon());

    const entries = await dedupeWorkspaceVenvs(root, { dryRun: false }, { du, getDaemon });

    const converted = entries.find((e) => e.workspacePath === ws);
    expect(converted?.action).toBe('converted');
    expect(lstatSync(join(ws, '.venv')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(ws, '.venv'))).toBe(join(root, '.venv'));
    expect(existsSync(join(ws, '.venv.pan-1674-old'))).toBe(false);
  });

  it('leaves the workspace venv a real directory in dry-run mode (AC2)', async () => {
    const ws = join(root, 'workspaces', 'feature-b');
    mkdirSync(ws, { recursive: true });
    makeRealVenv(ws);
    const du = vi.fn(async () => 99);
    const getDaemon = vi.fn(async () => fakeDaemon());

    const entries = await dedupeWorkspaceVenvs(root, { dryRun: true }, { du, getDaemon });

    const entry = entries.find((e) => e.workspacePath === ws);
    expect(entry?.action).toBe('would-convert');
    expect(entry?.bytes).toBe(99);
    expect(lstatSync(join(ws, '.venv')).isSymbolicLink()).toBe(false);
    expect(getDaemon).not.toHaveBeenCalled();
  });

  it('does not modify a workspace whose .venv is already a symlink, or one with a Python-project marker (AC3)', async () => {
    const linked = join(root, 'workspaces', 'feature-linked');
    mkdirSync(linked, { recursive: true });
    symlinkSync(join(root, '.venv'), join(linked, '.venv'), 'dir');

    const pyProject = join(root, 'workspaces', 'feature-py');
    mkdirSync(pyProject, { recursive: true });
    makeRealVenv(pyProject);
    writeFileSync(join(pyProject, 'pyproject.toml'), '');

    const du = vi.fn(async () => 1);
    const getDaemon = vi.fn(async () => fakeDaemon());

    const entries = await dedupeWorkspaceVenvs(root, { dryRun: false }, { du, getDaemon });

    expect(entries.find((e) => e.workspacePath === linked)).toBeUndefined();
    expect(lstatSync(join(linked, '.venv')).isSymbolicLink()).toBe(true);

    const pyEntry = entries.find((e) => e.workspacePath === pyProject);
    expect(pyEntry?.action).toBe('skipped');
    expect(pyEntry?.reason).toContain('Python project');
    expect(lstatSync(join(pyProject, '.venv')).isSymbolicLink()).toBe(false);
  });

  it('skips a real directory without bin/tldr, with a reason', async () => {
    const ws = join(root, 'workspaces', 'feature-broken');
    mkdirSync(ws, { recursive: true });
    makeRealVenv(ws, false);
    const du = vi.fn(async () => 1);

    const entries = await dedupeWorkspaceVenvs(root, { dryRun: false }, { du });

    const entry = entries.find((e) => e.workspacePath === ws);
    expect(entry?.action).toBe('skipped');
    expect(entry?.reason).toBeTruthy();
    expect(du).not.toHaveBeenCalled();
  });

  it('preserves the project-root venv after converting every workspace (AC4)', async () => {
    const ws = join(root, 'workspaces', 'feature-c');
    mkdirSync(ws, { recursive: true });
    makeRealVenv(ws);
    const du = vi.fn(async () => 10);
    const getDaemon = vi.fn(async () => fakeDaemon());

    await dedupeWorkspaceVenvs(root, { dryRun: false }, { du, getDaemon });

    expect(existsSync(join(root, '.venv', 'bin', 'tldr'))).toBe(true);
  });

  it('throws when the project-root venv is missing', async () => {
    const bareRoot = mkdtempSync(join(tmpdir(), 'tldr-dedupe-bare-'));
    try {
      await expect(dedupeWorkspaceVenvs(bareRoot, { dryRun: false })).rejects.toThrow();
    } finally {
      rmSync(bareRoot, { recursive: true, force: true });
    }
  });
});
