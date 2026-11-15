import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardUnreachableError } from '../../../src/cli/commands/dashboard-call.js';
import { runOpen, type OpenDeps } from '../../../src/cli/commands/open.js';

class ExitError extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

let dir: string;
let logs: string[];
let errors: string[];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function makeDeps(response: Response | Error): OpenDeps & { callDashboard: ReturnType<typeof vi.fn>; openBrowser: ReturnType<typeof vi.fn>; openInEditor: ReturnType<typeof vi.fn> } {
  return {
    callDashboard: vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    }),
    openBrowser: vi.fn(async () => {}),
    openInEditor: vi.fn(async () => {}),
    dashboardUrl: async () => 'http://localhost:3011',
    cwd: () => dir,
    home: () => join(dir, 'home'),
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
    exit: async (code) => {
      throw new ExitError(code);
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'open-command-'));
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'README.md'), '# x\n');
  logs = [];
  errors = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('pan open', () => {
  it('opens in the listening tab and opens no browser', async () => {
    const deps = makeDeps(json({ projectKey: 'panopticon-cli', deckKey: 'overdeck', rootId: 'project:panopticon-cli', relPath: 'docs', kind: 'dir', delivered: 1 }));
    await runOpen('docs', {}, deps);
    expect(deps.callDashboard).toHaveBeenCalledWith('/api/ui/open', {
      method: 'POST',
      body: { path: join(dir, 'docs'), line: undefined, column: undefined, dryRun: false },
    });
    expect(deps.openBrowser).not.toHaveBeenCalled();
    expect(logs).toEqual(['Opened docs in overdeck']);
  });

  it('names an issue workspace by its issue id', async () => {
    const deps = makeDeps(
      json({ projectKey: 'panopticon-cli', deckKey: 'overdeck', rootId: 'issue:PAN-5295', relPath: '', kind: 'dir', delivered: 1 }),
    );
    await runOpen('docs', {}, deps);
    expect(logs).toEqual(['Opened the PAN-5295 workspace in overdeck']);
  });

  it('falls back to projectKey when an older dashboard sends no deckKey', async () => {
    const deps = makeDeps(json({ projectKey: 'demo', rootId: 'project:demo', relPath: 'docs', delivered: 1 }));
    await runOpen('docs', {}, deps);
    expect(logs).toEqual(['Opened docs in demo']);
  });

  it('opens the /open link in the browser when no tab is listening', async () => {
    const deps = makeDeps(json({ projectKey: 'demo', rootId: 'project:demo', relPath: 'README.md', kind: 'file', line: 10, delivered: 0 }));
    await runOpen('README.md:10', {}, deps);
    const url = `http://localhost:3011/open?path=${encodeURIComponent(join(dir, 'README.md'))}&line=10`;
    expect(deps.openBrowser).toHaveBeenCalledWith(url);
    expect(logs).toEqual([`Opening ${url} in your browser`]);
  });

  it('with --new-tab sends dryRun and opens the browser', async () => {
    const deps = makeDeps(json({ projectKey: 'demo', rootId: 'project:demo', relPath: 'docs', kind: 'dir', delivered: 0 }));
    await runOpen('docs', { newTab: true }, deps);
    expect(deps.callDashboard.mock.calls[0]?.[1]).toMatchObject({ body: { dryRun: true } });
    expect(deps.openBrowser).toHaveBeenCalledTimes(1);
  });

  it('lets --line and --column override a suffix', async () => {
    const deps = makeDeps(json({ projectKey: 'demo', relPath: 'README.md', delivered: 1 }));
    await runOpen('README.md:3', { line: '7', column: '2' }, deps);
    expect(deps.callDashboard.mock.calls[0]?.[1]).toMatchObject({ body: { line: 7, column: 2 } });
  });

  it('exits 1 when the dashboard is not running', async () => {
    const deps = makeDeps(new DashboardUnreachableError('ECONNREFUSED'));
    await expect(runOpen('docs', {}, deps)).rejects.toMatchObject({ code: 1 });
    expect(errors).toEqual(["Overdeck isn't running. Start it with: pan up"]);
  });

  it('prints the add-project suggestion for a path outside every project', async () => {
    const deps = makeDeps(json({ error: 'outside-projects', path: join(dir, 'docs'), kind: 'dir', suggestion: `pan project add ${join(dir, 'docs')}` }, 404));
    await expect(runOpen('docs', {}, deps)).rejects.toMatchObject({ code: 1 });
    expect(errors).toEqual([`${join(dir, 'docs')} isn't in a registered project. Add it with: pan project add ${join(dir, 'docs')}`]);
  });

  it('prints the no-root sentence', async () => {
    const deps = makeDeps(json({ error: 'no-root', path: join(dir, 'docs'), projectKey: 'demo' }, 404));
    await expect(runOpen('docs', {}, deps)).rejects.toMatchObject({ code: 1 });
    expect(errors).toEqual([`${join(dir, 'docs')} is inside demo but not in a feature or scratch workspace`]);
  });

  it('with --editor opens the editor and never calls the dashboard', async () => {
    const deps = makeDeps(json({}));
    await runOpen('docs', { editor: true }, deps);
    await runOpen('README.md', { editor: 'zed' }, deps);
    expect(deps.openInEditor).toHaveBeenNthCalledWith(1, join(dir, 'docs'), true);
    expect(deps.openInEditor).toHaveBeenNthCalledWith(2, join(dir, 'README.md'), 'zed');
    expect(deps.callDashboard).not.toHaveBeenCalled();
  });

  it('rejects a target that is not a file, folder or issue', async () => {
    const deps = makeDeps(json({}));
    await expect(runOpen('no-such-thing-xyz', {}, deps)).rejects.toMatchObject({ code: 1 });
    expect(errors).toEqual(['Not a file, folder or issue: no-such-thing-xyz']);
    expect(deps.callDashboard).not.toHaveBeenCalled();
  });
});
