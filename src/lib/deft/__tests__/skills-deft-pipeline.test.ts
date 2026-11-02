/**
 * PAN-4820 WI-14: `pan skills deft use|back|save|show` parse their issue,
 * call the lib function with it upper-cased, print the documented lines,
 * and exit 1 with the message on stderr when the lib refuses.
 */
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useDeftPipeline: vi.fn(),
  backToOverdeck: vi.fn(),
  saveDeftState: vi.fn(),
}));

vi.mock('../switch.js', () => ({ useDeftPipeline: mocks.useDeftPipeline, backToOverdeck: mocks.backToOverdeck }));
vi.mock('../archive.js', () => ({ saveDeftState: mocks.saveDeftState }));
vi.mock('../../overdeck/issue-projects.js', () => ({ getIssueWorkspacePath: (id: string) => `/repo/workspaces/feature-${id.toLowerCase()}` }));

import { registerSkillsDeftCommands } from '../../../cli/commands/skills-deft.js';

let out: string[];
let err: string[];

function program(): Command {
  const root = new Command().exitOverride();
  registerSkillsDeftCommands(root.command('skills'));
  return root;
}

const run = (...args: string[]) => program().parseAsync(['node', 'pan', 'skills', 'deft', ...args]);

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => { out.push(line); });
  vi.spyOn(console, 'error').mockImplementation((line: string) => { err.push(line); });
  process.exitCode = undefined;
  for (const mock of Object.values(mocks)) mock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('pan skills deft use', () => {
  it('calls useDeftPipeline with the upper-cased issue and reports the switch', async () => {
    mocks.useDeftPipeline.mockResolvedValue({ mode: 'temporary-install', snapshotPaths: ['AGENTS.md', 'package.json'], workspace: '/w', placeholderPlan: true });

    await run('use', 'pan-7');

    expect(mocks.useDeftPipeline).toHaveBeenCalledWith('PAN-7');
    expect(out).toEqual(['Deft pipeline on for PAN-7: temporary-install; 2 install paths hidden.']);
    expect(process.exitCode).toBeUndefined();
  });

  it('exits 1 with the message on stderr when the switch is refused', async () => {
    mocks.useDeftPipeline.mockRejectedValue(new Error('PAN-7 is in a polyrepo workspace'));

    await run('use', 'PAN-7');

    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toContain('PAN-7 is in a polyrepo workspace');
    expect(out).toEqual([]);
  });
});

describe('pan skills deft back', () => {
  it('reports the counts and the next step', async () => {
    mocks.backToOverdeck.mockResolvedValue({ removed: ['AGENTS.md'], restored: ['package.json', 'bun.lock'], archiveSha: 'abc', next: 'pan start PAN-7' });

    await run('back', 'pan-7');

    expect(mocks.backToOverdeck).toHaveBeenCalledWith('PAN-7');
    expect(out).toEqual([
      'Overdeck pipeline on for PAN-7: 1 install paths removed, 2 files restored.',
      'Next: pan start PAN-7 (plans first)',
    ]);
  });
});

describe('pan skills deft back without a snapshot', () => {
  it('warns that the exact undo was impossible and names the unhidden files', async () => {
    mocks.backToOverdeck.mockResolvedValue({
      removed: [], restored: [], archiveSha: null, next: 'pan start PAN-7', snapshotMissing: true, unhidden: ['package.json'],
    });

    await run('back', 'PAN-7');

    expect(err.join('\n')).toContain('no readable install snapshot for PAN-7');
    expect(err.join('\n')).toContain('(package.json)');
    expect(out).toContain('Next: pan start PAN-7 (plans first)');
  });
});

describe('pan skills deft save', () => {
  it('saves the archive in the issue workspace', async () => {
    mocks.saveDeftState.mockResolvedValue({ committed: true, sha: '0123456789abcdef', files: 3 });

    await run('save', 'pan-7');

    expect(mocks.saveDeftState).toHaveBeenCalledWith('/repo/workspaces/feature-pan-7', 'PAN-7');
    expect(out).toEqual(['Saved Deft state for PAN-7: 3 files in 0123456789ab.']);
  });
});

describe('pan skills deft --help', () => {
  it('lists use, back, save and show next to status, enable and disable', () => {
    const deft = program().commands.find(c => c.name() === 'skills')?.commands.find(c => c.name() === 'deft');
    const names = deft?.commands.map(c => c.name());

    expect(names).toEqual(['status', 'enable', 'disable', 'use', 'back', 'save', 'show']);
    const help = deft?.helpInformation() ?? '';
    for (const name of ['status', 'enable', 'disable', 'use', 'back', 'save', 'show']) expect(help).toMatch(new RegExp(`^\\s+${name}\\b`, 'm'));
  });
});
