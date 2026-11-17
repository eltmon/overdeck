/** PAN-5465 WI-3: hot apply of pack skills into a running Claude Code conversation. All I/O is injected. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { deliverAgentMessage, handleConversationMessage } = vi.hoisted(() => ({
  deliverAgentMessage: vi.fn(async () => ({ ok: true, path: 'tmux' })),
  handleConversationMessage: vi.fn(),
}));
vi.mock('../../agents/delivery.js', () => ({ deliverAgentMessage }));
vi.mock('../conversation-message.js', () => ({ handleConversationMessage }));

import type { LaunchPackMcp } from '../../skill-overrides/launch.js';
import type { Mount, MountPack, MountSelection } from '../../skill-packs/mount.js';
import type { LegacyConversation } from '../conversations.js';
import {
  hasPluginDirArg,
  hotApplyPrecheck,
  hotApplyRun,
  launchWiredChange,
  QUEUED_WARNING,
  readReloadLines,
  RELOAD_COMMAND,
  SECOND_RELOAD_UNCONFIRMED_WARNING,
  type HotApplyDeps,
  type HotApplyReady,
} from '../conversation-skill-hot-apply.js';

const LINK = '/x/launch/conv-a/skill-packs';
const CONV = { name: 'conv-a', tmuxSession: 'conv-a', cwd: '/repo', issueId: null } as unknown as LegacyConversation;

function pack(id: string, skills: string[], transform?: MountPack['transform']): MountPack {
  return { id, commit: 'c'.repeat(40), root: `/cache/${id}`, skills: skills.map((name) => ({ name, dir: `skills/${name}` })), ...(transform ? { transform } : {}) };
}

function mounted(entries: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(entries).map(([id, skills]) => [id, new Set(skills)]));
}

function mcpEntry(packId: string): LaunchPackMcp {
  return { packId, servers: {}, consented: true };
}

describe('hasPluginDirArg', () => {
  it('matches the flag followed by a space or the end of the args', () => {
    expect(hasPluginDirArg(['node x', `claude --x --plugin-dir ${LINK} --model y`], LINK)).toBe(true);
    expect(hasPluginDirArg([`claude --plugin-dir ${LINK}`], LINK)).toBe(true);
  });

  it('rejects a longer path and a missing flag', () => {
    expect(hasPluginDirArg(['claude --plugin-dir /x/launch/conv-ab/skill-packs --model y'], '/x/launch/conv-a')).toBe(false);
    expect(hasPluginDirArg(['claude --plugin-dir /x/launch/conv-ab/skill-packs --model y'], LINK)).toBe(false);
    expect(hasPluginDirArg([`claude --plugin-dir ${LINK}-old`], LINK)).toBe(false);
    expect(hasPluginDirArg([`claude ${LINK}`], LINK)).toBe(false);
    expect(hasPluginDirArg([], LINK)).toBe(false);
  });
});

describe('launchWiredChange', () => {
  it('returns the id of a changed deft, gstack-runtime or MCP pack', () => {
    expect(launchWiredChange({ packs: [pack('deft', ['glossary'], 'deft-readonly')] }, [], mounted({}))).toEqual(['deft']);
    expect(launchWiredChange({ packs: [pack('gstack', ['browse'], 'gstack-runtime')] }, [], mounted({}))).toEqual(['gstack']);
    expect(launchWiredChange({ packs: [pack('tools', ['a'])] }, [mcpEntry('tools')], mounted({}))).toEqual(['tools']);
    expect(launchWiredChange({ packs: [] }, [], mounted({ sageox: ['ox'] }))).toEqual(['sageox']);
  });

  it('returns [] for a plain pack change and for an unchanged deft pack', () => {
    expect(launchWiredChange({ packs: [pack('mattpocock', ['grilling', 'tdd'])] }, [], mounted({ mattpocock: ['grilling'] }))).toEqual([]);
    expect(launchWiredChange(
      { packs: [pack('deft', ['glossary'], 'deft-readonly'), pack('mattpocock', ['tdd'])] },
      [],
      mounted({ deft: ['glossary'] }),
    )).toEqual([]);
  });
});

describe('readReloadLines', () => {
  it('counts the lines and returns the last one with its skill count', () => {
    const pane = 'Reloaded: 2 plugins · 12 skills · 3 agents\n❯ /reload-plugins\nReloaded: 3 plugins · 13 skills · 3 agents\n';
    expect(readReloadLines(pane)).toEqual({ count: 2, last: 'Reloaded: 3 plugins · 13 skills', skills: 13 });
    expect(readReloadLines('Reloaded: 1 plugin · 1 skill')).toEqual({ count: 1, last: 'Reloaded: 1 plugin · 1 skill', skills: 1 });
    expect(readReloadLines('nothing here')).toEqual({ count: 0, last: null, skills: null });
  });
});

describe('hotApplyPrecheck', () => {
  const selection: MountSelection = { packs: [pack('mattpocock', ['grilling', 'tdd'])] };

  function deps(overrides: Partial<HotApplyDeps> = {}): Partial<HotApplyDeps> {
    return {
      readProcessArgs: async () => [`claude --plugin-dir ${LINK}`],
      resolveSelection: vi.fn(async () => ({ selection, mcp: [], warnings: ['w1'] })),
      readMountedSkills: async () => mounted({ mattpocock: ['grilling'] }),
      pendingPermission: async () => null,
      ensureMainInput: async () => ({ ok: true }),
      ...overrides,
    };
  }

  it('is ready with the selection, the live mount and the selection warnings, resolving with the new map', async () => {
    const d = deps();
    const result = await hotApplyPrecheck(CONV, { link: LINK, conversationLayer: { 'mattpocock/tdd': true } }, d);
    expect(result).toEqual({ kind: 'ready', selection, mounted: mounted({ mattpocock: ['grilling'] }), warnings: ['w1'] });
    expect(d.resolveSelection).toHaveBeenCalledWith({
      cwd: '/repo',
      issueId: undefined,
      conversation: 'conv-a',
      conversationLayer: { 'mattpocock/tdd': true },
    });
  });

  it('is not hot without --plugin-dir <link>, or when the process table cannot be read', async () => {
    expect(await hotApplyPrecheck(CONV, { link: LINK, conversationLayer: {} }, deps({ readProcessArgs: async () => ['claude --model y'] })))
      .toEqual({ kind: 'not-hot', reason: 'no-plugin-dir' });
    expect(await hotApplyPrecheck(CONV, { link: LINK, conversationLayer: {} }, deps({ readProcessArgs: async () => { throw new Error('ps'); } })))
      .toEqual({ kind: 'not-hot', reason: 'no-plugin-dir' });
  });

  it('is not hot when a launch-wired pack changes', async () => {
    const wired = deps({ resolveSelection: async () => ({ selection: { packs: [pack('deft', ['glossary'], 'deft-readonly')] }, mcp: [], warnings: [] }) });
    expect(await hotApplyPrecheck(CONV, { link: LINK, conversationLayer: {} }, wired))
      .toEqual({ kind: 'not-hot', reason: 'launch-wired', packs: ['deft'] });
  });

  it('refuses with 409 when a permission prompt is waiting', async () => {
    expect(await hotApplyPrecheck(CONV, { link: LINK, conversationLayer: {} }, deps({ pendingPermission: async () => ({ answerable: true }) })))
      .toEqual({ kind: 'refused', status: 409, body: { error: 'Waiting: the agent needs a permission answer first', code: 'permission-pending' } });
  });

  it('refuses with 409 when the input target is a subagent view', async () => {
    const ensureMainInput = vi.fn(async () => ({ ok: false as const, reason: 'Input is on a subagent' }));
    expect(await hotApplyPrecheck(CONV, { link: LINK, conversationLayer: {} }, deps({ ensureMainInput })))
      .toEqual({ kind: 'refused', status: 409, body: { error: 'Input is on a subagent', code: 'input-target-not-main' } });
    expect(ensureMainInput).toHaveBeenCalledWith('conv-a');
  });
});

describe('hotApplyRun', () => {
  const MOUNT: Mount = { path: '/mounts/new', hash: 'new', packIds: ['mattpocock'] };
  // Live mount has 1 pack skill; the new selection has 2, so the expected delta is +1.
  const READY: HotApplyReady = {
    kind: 'ready',
    selection: { packs: [pack('mattpocock', ['grilling', 'tdd'])] },
    mounted: mounted({ mattpocock: ['grilling'] }),
    warnings: [],
  };

  /** A fake Claude Code pane: an idle reload prints a line counting the base skills plus whatever the link mounts. */
  function fakeSession(opts: { busy?: boolean; skillsAfterRelink?: number; lineAppearsAfterRelink?: boolean } = {}) {
    const calls: string[] = [];
    const lines: string[] = ['Reloaded: 2 plugins · 11 skills'];
    let packSkills = 1;
    let relinked = false;
    const reload = () => lines.push(`Reloaded: 2 plugins · ${10 + packSkills} skills`);
    const deps: Partial<HotApplyDeps> = {
      buildMount: vi.fn(async () => { calls.push('build'); return MOUNT; }),
      relink: vi.fn(async (_link: string, mount: Mount | null) => {
        calls.push(`relink:${mount?.hash ?? 'empty'}`);
        relinked = true;
        packSkills = opts.skillsAfterRelink ?? 2;
        if (opts.lineAppearsAfterRelink) reload();
      }),
      deliver: vi.fn(async (_session: string, text: string) => {
        calls.push(`deliver:${text}`);
        if (!opts.busy) reload();
        return { ok: true };
      }),
      readPane: vi.fn(async () => {
        calls.push('read');
        return lines.join('\n');
      }),
    };
    return { calls, deps, isRelinked: () => relinked };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function run(deps: Partial<HotApplyDeps>, assumeBusy = false) {
    const pending = hotApplyRun(CONV, READY, { link: LINK, assumeBusy }, deps);
    await vi.runAllTimersAsync();
    return pending;
  }

  it('idle: reloads, relinks, reloads again, and returns hot when the skill delta matches', async () => {
    const session = fakeSession();
    expect(await run(session.deps)).toEqual({ kind: 'applied', outcome: 'hot', warnings: [] });
    const order = session.calls.filter((call) => call !== 'read');
    expect(order).toEqual(['build', `deliver:${RELOAD_COMMAND}`, 'relink:new', `deliver:${RELOAD_COMMAND}`]);
  });

  it('idle: returns sent with the count warning when the delta does not match', async () => {
    const session = fakeSession({ skillsAfterRelink: 1 });
    expect(await run(session.deps)).toEqual({
      kind: 'applied',
      outcome: 'sent',
      warnings: ['Reloaded, but the skill count changed by 0, expected 1. Check the conversation.'],
    });
  });

  it('idle: returns sent when the second reload never prints', async () => {
    const session = fakeSession();
    let delivered = 0;
    session.deps.deliver = vi.fn(async () => {
      delivered += 1;
      return { ok: true };
    });
    const lines = ['Reloaded: 2 plugins · 11 skills'];
    session.deps.readPane = vi.fn(async () => (delivered >= 1 ? [...lines, 'Reloaded: 2 plugins · 11 skills · baseline'].join('\n') : lines.join('\n')));
    expect(await run(session.deps)).toEqual({ kind: 'applied', outcome: 'sent', warnings: [SECOND_RELOAD_UNCONFIRMED_WARNING] });
  });

  it('busy: no baseline line within 15 s and none after the relink → one reload in total, queued', async () => {
    const session = fakeSession({ busy: true });
    expect(await run(session.deps)).toEqual({ kind: 'applied', outcome: 'queued', warnings: [QUEUED_WARNING] });
    expect(session.deps.deliver).toHaveBeenCalledTimes(1);
    expect(session.isRelinked()).toBe(true);
    expect(session.deps.readPane).toHaveBeenCalledTimes(1 + 15 + 1);
  });

  it('busy race: a new line appears on the read after the relink → a second reload, queued', async () => {
    const session = fakeSession({ busy: true, lineAppearsAfterRelink: true });
    expect(await run(session.deps)).toEqual({ kind: 'applied', outcome: 'queued', warnings: [QUEUED_WARNING] });
    expect(session.deps.deliver).toHaveBeenCalledTimes(2);
    const order = session.calls.filter((call) => call !== 'read');
    expect(order).toEqual(['build', `deliver:${RELOAD_COMMAND}`, 'relink:new', `deliver:${RELOAD_COMMAND}`]);
  });

  it('assumeBusy: relinks, delivers one reload, reads no pane, and returns queued', async () => {
    const session = fakeSession();
    expect(await run(session.deps, true)).toEqual({ kind: 'applied', outcome: 'queued', warnings: [QUEUED_WARNING] });
    expect(session.calls).toEqual(['build', 'relink:new', `deliver:${RELOAD_COMMAND}`]);
    expect(session.deps.readPane).not.toHaveBeenCalled();
  });

  it('delivers through deliverAgentMessage with the tmux method by default, never the conversation message path (D-9)', async () => {
    const session = fakeSession();
    delete session.deps.deliver;
    deliverAgentMessage.mockClear();
    expect(await run(session.deps, true)).toEqual({ kind: 'applied', outcome: 'queued', warnings: [QUEUED_WARNING] });
    expect(deliverAgentMessage).toHaveBeenCalledTimes(1);
    expect(deliverAgentMessage).toHaveBeenCalledWith('conv-a', '/reload-plugins', 'skill-reload', 'tmux');
    expect(handleConversationMessage).not.toHaveBeenCalled();
  });

  it('a failed delivery returns sent with the not-delivered warning, after updating the link', async () => {
    const session = fakeSession();
    session.deps.deliver = vi.fn(async () => ({ ok: false, failure: 'pane gone' }));
    expect(await run(session.deps)).toEqual({
      kind: 'applied',
      outcome: 'sent',
      warnings: ['The reload was not delivered: pane gone. Send /reload-plugins to the conversation.'],
    });
    expect(session.isRelinked()).toBe(true);
  });
});
