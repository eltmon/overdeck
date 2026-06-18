import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  addOverdeckHookIfMissing,
  parseHookHarness,
  setupHooksCommand,
  type ClaudeSettings,
} from '../setup/hooks.js';

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
});
