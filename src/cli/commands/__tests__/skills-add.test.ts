/** PAN-5465 WI-6: `pan skills add` through Commander, with fetch and the current-conversation lookup mocked. */
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveCurrentConversation: vi.fn() }));

vi.mock('../../../lib/conversations/current.js', () => ({ resolveCurrentConversation: mocks.resolveCurrentConversation }));

import { registerSkillsCommands } from '../skills.js';
import { SELF_RESTART_REFUSAL } from '../skills-add.js';

const BASE = 'http://127.0.0.1:3999';
let out: string[];
let errors: string[];

class ExitError extends Error {
  constructor(readonly code: number | undefined) {
    super(`exit ${code}`);
  }
}

async function run(...args: string[]): Promise<void> {
  const program = new Command().exitOverride();
  registerSkillsCommands(program);
  await program.parseAsync(['node', 'pan', 'skills', ...args]);
}

function answer(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({ ok: status < 300, status, json: async () => body }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  out = [];
  errors = [];
  process.env['OVERDECK_DASHBOARD_URL'] = BASE;
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.join(' ')); });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new ExitError(code); }) as never);
  mocks.resolveCurrentConversation.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env['OVERDECK_DASHBOARD_URL'];
});

describe('pan skills add', () => {
  it('lists its flags in --help', () => {
    const program = new Command();
    registerSkillsCommands(program);
    const add = program.commands.find((c) => c.name() === 'skills')!.commands.find((c) => c.name() === 'add')!;
    const help = add.helpInformation();
    for (const flag of ['--pack', '--skill', '--off', '--restart']) expect(help).toContain(flag);
  });

  it('posts the flags to the conversation route with an origin header', async () => {
    const fetchMock = answer(200, { outcome: 'hot', added: ['mattpocock/tdd', 'mattpocock/grilling'], warnings: [] });
    await run('add', 'conv-a', '--pack', 'mattpocock', '--skill', 'p/s', '--off', 'p/t');
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/api/conversations/conv-a/skills`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ packs: ['mattpocock'], skills: ['p/s'], off: ['p/t'] }),
    });
    expect(out).toEqual(['Added 2 skills to conv-a. They are available now.']);
  });

  it.each([
    ['sent', 'Added 1 skill to conv-a and sent /reload-plugins; the reload was not confirmed. Check the conversation.'],
    ['queued', 'Added 1 skill to conv-a. The reload runs when its current turn ends.'],
    ['needs-restart', 'Saved 1 skill on conv-a. This conversation must restart to load them: pan skills add conv-a --restart --pack mattpocock (it resumes with its history).'],
    ['restarted', 'Added 1 skill to conv-a and resumed it.'],
    ['next-launch', 'Saved 1 skill on conv-a. They load when it resumes.'],
  ])('prints the %s sentence and each warning', async (outcome, sentence) => {
    answer(200, { outcome, added: ['mattpocock/tdd'], warnings: ['first warning', 'second warning'] });
    await run('add', 'conv-a', '--pack', 'mattpocock');
    expect(out).toEqual([sentence, 'first warning', 'second warning']);
  });

  it('prints the error and exits 1 on a non-2xx answer', async () => {
    answer(409, { error: 'Skill packs apply only to Claude Code and Codex conversations' });
    await expect(run('add', 'conv-a', '--pack', 'mattpocock')).rejects.toThrow('exit 1');
    expect(errors).toEqual(['Skill packs apply only to Claude Code and Codex conversations']);
  });

  it('exits 1 when the dashboard is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(run('add', 'conv-a', '--pack', 'mattpocock')).rejects.toThrow('exit 1');
    expect(errors).toEqual([`Could not reach the Overdeck dashboard at ${BASE}. Start it with pan up.`]);
  });

  it('resolves self to the current conversation', async () => {
    mocks.resolveCurrentConversation.mockResolvedValue({ name: 'conv-me' });
    const fetchMock = answer(200, { outcome: 'queued', added: ['mattpocock/tdd'], warnings: [] });
    await run('add', 'self', '--skill', 'mattpocock/tdd');
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/api/conversations/conv-me/skills`, expect.anything());
    expect(out).toEqual(['Added 1 skill to conv-me. The reload runs when its current turn ends.']);
  });

  it('exits 1 for self outside a conversation', async () => {
    mocks.resolveCurrentConversation.mockResolvedValue(null);
    const fetchMock = answer(200, {});
    await expect(run('add', 'self', '--pack', 'mattpocock')).rejects.toThrow('exit 1');
    expect(errors).toEqual(['Not inside a conversation; name one']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses self --restart before any request', async () => {
    const fetchMock = answer(200, {});
    await expect(run('add', 'self', '--pack', 'mattpocock', '--restart')).rejects.toThrow('exit 1');
    expect(errors).toEqual([SELF_RESTART_REFUSAL]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.resolveCurrentConversation).not.toHaveBeenCalled();
  });
});
