import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addOverdeckHookIfMissing,
  parseHookHarness,
  pruneLegacyPanopticonHook,
  setupHooksCommand,
  type ClaudeSettings,
} from '../setup/hooks.js';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn((command: string, args?: readonly string[], options?: unknown) => {
      if (command === 'jq') return Buffer.from('jq-1.7');
      return actual.execFileSync(command, args, options as never);
    }),
  };
});

describe('setup hooks', () => {
  const originalHome = process.env.HOME;

  it('parses hook harness choices', () => {
    expect(parseHookHarness(undefined)).toBeUndefined();
    expect(parseHookHarness('claude-code')).toBe('claude-code');
    expect(parseHookHarness('pi')).toBe('pi');
    expect(parseHookHarness('both')).toBe('both');
    expect(() => parseHookHarness('bogus')).toThrow('Invalid harness');
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  it('adds the PermissionRequest hook once', () => {
    const settings: ClaudeSettings = {};

    const first = addOverdeckHookIfMissing(
      settings,
      'PermissionRequest',
      '/home/user/.overdeck/bin',
      'permission-event-hook',
    );
    const second = addOverdeckHookIfMissing(
      settings,
      'PermissionRequest',
      '/home/user/.overdeck/bin',
      'permission-event-hook',
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(settings.hooks?.PermissionRequest).toEqual([
      {
        matcher: '.*',
        hooks: [{ type: 'command', command: '/home/user/.overdeck/bin/permission-event-hook' }],
      },
    ]);
  });

  it.each([
    ['PreToolUse', 'pre-tool-hook', '.*'],
    ['PostToolUse', 'heartbeat-hook', '.*'],
    ['PostToolUse', 'permission-event-hook', '.*'],
    ['Stop', 'stop-hook', '.*'],
    ['Stop', 'permission-event-hook', '.*'],
    ['PreToolUse', 'gh-issue-trailer-hook', 'Bash'],
    ['PreToolUse', 'ask-user-question-hook', 'AskUserQuestion'],
    ['PreToolUse', 'tldr-read-enforcer', 'Read'],
    ['PostToolUse', 'tldr-post-edit', 'Edit|Write'],
  ] as const)('adds restored tool-event hook %s:%s once', (hookType, scriptName, matcher) => {
    const settings: ClaudeSettings = {};

    const first = addOverdeckHookIfMissing(
      settings,
      hookType,
      '/home/user/.overdeck/bin',
      scriptName,
      matcher,
    );
    const second = addOverdeckHookIfMissing(
      settings,
      hookType,
      '/home/user/.overdeck/bin',
      scriptName,
      matcher,
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(settings.hooks?.[hookType]).toEqual([
      {
        matcher,
        hooks: [{ type: 'command', command: `/home/user/.overdeck/bin/${scriptName}` }],
      },
    ]);
  });

  it('registers restored tool-event hooks globally during setup', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pan-setup-hooks-'));
    process.env.HOME = home;

    try {
      await setupHooksCommand({ harness: 'claude-code' });

      const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')) as ClaudeSettings;
      expect(settings.hooks?.PreToolUse).toEqual(expect.arrayContaining([
        {
          matcher: '.*',
          hooks: [{ type: 'command', command: join(home, '.overdeck', 'bin', 'pre-tool-hook') }],
        },
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: join(home, '.overdeck', 'bin', 'gh-issue-trailer-hook') }],
        },
        {
          matcher: 'AskUserQuestion',
          hooks: [{ type: 'command', command: join(home, '.overdeck', 'bin', 'ask-user-question-hook') }],
        },
      ]));
      expect(settings.hooks?.PostToolUse).toEqual(expect.arrayContaining([
        {
          matcher: '.*',
          hooks: [{ type: 'command', command: join(home, '.overdeck', 'bin', 'heartbeat-hook') }],
        },
        {
          matcher: '.*',
          hooks: [{ type: 'command', command: join(home, '.overdeck', 'bin', 'permission-event-hook') }],
        },
      ]));
      expect(settings.hooks?.Stop).toEqual(expect.arrayContaining([
        {
          matcher: '.*',
          hooks: [{ type: 'command', command: join(home, '.overdeck', 'bin', 'stop-hook') }],
        },
        {
          matcher: '.*',
          hooks: [{ type: 'command', command: join(home, '.overdeck', 'bin', 'permission-event-hook') }],
        },
      ]));
      if (settings.hooks?.PreToolUse?.some((entry) => entry.hooks.some((hook) => hook.command.endsWith('/tldr-read-enforcer')))) {
        expect(settings.hooks.PreToolUse).toEqual(expect.arrayContaining([
          {
            matcher: 'Read',
            hooks: [{ type: 'command', command: join(home, '.overdeck', 'bin', 'tldr-read-enforcer') }],
          },
        ]));
        expect(settings.hooks?.PostToolUse).toEqual(expect.arrayContaining([
          {
            matcher: 'Edit|Write',
            hooks: [{ type: 'command', command: join(home, '.overdeck', 'bin', 'tldr-post-edit') }],
          },
        ]));
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('treats legacy overdeck/bin hook commands as already configured', () => {
    const settings: ClaudeSettings = {
      hooks: {
        PermissionRequest: [
          {
            matcher: '.*',
            hooks: [{ type: 'command', command: '$HOME/.overdeck/bin/permission-event-hook' }],
          },
        ],
      },
    };

    const added = addOverdeckHookIfMissing(
      settings,
      'PermissionRequest',
      '/home/user/.overdeck/bin',
      'permission-event-hook',
    );

    expect(added).toBe(false);
    expect(settings.hooks?.PermissionRequest).toHaveLength(1);
  });

  // PAN-2530: a re-sync after the PAN-1952 rebrand left the old
  // panopticon/bin/<script> hook registered alongside the new overdeck/bin one,
  // so ask-user-question-hook fired twice (one copy still branded "Panopticon").
  it('prunes a stale panopticon/bin twin when installing the overdeck/bin hook', () => {
    const settings: ClaudeSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'AskUserQuestion',
            hooks: [{ type: 'command', command: '/home/user/.panopticon/bin/ask-user-question-hook' }],
          },
        ],
      },
    };

    const added = addOverdeckHookIfMissing(
      settings,
      'PreToolUse',
      '/home/user/.overdeck/bin',
      'ask-user-question-hook',
      'AskUserQuestion',
    );

    // The legacy twin is gone and exactly one hook — the overdeck/bin one — remains.
    expect(added).toBe(true);
    expect(settings.hooks?.PreToolUse).toEqual([
      {
        matcher: 'AskUserQuestion',
        hooks: [{ type: 'command', command: '/home/user/.overdeck/bin/ask-user-question-hook' }],
      },
    ]);
  });

  it('pruneLegacyPanopticonHook removes only the matching legacy script and leaves others intact', () => {
    const settings: ClaudeSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'AskUserQuestion',
            hooks: [{ type: 'command', command: '$HOME/.panopticon/bin/ask-user-question-hook' }],
          },
          {
            matcher: '.*',
            hooks: [{ type: 'command', command: '$HOME/.overdeck/bin/pre-tool-hook' }],
          },
        ],
      },
    };

    const first = pruneLegacyPanopticonHook(settings, 'PreToolUse', 'ask-user-question-hook');
    const second = pruneLegacyPanopticonHook(settings, 'PreToolUse', 'ask-user-question-hook');

    expect(first).toBe(true);
    expect(second).toBe(false); // idempotent — nothing left to prune
    expect(settings.hooks?.PreToolUse).toEqual([
      {
        matcher: '.*',
        hooks: [{ type: 'command', command: '$HOME/.overdeck/bin/pre-tool-hook' }],
      },
    ]);
  });
});
