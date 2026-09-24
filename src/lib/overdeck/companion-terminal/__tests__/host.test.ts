import { describe, expect, it, vi } from 'vitest';
import {
  COMPANION_GENERATION_ENV,
  companionPaneCommand,
  createTmuxCompanionHost,
  type TmuxCompanionHostDeps,
} from '../host.js';

function deps(handlers: Partial<Record<string, (args: string[]) => string>>) {
  const exec = vi.fn(async (args: string[]) => {
    const handler = handlers[args[0]];
    if (!handler) throw new Error(`unexpected tmux ${args[0]}`);
    return handler(args);
  });
  const createSession = vi.fn(async () => undefined);
  return { exec, createSession } satisfies TmuxCompanionHostDeps;
}

const missing = () => {
  throw new Error("can't find session");
};

describe('tmux companion host', () => {
  it('quotes every argv element and execs the native client', () => {
    expect(companionPaneCommand(['/opt/open code/opencode', 'attach', "it's"])).toBe(
      `exec '/opt/open code/opencode' 'attach' 'it'\\''s'`,
    );
    expect(() => companionPaneCommand([])).toThrow(/argv is empty/);
  });

  it('creates the companion with the generation pinned atomically on the session', async () => {
    const d = deps({});
    const host = createTmuxCompanionHost(d);

    await host.create('companion-conv-a', { cwd: '/w', argv: ['/bin/opencode', 'attach', 'http://127.0.0.1:4000'], generation: 'g1' });

    expect(d.createSession).toHaveBeenCalledWith(
      'companion-conv-a',
      '/w',
      `exec '/bin/opencode' 'attach' 'http://127.0.0.1:4000'`,
      { [COMPANION_GENERATION_ENV]: 'g1', TERM: 'xterm-256color' },
    );
    await expect(host.create('bad name', { cwd: '/w', argv: ['x'], generation: 'g' })).rejects.toThrow(/Invalid tmux session name/);
  });

  it('pins adapter env on the pane without letting it override the generation stamp (PAN-3835)', async () => {
    const d = deps({});
    const host = createTmuxCompanionHost(d);

    await host.create('companion-conv-b', {
      cwd: '/w',
      argv: ['/bin/codex', 'resume', '--remote', 'unix:///s/app.sock', 'thread-1'],
      generation: 'g2',
      env: { CODEX_HOME: '/home/op/.overdeck/agents/conv-b/codex-home-v2', [COMPANION_GENERATION_ENV]: 'forged' },
    });

    expect(d.createSession).toHaveBeenCalledWith(
      'companion-conv-b',
      '/w',
      `exec '/bin/codex' 'resume' '--remote' 'unix:///s/app.sock' 'thread-1'`,
      {
        CODEX_HOME: '/home/op/.overdeck/agents/conv-b/codex-home-v2',
        [COMPANION_GENERATION_ENV]: 'g2',
        TERM: 'xterm-256color',
      },
    );
  });

  it('reads the owner incarnation only when the owner session exists', async () => {
    const alive = deps({ 'has-session': () => '', 'display-message': () => '1790000000\n' });
    expect(await createTmuxCompanionHost(alive).ownerStamp('conv-a')).toBe('1790000000');
    expect(alive.exec).toHaveBeenCalledWith(['display-message', '-p', '-t', '=conv-a:', '#{session_created}']);

    // tmux prints an empty line with exit 0 for a missing pane target, so
    // has-session is the existence authority.
    const gone = deps({ 'has-session': missing, 'display-message': () => '\n' });
    expect(await createTmuxCompanionHost(gone).ownerStamp('conv-a')).toBeNull();
  });

  it('distinguishes a missing companion, an unstamped one, and a stamped one', async () => {
    expect(await createTmuxCompanionHost(deps({ 'has-session': missing })).readGeneration('companion-x')).toBeUndefined();
    expect(
      await createTmuxCompanionHost(deps({ 'has-session': () => '', 'show-environment': missing })).readGeneration('companion-x'),
    ).toBeNull();
    const stamped = deps({ 'has-session': () => '', 'show-environment': () => `${COMPANION_GENERATION_ENV}=abc123\n` });
    expect(await createTmuxCompanionHost(stamped).readGeneration('companion-x')).toBe('abc123');
    expect(stamped.exec).toHaveBeenCalledWith(['show-environment', '-t', '=companion-x', COMPANION_GENERATION_ENV]);
  });

  it('kills by exact session name and reports whether anything was killed', async () => {
    const present = deps({ 'has-session': () => '', 'kill-session': () => '' });
    expect(await createTmuxCompanionHost(present).kill('companion-x')).toBe(true);
    expect(present.exec).toHaveBeenCalledWith(['kill-session', '-t', '=companion-x']);

    const absent = deps({ 'has-session': missing });
    expect(await createTmuxCompanionHost(absent).kill('companion-x')).toBe(false);
    expect(absent.exec).not.toHaveBeenCalledWith(expect.arrayContaining(['kill-session']));
  });

  it('never sends keys or pastes text into any pane', async () => {
    const d = deps({ 'has-session': () => '', 'display-message': () => '1', 'show-environment': () => '', 'kill-session': () => '' });
    const host = createTmuxCompanionHost(d);
    await host.ownerStamp('conv-a');
    await host.readGeneration('companion-a');
    await host.create('companion-a', { cwd: '/w', argv: ['x'], generation: 'g' });
    await host.kill('companion-a');
    const verbs = d.exec.mock.calls.map(([args]) => args[0]);
    expect(verbs).not.toContain('send-keys');
    expect(verbs).not.toContain('paste-buffer');
    expect(verbs).not.toContain('set-buffer');
  });
});
