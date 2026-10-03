/**
 * PAN-4499 WI-2: --skill/--pack write only the successor's conversation
 * skill_overrides map. No global, project, or issue store is touched.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpServerResponse } from 'effect/unstable/http';

vi.mock('../../conversations/summary-fork.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../conversations/summary-fork.js')>()),
  reserveSummaryForkSession: vi.fn(async () => ({ sessionId: `fork-${Math.random().toString(36).slice(2)}` })),
  generateSummaryForFork: vi.fn(() => new Promise(() => {})),
  authorHandoffExternal: vi.fn(() => new Promise(() => {})),
  copySessionFromCompactBoundary: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../conversation-runtime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation-runtime.js')>()),
  resolveAllowedHarness: vi.fn(async () => 'claude-code'),
  spawnConversationSession: vi.fn(async () => {}),
  isInsideGitWorkTree: vi.fn(async () => true),
}));

const catalog = {
  skills: [{ name: 'grilling', description: 'Grill the plan' }],
  packs: [
    {
      id: 'mattpocock',
      url: 'https://example.com/mattpocock',
      ref: 'main',
      commit: 'abc123',
      adapter: 'plain' as const,
      cached: true,
      manifest: {
        skills: [
          { name: 'a', dir: 'a', description: '', optIn: false },
          { name: 'b', dir: 'b', description: '', optIn: false },
          { name: 'c', dir: 'c', description: '', optIn: true },
        ],
        capabilities: {
          hooks: false, mcpServers: false, commands: false, agents: false,
          contextInjection: false, gitHooks: false, executables: [], projectMutatingSkills: [], requiresCli: [],
        },
        license: null,
        pluginName: null,
      },
    },
  ],
};

vi.mock('../../skill-overrides/catalog.js', () => ({
  listSkillCatalog: vi.fn(async () => catalog.skills),
  listPackCatalog: vi.fn(async () => catalog.packs),
}));

const setSkillOverride = vi.fn();
vi.mock('../../skill-overrides/store.js', () => ({ setSkillOverride }));

const { handleConversationSummaryFork } = await import('../conversation-forks.js');
const { sessionFilePath } = await import('../../runtimes/storage/claude-code.js');
const { generateSummaryForFork } = await import('../../conversations/summary-fork.js');
const { createConversation, getConversationByName, listConversations } = await import('../conversations.js');

let testHome: string;
let originalHome: string | undefined;
let parentCwd: string;

async function readBody(response: HttpServerResponse.HttpServerResponse): Promise<Record<string, unknown>> {
  return JSON.parse(await HttpServerResponse.toWeb(response).text()) as Record<string, unknown>;
}

async function fork(source: string, body: Record<string, unknown>) {
  const before = vi.mocked(generateSummaryForFork).mock.calls.length;
  const response = await handleConversationSummaryFork(source, body);
  if (response.status === 200) {
    await vi.waitFor(() => expect(vi.mocked(generateSummaryForFork).mock.calls.length).toBe(before + 1));
  }
  return { status: response.status, body: await readBody(response) };
}

function writeSessionFile(cwd: string, sessionId: string): void {
  const file = sessionFilePath(cwd, sessionId);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '{"type":"prompt"}\n');
}

function seed(name: string, extra: Partial<Parameters<typeof createConversation>[0]> = {}) {
  writeSessionFile(parentCwd, `${name}-session`);
  return createConversation({ name, tmuxSession: `conv-${name}`, cwd: parentCwd, claudeSessionId: `${name}-session`, harness: 'claude-code', ...extra });
}

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-4499-fork-skills-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  parentCwd = join(testHome, 'parent-project');
  mkdirSync(parentCwd, { recursive: true });
  seed('parent-conv');
  setSkillOverride.mockClear();
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('fork successors carry requested skill flags (PAN-4499 WI-2)', () => {
  it('writes --skill and --pack entries on the successor row', async () => {
    const { status, body } = await fork('parent-conv', { skills: ['grilling'], packs: ['mattpocock'] });
    expect(status).toBe(200);
    const name = (body['conversation'] as { name: string }).name;
    expect(getConversationByName(name)?.skillOverrides).toEqual({ grilling: true, 'mattpocock/a': true, 'mattpocock/b': true });
  });

  it('requested entries win over the inherited source map', async () => {
    seed('with-map', { skillOverrides: { grilling: false, foo: false } });
    const { status, body } = await fork('with-map', { skills: ['grilling'] });
    expect(status).toBe(200);
    const name = (body['conversation'] as { name: string }).name;
    expect(getConversationByName(name)?.skillOverrides).toEqual({ grilling: true, foo: false });
  });

  it('unknown skill returns 400 and creates no conversation', async () => {
    const before = listConversations().length;
    const { status, body } = await fork('parent-conv', { skills: ['nope'] });
    expect(status).toBe(400);
    expect(body['error']).toMatch(/^unknown skill: nope\. Known skills:/);
    expect(listConversations().length).toBe(before);
  });

  it('unknown pack returns 400 and creates no conversation', async () => {
    const before = listConversations().length;
    const { status, body } = await fork('parent-conv', { packs: ['nope'] });
    expect(status).toBe(400);
    expect(body['error']).toMatch(/^unknown pack: nope\. Known packs: mattpocock$/);
    expect(listConversations().length).toBe(before);
  });

  it('no skill flags keeps the source map unchanged (NFR-1)', async () => {
    seed('bare-map', { skillOverrides: { grilling: false } });
    const { status, body } = await fork('bare-map', {});
    expect(status).toBe(200);
    const name = (body['conversation'] as { name: string }).name;
    expect(getConversationByName(name)?.skillOverrides).toEqual({ grilling: false });
  });

  it('writes no global, project or issue override', async () => {
    const { status } = await fork('parent-conv', { skills: ['grilling'], packs: ['mattpocock'] });
    expect(status).toBe(200);
    expect(setSkillOverride).not.toHaveBeenCalled();
  });
});
