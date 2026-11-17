/** PAN-5465 WI-4: the conversation skill apply service. Every effect is injected; nothing touches a database. */
import { describe, expect, it, vi } from 'vitest';
import type { LivenessVerdict } from '../../agents/liveness.js';
import type { PackCatalogEntry, SkillCatalogEntry } from '../../skill-overrides/catalog.js';
import { ConversationSkillFlagError } from '../../skill-overrides/conversation-flags.js';
import {
  APPLY_IN_PROGRESS,
  HARNESS_REFUSAL,
  INDETERMINATE_WARNING,
  NO_PLUGIN_DIR_WARNING,
  NOTHING_TO_ADD,
  SELF_RESTART_REFUSAL,
  applyConversationSkills,
  parseSkillApplyBody,
  readConversationSkills,
  type SkillApplyDeps,
  type SkillApplyRequest,
} from '../conversation-skill-apply.js';
import type { HotApplyReady } from '../conversation-skill-hot-apply.js';
import type { LegacyConversation } from '../conversations.js';

const CATALOG = {
  skills: [{ name: 'codebase-design' }] as unknown as SkillCatalogEntry[],
  packs: [{
    id: 'mattpocock',
    manifest: { skills: [{ name: 'tdd', optIn: false }, { name: 'grilling', optIn: false }, { name: 'setup', optIn: true }] },
  }] as unknown as PackCatalogEntry[],
};

const ALIVE: LivenessVerdict = { alive: true, paneAlive: true };
const STOPPED: LivenessVerdict = { alive: false, reason: 'no-session' };
const INDETERMINATE: LivenessVerdict = { alive: false, reason: 'runtime-indeterminate' };

function conv(overrides: Partial<LegacyConversation> = {}): LegacyConversation {
  return {
    id: 1,
    name: 'conv-a',
    tmuxSession: 'conv-a',
    cwd: '/repo',
    issueId: null,
    harness: 'claude-code',
    skillOverrides: null,
    clearedToConvId: null,
    ...overrides,
  } as unknown as LegacyConversation;
}

function request(overrides: Partial<SkillApplyRequest> = {}): SkillApplyRequest {
  return { skills: [], packs: [], off: [], restart: false, ...overrides };
}

const READY: HotApplyReady = { kind: 'ready', selection: { packs: [] }, mounted: new Map(), warnings: ['selection warning'] };

function harness(rows: LegacyConversation[], overrides: Partial<SkillApplyDeps> = {}) {
  const byName = new Map(rows.map((row) => [row.name, row]));
  const writes: Array<[string, Record<string, boolean> | null]> = [];
  const deps: Partial<SkillApplyDeps> = {
    getConversationByName: (name) => byName.get(name) ?? null,
    resolveChainHead: (row) => rows.find((candidate) => candidate.id === row.clearedToConvId) ?? null,
    setConversationSkillOverrides: vi.fn((name: string, map: Record<string, boolean> | null) => {
      writes.push([name, map]);
      const row = byName.get(name);
      if (row) (row as { skillOverrides: Record<string, boolean> | null }).skillOverrides = map;
    }),
    isAlive: vi.fn(async () => ALIVE),
    isShutdownDraining: () => false,
    listCatalog: vi.fn(async () => CATALOG),
    hotApplyPrecheck: vi.fn(async () => READY),
    hotApplyRun: vi.fn(async () => ({ kind: 'applied' as const, outcome: 'hot' as const, warnings: ['run warning'] })),
    resumeApply: vi.fn(async () => 200),
    ...overrides,
  };
  return { deps, writes };
}

