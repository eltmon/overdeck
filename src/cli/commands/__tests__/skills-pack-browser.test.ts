/**
 * PAN-4730 WI-O8/O9: `pan skills pack browser <id> [on|off]`, `add --browser`,
 * the browser rows of the consent preview, and the live browse-daemon report,
 * through Commander. The pack library is mocked; its own tests cover the flows.
 */
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class PackSourceError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    PackSourceError,
    addPack: vi.fn(),
    updatePack: vi.fn(),
    enablePackBrowser: vi.fn(),
    disablePackBrowser: vi.fn(),
    buildRan: vi.fn(),
    listProjectsAsync: vi.fn(),
    question: vi.fn(),
  };
});

vi.mock('../../../lib/skill-packs/sources.js', () => ({
  PackSourceError: mocks.PackSourceError,
  addPack: mocks.addPack,
  updatePack: mocks.updatePack,
  enablePackBrowser: mocks.enablePackBrowser,
  disablePackBrowser: mocks.disablePackBrowser,
}));

vi.mock('../../../lib/projects.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lib/projects.js')>()),
  listProjectsAsync: mocks.listProjectsAsync,
}));

vi.mock('node:readline/promises', () => ({
  createInterface: () => ({ question: mocks.question, close: () => undefined }),
}));

import { registerSkillsCommands } from '../skills.js';

const COMMIT = '1b778f78'.padEnd(40, '0');
const R = `/h/.overdeck/packs/gstack/render/${COMMIT}`;
const C = '/h/.overdeck/packs/gstack/browser';
const DOWNLOADS = [
  '@anthropic-ai/sdk@^0.78.0',
  'diff@^9.0.0',
  'playwright@^1.62.1',
  'sharp@^0.35.4',
  '+ their locked dependencies from bun.lock (registry.npmjs.org)',
  'Chromium and Chromium headless shell for playwright ^1.62.1 (Playwright CDN, ~115 MiB download)',
];
const WRITES = [`${R}/node_modules`, `${R}/browse/dist`, `${R}/design/dist`, `${R}/make-pdf/dist`, `${C}/bun-cache`, `${C}/playwright`];
const capabilities = {
  hooks: true, mcpServers: false, commands: false, agents: false, contextInjection: false, gitHooks: false,
  executables: ['bin/gstack-config'], projectMutatingSkills: ['codex', 'ship'], requiresCli: ['bun'], runtime: true,
};
const preview = {
  id: 'gstack', url: 'https://github.com/eltmon/gstack', ref: 'main', commit: COMMIT, adapter: 'gstack-runtime',
  manifest: {
    skills: [
      { name: 'qa', dir: 'qa', description: '', optIn: false },
      { name: 'ship', dir: 'ship', description: '', optIn: true },
    ],
    capabilities, license: 'MIT', pluginName: null, excluded: [],
  },
  browser: { command: ['bash', 'setup', '--pack-browser', R, '--pack-browser-cache', C], downloads: DOWNLOADS, writes: WRITES },
};

let logs: string[];
let errors: string[];
let isTTY: boolean | undefined;

async function run(...args: string[]): Promise<void> {
  const program = new Command().exitOverride();
  registerSkillsCommands(program);
  await program.parseAsync(['node', 'pan', 'skills', ...args]);
}

beforeEach(() => {
  logs = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.join(' ')); });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
  isTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  // The library asks, and builds only after a yes.
  mocks.enablePackBrowser.mockImplementation(async (_id: string, confirm: (p: typeof preview) => Promise<boolean>) => {
    const written = await confirm(preview);
    if (written) mocks.buildRan();
    return { written, preview };
  });
  mocks.disablePackBrowser.mockResolvedValue({ changed: true, renderDir: R, cacheDir: C });
  mocks.listProjectsAsync.mockResolvedValue([]);
});

afterEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: isTTY, configurable: true });
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('pan skills pack browser', () => {
  it('prints the command, every download and every write, and builds nothing without --yes on a non-TTY', async () => {
    await expect(run('pack', 'browser', 'gstack')).rejects.toThrow('exit 1');
    const out = logs.join('\n');
    expect(out).toContain(`  Runs         bash setup --pack-browser ${R} --pack-browser-cache ${C}`);
    for (const line of DOWNLOADS) expect(logs).toContain(`${' '.repeat(16)}${line}`);
    for (const path of WRITES) expect(logs).toContain(`${' '.repeat(16)}${path}`);
    expect(out).not.toContain('…');
    expect(out).toContain('  Size         about 1 GB on disk');
    expect(out).toContain('Trusting runs the command above once now and downloads the listed packages and Chromium.');
    expect(out).toContain('Not written: re-run with --yes to trust 1b778f7.');
    expect(mocks.buildRan).not.toHaveBeenCalled();
  });

  it('asks the browser question on a TTY and builds after yes', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    mocks.question.mockResolvedValue('y');
    await run('pack', 'browser', 'gstack', 'on');
    expect(mocks.question).toHaveBeenCalledWith('Trust this browser runtime? [y/N] ');
    expect(mocks.buildRan).toHaveBeenCalledOnce();
    expect(logs).toContain('Browser runtime for gstack is on. Browser skills mount at the next launch.');
  });

  it('reports an already-on runtime without asking', async () => {
    mocks.enablePackBrowser.mockResolvedValue({ written: false, alreadyOn: true });
    await run('pack', 'browser', 'gstack', '--yes');
    expect(logs).toContain('Browser runtime for gstack is already on.');
  });

  it('off renders again, removes the cache and says so', async () => {
    await run('pack', 'browser', 'gstack', 'off');
    expect(mocks.disablePackBrowser).toHaveBeenCalledWith('gstack');
    expect(logs).toContain(`Browser runtime for gstack is off; ${R} was rendered again without it and ${C} was removed.`);
    expect(mocks.enablePackBrowser).not.toHaveBeenCalled();
  });

  it('rejects any other state', async () => {
    await expect(run('pack', 'browser', 'gstack', 'maybe')).rejects.toThrow('exit 1');
    expect(errors.join('\n')).toContain('state must be on or off');
    expect(mocks.enablePackBrowser).not.toHaveBeenCalled();
    expect(mocks.disablePackBrowser).not.toHaveBeenCalled();
  });

  it('prints a pack error and exits 1', async () => {
    mocks.enablePackBrowser.mockRejectedValue(new mocks.PackSourceError('render', 'pack gstack: 1b778f7 has no browser step'));
    await expect(run('pack', 'browser', 'gstack', '--yes')).rejects.toThrow('exit 1');
    expect(errors.join('\n')).toContain('pack gstack: 1b778f7 has no browser step');
  });
});

describe('pan skills pack add --browser and update', () => {
  it('add --browser --yes adds the pack, then runs the browser flow with its own preview', async () => {
    const plain = { ...preview, browser: undefined, runtime: { command: ['bash', 'setup', '--pack-root', R] } };
    mocks.addPack.mockImplementation(async (_input: unknown, confirm: (p: typeof plain) => Promise<boolean>) => ({
      written: await confirm(plain),
      preview: plain,
    }));
    await run('pack', 'add', 'gstack', 'https://github.com/eltmon/gstack', '--ref', 'main', '--browser', '--yes');
    expect(mocks.addPack).toHaveBeenCalledOnce();
    expect(mocks.enablePackBrowser).toHaveBeenCalledWith('gstack', expect.any(Function));
    expect(mocks.buildRan).toHaveBeenCalledOnce();
    expect(logs.filter((line) => line.startsWith('  Runs '))).toHaveLength(2);
    expect(logs).toContain('Browser runtime for gstack is on. Browser skills mount at the next launch.');
  });

  it('add without --browser never runs the browser flow', async () => {
    mocks.addPack.mockResolvedValue({ written: true, preview });
    await run('pack', 'add', 'gstack', 'https://github.com/eltmon/gstack', '--ref', 'main', '--yes');
    expect(mocks.enablePackBrowser).not.toHaveBeenCalled();
  });

  it('update shows the browser rows in its one preview', async () => {
    mocks.updatePack.mockImplementation(async (_id: string, _opts: unknown, confirm: (p: typeof preview) => Promise<boolean>) => ({
      written: await confirm({ ...preview, previousCommit: 'a'.repeat(40), diff: { added: [], removed: [], changed: [], newCapabilities: [] } } as typeof preview),
      preview,
    }));
    await run('pack', 'update', 'gstack', '--yes');
    expect(logs).toContain(`${' '.repeat(16)}playwright@^1.62.1`);
    expect(logs).toContain('Trusted gstack @ 1b778f7.');
  });
});
