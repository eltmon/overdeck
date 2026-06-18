import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { briefingCommandAction, createBriefingCommand } from '../../../src/cli/commands/briefing.js';
import { ensureParentDir, resolveStatusFile } from '../../../src/lib/memory/paths.js';

let tempDir: string | null = null;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.OVERDECK_HOME;
  tempDir = await mkdtemp(join(tmpdir(), 'pan-briefing-cli-'));
  process.env.OVERDECK_HOME = join(tempDir, 'home');
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('pan briefing command', () => {
  it('registers a terminal command that prints the shared briefing markdown sections', async () => {
    expect(createBriefingCommand().name()).toBe('briefing');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await briefingCommandAction({ cwd: tempDir! });

    const output = logSpy.mock.calls[0][0] as string;
    logSpy.mockRestore();
    expect(output).toContain('# Working Inside Overdeck');
    expect(output).toContain('## What Overdeck Gives You');
    expect(output).toContain('## How to Read What Follows');
    expect(output).toContain('## Current Workspace');
    expect(output).toContain('## Knowledge Registry');
    expect(output).toContain('## Memory-First Triggers');
    expect(output).toContain('## Tools');
    expect(output).toContain('pan briefing');
  });

  it('includes current workspace context when run inside a workspace', async () => {
    const workspace = join(tempDir!, 'workspaces', 'feature-pan-1204');
    const nestedCwd = join(workspace, 'src');
    await mkdir(join(workspace, '.pan'), { recursive: true });
    await mkdir(nestedCwd, { recursive: true });
    await writeFile(join(workspace, '.git'), 'gitdir: ../../.git/worktrees/feature-pan-1204\n', 'utf8');
    await writeFile(join(workspace, '.pan', 'spec.vbrief.json'), JSON.stringify({
      plan: { title: 'Home tab + live session-context briefing' },
    }), 'utf8');
    const statusPath = resolveStatusFile('panopticon-cli', 'PAN-1204');
    await ensureParentDir(statusPath);
    await writeFile(statusPath, JSON.stringify({
      phase: 'building',
      headline: 'Briefing CLI is being added.',
      summary: 'The workspace has active PAN-1204 context.',
      nextSteps: ['Run command tests'],
    }), 'utf8');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await briefingCommandAction({ cwd: nestedCwd });

    const output = logSpy.mock.calls[0][0] as string;
    logSpy.mockRestore();
    expect(output).toContain('Workspace: feature-pan-1204');
    expect(output).toContain('Issue: PAN-1204');
    expect(output).toContain('Plan: Home tab + live session-context briefing');
    expect(output).toContain('Phase: building');
    expect(output).toContain('Headline: Briefing CLI is being added.');
    expect(output).toContain('Next steps: Run command tests');
  });
});
