/**
 * PAN-4404 WI-2: SSH target helpers — destination grammar, the remote command
 * string, argv, failure classification, helper result parsing and SSH config
 * aliases.
 */
import { describe, expect, it } from 'vitest';

import {
  classifySshFailure,
  formatHelperResult,
  listSshConfigAliases,
  parseHelperResult,
  parseSshDestination,
  parseVersionOutput,
  remoteCommand,
  type SshConfigIo,
  SshMachineError,
  sshCommandArgv,
  sshForwardArgv,
  sshLockKey,
  validatePanPath,
  validateSshDestination,
} from '../target.js';

const LINKER = '0f8e4c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b';
const BASE = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'];

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof SshMachineError ? err.code : 'not-ssh-machine-error';
  }
  return undefined;
}

describe('validateSshDestination (D-4404-6)', () => {
  it.each(['desk', 'me@desk', 'me@10.0.0.4', 'ssh://me@desk:2222', '[fe80::1]', 'vps-1.example.com', 'ssh://desk'])(
    'accepts %s',
    (dest) => {
      expect(validateSshDestination(dest)).toBe(dest);
    },
  );

  it('trims surrounding whitespace', () => {
    expect(validateSshDestination('  desk \n')).toBe('desk');
  });

  it.each([
    '-oProxyCommand=x',
    'desk; rm',
    'desk host',
    '$(x)',
    'desk:22',
    `${'a'.repeat(256)}`,
    '',
    'me@-oProxyCommand',
    'ssh://desk:70000',
    'desk`id`',
    "desk'",
    'desk\nhost',
  ])('rejects %j with bad-destination', (dest) => {
    expect(codeOf(() => validateSshDestination(dest))).toBe('bad-destination');
  });
});

describe('parseSshDestination', () => {
  it.each([
    ['build-box', { host: 'build-box' }],
    ['root@build-box', { user: 'root', host: 'build-box' }],
    ['ssh://root@build-box', { user: 'root', host: 'build-box' }],
    ['ssh://root@build-box:2222', { user: 'root', host: 'build-box', port: 2222 }],
    ['ssh://build-box:2222', { host: 'build-box', port: 2222 }],
    ['[fd00::5]', { host: 'fd00::5' }],
    ['ssh://me@[fd00::5]:2200', { user: 'me', host: 'fd00::5', port: 2200 }],
    [' root@build-box ', { user: 'root', host: 'build-box' }],
  ] as const)('parses %j', (input, expected) => {
    expect(parseSshDestination(input)).toEqual(expected);
  });

  it.each(['build-box:2222', '-oProxyCommand=x', ''])('rejects %j with bad-destination', (input) => {
    expect(codeOf(() => parseSshDestination(input))).toBe('bad-destination');
  });
});

describe('sshLockKey', () => {
  it('lowercases and drops ssh://', () => {
    expect(sshLockKey('ssh://Me@Desk:2222')).toBe('me@desk:2222');
    expect(sshLockKey('Desk')).toBe(sshLockKey('desk'));
  });
});

