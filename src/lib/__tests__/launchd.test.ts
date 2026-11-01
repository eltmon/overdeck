import { describe, expect, it, vi } from 'vitest';

import {
  installSupervisorAgent,
  isSupervisorAgentLoaded,
  renderSupervisorPlist,
  supervisorAgentPath,
  type LaunchdDeps,
  type RenderSupervisorPlistOptions,
} from '../launchd.js';

type ExecFile = LaunchdDeps['execFile'];

const OPTIONS: RenderSupervisorPlistOptions = {
  nodePath: '/opt/homebrew/bin/node',
  supervisorBundle: '/Users/alice/.overdeck/runtime/node_modules/@overdeck/core/dist/supervisor/server.js',
  workingDirectory: '/Users/alice/.overdeck/runtime/node_modules/@overdeck/core',
  overdeckHome: '/Users/alice/.overdeck',
  supervisorPort: 3012,
  path: '/opt/homebrew/bin:/usr/bin:/bin',
  logPath: '/Users/alice/.overdeck/logs/supervisor.log',
};

const PLIST = '/Users/alice/Library/LaunchAgents/ai.overdeck.supervisor.plist';

/**
 * Fake launchctl: `loaded` is the domain the agent is loaded in (or null);
 * `refuse` lists domains whose bootstrap fails.
 */
function fakeDeps(state: { loaded: string | null; refuse?: string[]; files?: Map<string, string>; bootoutLag?: number }) {
  const files = state.files ?? new Map<string, string>();
  const execFile = vi.fn<ExecFile>(async (_file, args) => {
    const [verb, target] = args;
    if (verb === 'print') {
      const booted = execFile.mock.calls.some((call) => call[1][0] === 'bootout');
      if (booted && state.bootoutLag && state.loaded && target === `${state.loaded}/ai.overdeck.supervisor`) {
        state.bootoutLag -= 1;
        if (state.bootoutLag === 0) state.loaded = null;
        return { stdout: 'state = running', stderr: '' };
      }
      if (state.loaded && target === `${state.loaded}/ai.overdeck.supervisor`) return { stdout: 'state = running', stderr: '' };
      throw new Error('Could not find service');
    }
    if (verb === 'bootout') {
      // bootoutLag: launchd keeps the job for that many more `print` calls.
      if (!state.bootoutLag) state.loaded = null;
      return { stdout: '', stderr: '' };
    }
    if (verb === 'bootstrap') {
      if (state.loaded) throw new Error('Bootstrap failed: 5: Input/output error');
      if (state.refuse?.includes(String(target))) throw new Error('Bootstrap failed: 125: Domain does not support specified action');
      state.loaded = String(target);
      return { stdout: '', stderr: '' };
    }
    throw new Error(`unexpected launchctl ${verb}`);
  });
  const deps: LaunchdDeps = {
    execFile,
    readFile: vi.fn(async (path: string) => files.get(path) ?? null),
    writeFile: vi.fn(async (path: string, data: string) => {
      files.set(path, data);
    }),
    mkdir: vi.fn(async () => undefined),
    homedir: () => '/Users/alice',
    uid: () => 501,
    sleep: vi.fn(async () => undefined),
  };
  const writes = () => execFile.mock.calls.map((call) => call[1]).filter((args) => args[0] !== 'print');
  return { deps, files, execFile, writes };
}