describe('applyConversationSkills outcomes', () => {
  it('returns next-launch for a confirmed-stopped conversation and stores the map', async () => {
    const { deps, writes } = harness([conv()], { isAlive: async () => STOPPED });
    const result = await applyConversationSkills('conv-a', request({ packs: ['mattpocock'] }), { self: false }, deps);
    expect(result).toEqual({ status: 200, body: { outcome: 'next-launch', added: ['mattpocock/grilling', 'mattpocock/tdd'], warnings: [] } });
    expect(writes).toEqual([['conv-a', { 'mattpocock/grilling': true, 'mattpocock/tdd': true }]]);
    expect(deps.hotApplyPrecheck).not.toHaveBeenCalled();
  });

  it('returns needs-restart for a running Codex conversation, and restarted with restart: true', async () => {
    const codex = harness([conv({ harness: 'codex' })]);
    expect((await applyConversationSkills('conv-a', request({ skills: ['mattpocock/tdd'] }), { self: false }, codex.deps)).body)
      .toEqual({ outcome: 'needs-restart', added: ['mattpocock/tdd'], warnings: [] });
    expect(codex.deps.resumeApply).not.toHaveBeenCalled();

    const restart = harness([conv({ harness: 'codex' })]);
    expect((await applyConversationSkills('conv-a', request({ skills: ['mattpocock/tdd'], restart: true }), { self: false }, restart.deps)).body)
      .toEqual({ outcome: 'restarted', added: ['mattpocock/tdd'], warnings: [] });
    expect(restart.deps.resumeApply).toHaveBeenCalledTimes(1);
    expect(restart.writes).toHaveLength(1);
  });

  it('answers 502 when the restart fails after storing the map', async () => {
    const { deps, writes } = harness([conv({ harness: 'codex' })], { resumeApply: async () => 500 });
    const result = await applyConversationSkills('conv-a', request({ skills: ['mattpocock/tdd'], restart: true }), { self: false }, deps);
    expect(result).toEqual({
      status: 502,
      body: { error: 'The skills are saved, but the restart failed (status 500); resume the conversation to load them' },
    });
    expect(writes).toHaveLength(1);
  });

  it('returns needs-restart for a native skill on Claude Code without a hot apply', async () => {
    const { deps } = harness([conv()]);
    const result = await applyConversationSkills('conv-a', request({ skills: ['codebase-design'] }), { self: false }, deps);
    expect(result.body).toEqual({ outcome: 'needs-restart', added: ['codebase-design'], warnings: [] });
    expect(deps.hotApplyPrecheck).not.toHaveBeenCalled();
  });

  it('runs the hot apply for a running Claude Code conversation and returns its outcome', async () => {
    const order: string[] = [];
    const { deps } = harness([conv({ skillOverrides: { 'other/x': true } })], {
      setConversationSkillOverrides: vi.fn(() => { order.push('write'); }),
      hotApplyRun: vi.fn(async () => {
        order.push('run');
        return { kind: 'applied' as const, outcome: 'hot' as const, warnings: ['run warning'] };
      }),
    });
    const result = await applyConversationSkills('conv-a', request({ skills: ['mattpocock/tdd'] }), { self: false }, deps);
    expect(result).toEqual({ status: 200, body: { outcome: 'hot', added: ['mattpocock/tdd'], warnings: ['selection warning', 'run warning'] } });
    expect(deps.hotApplyPrecheck).toHaveBeenCalledWith(expect.objectContaining({ name: 'conv-a' }), {
      link: expect.stringMatching(/\/launch\/conv-a\/skill-packs$/),
      conversationLayer: { 'other/x': true, 'mattpocock/tdd': true },
    });
    expect(deps.hotApplyRun).toHaveBeenCalledWith(expect.objectContaining({ name: 'conv-a' }), READY, {
      link: expect.stringMatching(/\/launch\/conv-a\/skill-packs$/),
      assumeBusy: false,
    });
    expect(order).toEqual(['write', 'run']);
  });

  it('turns a not-hot precheck into needs-restart with its warning', async () => {
    const launchWired = harness([conv()], { hotApplyPrecheck: async () => ({ kind: 'not-hot', reason: 'launch-wired', packs: ['deft'] }) });
    expect((await applyConversationSkills('conv-a', request({ skills: ['mattpocock/tdd'] }), { self: false }, launchWired.deps)).body)
      .toEqual({ outcome: 'needs-restart', added: ['mattpocock/tdd'], warnings: ['deft need a restart to load.'] });

    const noPluginDir = harness([conv()], { hotApplyPrecheck: async () => ({ kind: 'not-hot', reason: 'no-plugin-dir' }) });
    expect((await applyConversationSkills('conv-a', request({ skills: ['mattpocock/tdd'], restart: true }), { self: false }, noPluginDir.deps)).body)
      .toEqual({ outcome: 'restarted', added: ['mattpocock/tdd'], warnings: [NO_PLUGIN_DIR_WARNING] });
  });
});