describe('remoteCommand (D-4404-4)', () => {
  it('builds the version probe', () => {
    expect(remoteCommand({ pan: null, op: 'version' })).toBe(`sh -c 'exec "\${SHELL:-/bin/sh}" -lc "pan --version"'`);
  });

  it('builds the helper commands', () => {
    expect(remoteCommand({ pan: null, op: 'start', linker: LINKER })).toBe(
      `sh -c 'exec "\${SHELL:-/bin/sh}" -lc "pan machines ssh-helper start --linker ${LINKER} --json"'`,
    );
    expect(remoteCommand({ pan: '/opt/pan/bin/pan', op: 'start-no-pair', linker: LINKER })).toBe(
      `sh -c 'exec "\${SHELL:-/bin/sh}" -lc "/opt/pan/bin/pan machines ssh-helper start --linker ${LINKER} --no-pair --json"'`,
    );
    expect(remoteCommand({ pan: null, op: 'stop', linker: LINKER })).toBe(
      `sh -c 'exec "\${SHELL:-/bin/sh}" -lc "pan machines ssh-helper stop --linker ${LINKER} --json"'`,
    );
  });

  it('throws on a linker that is not an environment-id UUID', () => {
    expect(() => remoteCommand({ pan: null, op: 'start', linker: 'not-a-uuid' })).toThrow();
    expect(() => remoteCommand({ pan: null, op: 'stop', linker: `${LINKER}; rm -rf ~` })).toThrow();
    expect(() => remoteCommand({ pan: null, op: 'stop' })).toThrow();
  });

  it.each(['/opt/my pan', '/opt/pan"', "/opt/pan'", 'relative/pan', '/opt/$(x)', '/opt/pan;rm'])(
    'throws on pan path %j',
    (pan) => {
      expect(codeOf(() => remoteCommand({ pan, op: 'version' }))).toBe('bad-destination');
    },
  );

  it('lets only fixed tokens, a UUID and a validated path reach the string', () => {
    const cmd = remoteCommand({ pan: '/home/me/.local/bin/pan', op: 'start', linker: LINKER });
    const inner = /-lc "(.*)"'$/.exec(cmd)?.[1] ?? '';
    expect(inner).toMatch(/^[A-Za-z0-9._/ -]+$/);
  });

  it('validatePanPath returns a valid path unchanged', () => {
    expect(validatePanPath('/usr/local/bin/pan')).toBe('/usr/local/bin/pan');
  });
});

describe('argv (D-4404-5)', () => {
  it('builds a command argv with the destination after --', () => {
    expect(sshCommandArgv('desk', 'CMD')).toEqual(['-T', ...BASE, '--', 'desk', 'CMD']);
  });

  it('builds the forward argv exactly', () => {
    expect(sshForwardArgv('me@desk', 41234, 3011)).toEqual([
      ...BASE,
      '-N',
      '-o',
      'ExitOnForwardFailure=yes',
      '-L',
      '127.0.0.1:41234:127.0.0.1:3011',
      '--',
      'me@desk',
    ]);
  });

  it('refuses a bad destination or port', () => {
    expect(codeOf(() => sshCommandArgv('-oProxyCommand=x', 'CMD'))).toBe('bad-destination');
    expect(() => sshForwardArgv('desk', 0, 3011)).toThrow();
    expect(() => sshForwardArgv('desk', 41234, 70000)).toThrow();
  });
});

describe('classifySshFailure (D-4404-9)', () => {
  it.each([
    [255, 'Host key verification failed.', 'host-key'],
    [255, '@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@', 'host-key'],
    [255, 'me@desk: Permission denied (publickey).', 'auth-failed'],
    [255, 'ssh: Could not resolve hostname desk: Name or service not known', 'unresolvable'],
    [255, 'ssh: connect to host desk port 22: Connection refused', 'unreachable'],
    [255, 'ssh: connect to host desk port 22: Connection timed out', 'unreachable'],
    [255, 'ssh: connect to host desk port 22: No route to host', 'unreachable'],
    [255, 'ssh: connect to host desk port 22: Network is unreachable', 'unreachable'],
    [255, 'ssh: connect to host desk port 22: Operation timed out', 'unreachable'],
    [127, '', 'pan-missing'],
    [1, 'bash: pan: command not found', 'pan-missing'],
    [1, 'sh: 1: pan: not found', 'pan-missing'],
    [126, 'sh: 1: /opt/pan: Permission denied', 'helper-failed'],
    [1, 'something else broke', 'helper-failed'],
  ] as const)('exit %s / %j ⇒ %s', (exitCode, stderr, code) => {
    expect(classifySshFailure(exitCode, stderr).code).toBe(code);
  });

  it('keeps the last 5 stderr lines for helper-failed', () => {
    const stderr = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'].join('\n');
    const err = classifySshFailure(1, stderr, { destination: 'desk' });
    expect(err.detail.stderr).toBe('l3\nl4\nl5\nl6\nl7');
    expect(err.message).toContain('l7');
    expect(err.message).not.toContain('l2');
  });

  it('names the install command for pan-missing and the ssh command for host-key', () => {
    expect(classifySshFailure(127, '', { destination: 'desk', localVersion: '0.72.0' }).message).toContain(
      'npm install -g @overdeck/core@0.72.0',
    );
    expect(classifySshFailure(255, 'Host key verification failed.', { destination: 'desk' }).message).toContain('ssh desk');
  });
});