describe('renderSupervisorPlist', () => {
  it('renders the supervisor agent with RunAtLoad and KeepAlive', () => {
    expect(renderSupervisorPlist(OPTIONS)).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0">
      <dict>
        <key>Label</key>
        <string>ai.overdeck.supervisor</string>
        <key>ProgramArguments</key>
        <array>
          <string>/opt/homebrew/bin/node</string>
          <string>/Users/alice/.overdeck/runtime/node_modules/@overdeck/core/dist/supervisor/server.js</string>
        </array>
        <key>WorkingDirectory</key>
        <string>/Users/alice/.overdeck/runtime/node_modules/@overdeck/core</string>
        <key>EnvironmentVariables</key>
        <dict>
          <key>OVERDECK_HOME</key>
          <string>/Users/alice/.overdeck</string>
          <key>OVERDECK_SUPERVISOR_PORT</key>
          <string>3012</string>
          <key>PATH</key>
          <string>/opt/homebrew/bin:/usr/bin:/bin</string>
        </dict>
        <key>RunAtLoad</key>
        <true/>
        <key>KeepAlive</key>
        <true/>
        <key>ThrottleInterval</key>
        <integer>5</integer>
        <key>StandardOutPath</key>
        <string>/Users/alice/.overdeck/logs/supervisor.log</string>
        <key>StandardErrorPath</key>
        <string>/Users/alice/.overdeck/logs/supervisor.log</string>
      </dict>
      </plist>
      "
    `);
  });

  it('XML-escapes every string', () => {
    const plist = renderSupervisorPlist({ ...OPTIONS, workingDirectory: `/Users/a&b/<x>/"q"/'s'` });
    expect(plist).toContain('<string>/Users/a&amp;b/&lt;x&gt;/&quot;q&quot;/&apos;s&apos;</string>');
  });

  it('places the plist in ~/Library/LaunchAgents', () => {
    expect(supervisorAgentPath('/Users/alice')).toBe(PLIST);
  });
});

describe('isSupervisorAgentLoaded', () => {
  it('reports the domain the agent is loaded in', async () => {
    await expect(isSupervisorAgentLoaded(fakeDeps({ loaded: 'user/501' }).deps)).resolves.toEqual({ loaded: true, domain: 'user/501' });
    await expect(isSupervisorAgentLoaded(fakeDeps({ loaded: null }).deps)).resolves.toEqual({ loaded: false, domain: null });
  });
});

describe('installSupervisorAgent', () => {
  it('writes the plist and bootstraps it into gui/<uid> on first install', async () => {
    const { deps, files, writes } = fakeDeps({ loaded: null });

    await expect(installSupervisorAgent(OPTIONS, deps)).resolves.toEqual({ path: PLIST, written: true, domain: 'gui/501' });
    expect(files.get(PLIST)).toBe(renderSupervisorPlist(OPTIONS));
    expect(deps.mkdir).toHaveBeenCalledWith('/Users/alice/Library/LaunchAgents');
    expect(deps.mkdir).toHaveBeenCalledWith('/Users/alice/.overdeck/logs');
    expect(writes()).toEqual([['bootstrap', 'gui/501', PLIST]]);
  });

  it('falls back to user/<uid> when gui/<uid> refuses the bootstrap', async () => {
    const { deps, writes } = fakeDeps({ loaded: null, refuse: ['gui/501'] });

    await expect(installSupervisorAgent(OPTIONS, deps)).resolves.toMatchObject({ domain: 'user/501' });
    expect(writes()).toEqual([
      ['bootstrap', 'gui/501', PLIST],
      ['bootstrap', 'user/501', PLIST],
    ]);
  });

  it('throws when neither domain accepts the bootstrap', async () => {
    const { deps } = fakeDeps({ loaded: null, refuse: ['gui/501', 'user/501'] });

    await expect(installSupervisorAgent(OPTIONS, deps)).rejects.toThrow(/Bootstrap failed/);
  });

  it('boots out a loaded agent before bootstrapping a changed plist', async () => {
    const files = new Map([[PLIST, 'old plist']]);
    const { deps, writes } = fakeDeps({ loaded: 'gui/501', files });

    await expect(installSupervisorAgent(OPTIONS, deps)).resolves.toEqual({ path: PLIST, written: true, domain: 'gui/501' });
    expect(writes()).toEqual([
      ['bootout', 'gui/501/ai.overdeck.supervisor'],
      ['bootstrap', 'gui/501', PLIST],
    ]);
  });

  it('waits for launchd to release the job after bootout before bootstrapping', async () => {
    const files = new Map([[PLIST, 'old plist']]);
    const { deps, writes } = fakeDeps({ loaded: 'gui/501', files, bootoutLag: 3 });

    await expect(installSupervisorAgent(OPTIONS, deps)).resolves.toEqual({ path: PLIST, written: true, domain: 'gui/501' });
    expect(deps.sleep).toHaveBeenCalledTimes(3);
    expect(deps.sleep).toHaveBeenCalledWith(250);
    expect(writes()).toEqual([
      ['bootout', 'gui/501/ai.overdeck.supervisor'],
      ['bootstrap', 'gui/501', PLIST],
    ]);
  });

  it('stops waiting after 20 polls and lets the bootstrap report the failure', async () => {
    const files = new Map([[PLIST, 'old plist']]);
    const { deps } = fakeDeps({ loaded: 'gui/501', files, bootoutLag: 1_000 });

    await expect(installSupervisorAgent(OPTIONS, deps)).rejects.toThrow(/Bootstrap failed: 5/);
    expect(deps.sleep).toHaveBeenCalledTimes(20);
  });

  it('does nothing to a loaded agent whose plist is unchanged', async () => {
    const files = new Map([[PLIST, renderSupervisorPlist(OPTIONS)]]);
    const { deps, writes } = fakeDeps({ loaded: 'user/501', files });

    await expect(installSupervisorAgent(OPTIONS, deps)).resolves.toEqual({ path: PLIST, written: false, domain: 'user/501' });
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });
});