describe('applyConversationSkills merge', () => {
  it('keeps unrelated entries, writes off as false, and lists only changed ids in added', async () => {
    const { deps, writes } = harness([conv({ skillOverrides: { 'other/x': true, 'mattpocock/tdd': true } })], { isAlive: async () => STOPPED });
    const result = await applyConversationSkills(
      'conv-a',
      request({ skills: ['mattpocock/tdd', 'mattpocock/grilling'], off: ['mattpocock/setup'] }),
      { self: false },
      deps,
    );
    expect(result.body).toEqual({ outcome: 'next-launch', added: ['mattpocock/grilling', 'mattpocock/setup'], warnings: [] });
    expect(writes).toEqual([['conv-a', { 'other/x': true, 'mattpocock/tdd': true, 'mattpocock/grilling': true, 'mattpocock/setup': false }]]);
  });

  it('writes the chain head of a superseded /clear row', async () => {
    const old = conv({ id: 1, name: 'conv-old', tmuxSession: 'conv-a', clearedToConvId: 2 });
    const head = conv({ id: 2, name: 'conv-new', tmuxSession: 'conv-a', skillOverrides: { 'other/x': true } });
    const { deps, writes } = harness([old, head], { isAlive: async () => STOPPED });
    await applyConversationSkills('conv-old', request({ skills: ['mattpocock/tdd'] }), { self: false }, deps);
    expect(writes).toEqual([['conv-new', { 'other/x': true, 'mattpocock/tdd': true }]]);
  });
});

describe('applyConversationSkills refusals store nothing', () => {
  it('refuses a Pi conversation with 409', async () => {
    const { deps, writes } = harness([conv({ harness: 'pi' as LegacyConversation['harness'] })]);
    expect(await applyConversationSkills('conv-a', request({ skills: ['mattpocock/tdd'] }), { self: false }, deps))
      .toEqual({ status: 409, body: { error: HARNESS_REFUSAL } });
    expect(writes).toEqual([]);
  });

  it('refuses an unknown pack with 400', async () => {
    const { deps, writes } = harness([conv()]);
    const result = await applyConversationSkills('conv-a', request({ packs: ['nope'] }), { self: false }, deps);
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toMatch(/^unknown pack: nope\./);
    expect(writes).toEqual([]);
  });

  it('refuses empty lists with 400 and a missing conversation with 404', async () => {
    const { deps, writes } = harness([conv()]);
    expect(await applyConversationSkills('conv-a', request(), { self: false }, deps)).toEqual({ status: 400, body: { error: NOTHING_TO_ADD } });
    expect(await applyConversationSkills('conv-zz', request({ skills: ['mattpocock/tdd'] }), { self: false }, deps))
      .toEqual({ status: 404, body: { error: 'Conversation not found' } });
    expect(writes).toEqual([]);
  });

  it('returns a precheck refusal as 409 without storing the map', async () => {
    const refusal = { kind: 'refused' as const, status: 409 as const, body: { error: 'Waiting: the agent needs a permission answer first', code: 'permission-pending' } };
    const { deps, writes } = harness([conv()], { hotApplyPrecheck: async () => refusal });
    expect(await applyConversationSkills('conv-a', request({ skills: ['mattpocock/tdd'] }), { self: false }, deps))
      .toEqual({ status: 409, body: refusal.body });
    expect(writes).toEqual([]);
  });

  it('refuses while the shutdown drains', async () => {
    const { deps, writes } = harness([conv()], { isShutdownDraining: () => true });
    const result = await applyConversationSkills('conv-a', request({ skills: ['mattpocock/tdd'] }), { self: false }, deps);
    expect(result.status).toBe(409);
    expect((result.body as { code?: string }).code).toBe('shutdown-draining');
    expect(writes).toEqual([]);
  });
});

