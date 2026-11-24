/**
 * PAN-5250 WI-9: `pan workspace up`, `pin` and `unpin`. Every dep is injected.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stackPinPath } from '../../../lib/workspace/stack-idle-config.js';
import type { ComposeContainer } from '../../../lib/workspace/stack-reclaim-docker.js';
import type { StackWakeResult } from '../../../lib/workspace/stack-restore.js';
import {
  workspacePinCommand,
  workspaceUnpinCommand,
  workspaceUpCommand,
  type WorkspaceStackCliDeps,
} from '../workspace-stack.js';

const ISSUE = 'MIN-1144';
const FE = 'myn-feature-min-1144-fe-1';
const PROJECT = 'myn-feature-min-1144';

let workspace: string;

function setup(overrides: Partial<WorkspaceStackCliDeps> = {}) {
  const lines: string[] = [];
  const spinner = { succeed: vi.fn(), fail: vi.fn(), stop: vi.fn() };
  const exit = vi.fn(async (_code: number): Promise<never> => undefined as never);
  const deps: Partial<WorkspaceStackCliDeps> = {
    workspacePathFor: () => workspace,
    log: (line) => lines.push(line),
    spinner: () => spinner,
    exit,
    composeProjectFor: () => PROJECT,
    wakeableServices: () => new Set(['fe', 'frontend', 'dev', 'api', 'server']),
    listContainers: async () => [],
    ...overrides,
  };
  return { deps, lines, spinner, exit, out: () => lines.join('\n') };
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'workspace-stack-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('pan workspace up', () => {
  it('prints the containers it started, including idle-stopped ones the restore door started', async () => {
    const wake = vi.fn(async (): Promise<StackWakeResult> => ({
      kind: 'woken',
      restored: { kind: 'restored', started: [FE], alreadyRunning: [], missing: [], refused: [] },
      started: [],
      alreadyRunning: [FE, 'myn-feature-min-1144-api-1'],
    }));
    const t = setup({ wake });
    await workspaceUpCommand('min-1144', t.deps);
    expect(wake).toHaveBeenCalledWith({ issueId: ISSUE, workspacePath: workspace, trigger: 'operator' });
    expect(t.out()).toContain(`Started: ${FE}`);
    expect(t.out()).toContain('Already running: myn-feature-min-1144-api-1');
    expect(t.exit).not.toHaveBeenCalled();
  });

  it('says there is nothing to start and exits 0', async () => {
    const t = setup({ wake: async () => ({ kind: 'woken', restored: { kind: 'none' }, started: [], alreadyRunning: [] }) });
    await workspaceUpCommand(ISSUE, t.deps);
    expect(t.out()).toContain(`Nothing to start for ${ISSUE}`);
    expect(t.exit).not.toHaveBeenCalled();
  });

  it('exits 1 when the wake fails or there is no stack', async () => {
    const failed = setup({ wake: async () => ({ kind: 'failed', error: `${FE}: boom`, failed: [FE] }) });
    await workspaceUpCommand(ISSUE, failed.deps);
    expect(failed.spinner.fail).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(failed.exit).toHaveBeenCalledWith(1);

    const none = setup({ wake: async () => ({ kind: 'no-stack', reason: 'no-compose-project' }) });
    await workspaceUpCommand(ISSUE, none.deps);
    expect(none.spinner.fail).toHaveBeenCalledWith(`No Docker stack for ${ISSUE} (no-compose-project)`);
    expect(none.exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 without waking for a missing workspace', async () => {
    const wake = vi.fn();
    const t = setup({ wake, workspacePathFor: () => join(workspace, 'gone') });
    await workspaceUpCommand(ISSUE, t.deps);
    expect(t.out()).toContain(`No workspace for ${ISSUE} at ${join(workspace, 'gone')}`);
    expect(t.exit).toHaveBeenCalledWith(1);
    expect(wake).not.toHaveBeenCalled();
  });
});

describe('pan workspace pin and unpin', () => {
  it('pin writes the pin file and names the undo command', async () => {
    const t = setup();
    await workspacePinCommand(ISSUE, t.deps);
    expect(existsSync(stackPinPath(workspace))).toBe(true);
    expect(t.out()).toContain(`pan workspace unpin ${ISSUE}`);
    expect(t.out()).not.toContain('pan workspace up');
  });

  it('pin hints at pan workspace up when a wakeable container is stopped', async () => {
    const stopped: ComposeContainer = { id: 'x', name: FE, state: 'exited', composeProject: PROJECT, composeService: 'fe' };
    const t = setup({ listContainers: async () => [stopped] });
    await workspacePinCommand(ISSUE, t.deps);
    expect(t.out()).toContain(`Run pan workspace up ${ISSUE} to start a stopped stack.`);
  });

  it('unpin removes the pin, then reports it was not pinned', async () => {
    const t = setup();
    await workspacePinCommand(ISSUE, t.deps);
    await workspaceUnpinCommand(ISSUE, t.deps);
    expect(existsSync(stackPinPath(workspace))).toBe(false);
    await workspaceUnpinCommand(ISSUE, t.deps);
    expect(t.lines.slice(-2)).toEqual([`Unpinned ${ISSUE}.`, `${ISSUE} was not pinned.`]);
  });
});