describe('helper result line', () => {
  const start = {
    v: 1,
    ok: true,
    op: 'start',
    launch: 'managed',
    apiPort: 3011,
    environmentId: LINKER,
    label: 'desk',
    serverVersion: '0.72.0',
    panVersion: '0.72.0',
    pairing: { credential: 'odp_x', expiresAt: '2026-11-01T00:10:00.000Z' },
  } as const;

  it('ignores banners and returns the last sentinel line', () => {
    const stdout = [
      'Welcome to Ubuntu',
      'OVERDECK_SSH_HELPER {"v":1,"ok":false,"error":"busy","message":"first"}',
      'motd noise',
      formatHelperResult(start),
      'trailing profile output',
    ].join('\n');
    expect(parseHelperResult(stdout)).toEqual(start);
  });

  it('returns null without a sentinel line, on bad JSON or on another protocol version', () => {
    expect(parseHelperResult('hello\nworld')).toBeNull();
    expect(parseHelperResult('OVERDECK_SSH_HELPER {nope')).toBeNull();
    expect(parseHelperResult(`OVERDECK_SSH_HELPER ${JSON.stringify({ ...start, v: 2 })}`)).toBeNull();
  });

  it('parses stop and failure lines', () => {
    const stop = { v: 1, ok: true, op: 'stop', stopped: false, reason: 'in-use' } as const;
    expect(parseHelperResult(formatHelperResult(stop))).toEqual(stop);
    const failure = { v: 1, ok: false, error: 'busy', message: 'try again' } as const;
    expect(parseHelperResult(formatHelperResult(failure))).toEqual(failure);
    expect(parseHelperResult(formatHelperResult({ ...stop, reason: 'bogus' as never }))).toBeNull();
  });
});

describe('parseVersionOutput (D-4404-2)', () => {
  it('takes the last bare semver line', () => {
    expect(parseVersionOutput('Welcome!\nUpdate available: 0.73.0 -> run npm i\n0.72.0\n')).toBe('0.72.0');
    expect(parseVersionOutput('0.72.0-canary.3')).toBe('0.72.0-canary.3');
  });

  it('returns null without a version line', () => {
    expect(parseVersionOutput('pan 0.72.0\n')).toBeNull();
  });
});

describe('listSshConfigAliases (FR-10)', () => {
  function io(files: Record<string, string>): SshConfigIo {
    return {
      readFile: async (path) => {
        const text = files[path];
        if (text === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return text;
      },
      readdir: async (dir) => {
        const prefix = `${dir}/`;
        const names = Object.keys(files)
          .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
          .map((p) => p.slice(prefix.length));
        if (names.length === 0) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return names;
      },
    };
  }

  it('skips wildcard and negated hosts and follows an Include glob', async () => {
    const files = {
      '/home/me/.ssh/config': [
        '# comment',
        'Include config.d/*',
        'Host desk lab',
        '  User me',
        'Host *.internal !bastion gpu?',
        'Host *',
        '  ServerAliveInterval 30',
        'Host=vps',
      ].join('\n'),
      '/home/me/.ssh/config.d/work': 'Host build-box\nHost desk\n',
      '/home/me/.ssh/config.d/other': 'Host "quoted-host"\n',
    };
    expect(await listSshConfigAliases(io(files), '/home/me')).toEqual(['build-box', 'desk', 'lab', 'quoted-host', 'vps']);
  });

  it('gives [] for a missing config file', async () => {
    expect(await listSshConfigAliases(io({}), '/home/me')).toEqual([]);
  });

  it('stops following Include beyond depth 3', async () => {
    const files = {
      '/home/me/.ssh/config': 'Include a\nHost d0',
      '/home/me/.ssh/a': 'Include b\nHost d1',
      '/home/me/.ssh/b': 'Include c\nHost d2',
      '/home/me/.ssh/c': 'Include d\nHost d3',
      '/home/me/.ssh/d': 'Host d4',
    };
    expect(await listSshConfigAliases(io(files), '/home/me')).toEqual(['d0', 'd1', 'd2', 'd3']);
  });
});