describe('applyConversationSkills self and concurrency', () => {
  it('refuses restart from the self route and passes assumeBusy to the hot apply', async () => {
    const { deps } = harness([conv()]);
    expect(await applyConversationSkills('conv-a', request({ skills: ['mattpocock/tdd'], restart: true }), { self: true }, deps))
      .toEqual({ status: 400, body: { error: SELF_RESTART_REFUSAL } });
    await applyConversationSkills('conv-a', request({ skills: ['mattpocock/tdd'] }), { self: true }, deps);
    expect(deps.hotApplyRun).toHaveBeenCalledWith(expect.anything(), READY, expect.objectContaining({ assumeBusy: true }));
  });

  it('answers 409 apply-in-progress for a second call on the same chain, then releases the lock', async () => {
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const old = conv({ id: 1, name: 'conv-old', tmuxSession: 'conv-a', clearedToConvId: 2 });
    const head = conv({ id: 2, name: 'conv-new', tmuxSession: 'conv-a' });
    const { deps } = harness([old, head], {
      hotApplyRun: vi.fn(async () => {
        await blocked;
        return { kind: 'applied' as const, outcome: 'hot' as const, warnings: [] };
      }),
    });
    const first = applyConversationSkills('conv-new', request({ skills: ['mattpocock/tdd'] }), { self: false }, deps);
    await vi.waitFor(() => expect(deps.hotApplyRun).toHaveBeenCalled());
    expect(await applyConversationSkills('conv-new', request({ skills: ['mattpocock/grilling'] }), { self: false }, deps))
      .toEqual({ status: 409, body: { error: APPLY_IN_PROGRESS, code: 'apply-in-progress' } });
    expect(await applyConversationSkills('conv-old', request({ skills: ['mattpocock/grilling'] }), { self: false }, deps))
      .toEqual({ status: 409, body: { error: APPLY_IN_PROGRESS, code: 'apply-in-progress' } });
    release();
    expect((await first).status).toBe(200);
    expect((await applyConversationSkills('conv-new', request({ skills: ['mattpocock/grilling'] }), { self: false }, deps)).status).toBe(200);
  });

  it('never resumes on runtime-indeterminate, even with restart: true', async () => {
    const { deps, writes } = harness([conv({ harness: 'codex' })], { isAlive: async () => INDETERMINATE });
    const result = await applyConversationSkills('conv-a', request({ skills: ['mattpocock/tdd'], restart: true }), { self: false }, deps);
    expect(result.body).toEqual({ outcome: 'needs-restart', added: ['mattpocock/tdd'], warnings: [INDETERMINATE_WARNING] });
    expect(deps.resumeApply).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
  });
});

describe('parseSkillApplyBody', () => {
  it('parses the lists and restart', () => {
    expect(parseSkillApplyBody({ packs: ['mattpocock'], skills: ['mattpocock/tdd'], off: ['mattpocock/setup'], restart: true }))
      .toEqual({ packs: ['mattpocock'], skills: ['mattpocock/tdd'], off: ['mattpocock/setup'], restart: true });
    expect(parseSkillApplyBody({})).toEqual({ packs: [], skills: [], off: [], restart: false });
  });

  it('rejects malformed fields and pack groups', () => {
    expect(() => parseSkillApplyBody({ off: 'x' })).toThrow(new ConversationSkillFlagError('Invalid off'));
    expect(() => parseSkillApplyBody({ skills: [3] })).toThrow('Invalid skills');
    expect(() => parseSkillApplyBody({ restart: 'yes' })).toThrow('Invalid restart');
    expect(() => parseSkillApplyBody({ groups: ['video'] })).toThrow('Pack groups are not supported yet');
  });
});

describe('readConversationSkills', () => {
  it('returns the chain head map, harness and running state', async () => {
    const old = conv({ id: 1, name: 'conv-old', clearedToConvId: 2 });
    const head = conv({ id: 2, name: 'conv-new', harness: 'codex', skillOverrides: { 'mattpocock/tdd': true } });
    const { deps } = harness([old, head], { isAlive: async () => STOPPED });
    expect(await readConversationSkills('conv-old', deps)).toEqual({
      status: 200,
      body: { conversation: 'conv-new', harness: 'codex', running: false, skillOverrides: { 'mattpocock/tdd': true } },
    });
    expect(await readConversationSkills('conv-zz', deps)).toEqual({ status: 404, body: { error: 'Conversation not found' } });
  });
});
