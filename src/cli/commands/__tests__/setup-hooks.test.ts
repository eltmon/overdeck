import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  addPanopticonHookIfMissing,
  setupHooksCommand,
  type ClaudeSettings,
} from '../setup/hooks.js';

describe('setup hooks', () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  it('adds the PermissionRequest hook once', () => {
    const settings: ClaudeSettings = {};

    const first = addPanopticonHookIfMissing(
      settings,
      'PermissionRequest',
      '/home/user/.panopticon/bin',
      'permission-event-hook',
    );
    const second = addPanopticonHookIfMissing(
      settings,
      'PermissionRequest',
      '/home/user/.panopticon/bin',
      'permission-event-hook',
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(settings.hooks?.PermissionRequest).toEqual([
      {
        matcher: '.*',
        hooks: [{ type: 'command', command: '/home/user/.panopticon/bin/permission-event-hook' }],
      },
    ]);
  });

  it.each([
    ['PreToolUse', 'pre-tool-hook', '.*'],
    ['PostToolUse', 'heartbeat-hook', '.*'],
    ['PostToolUse', 'permission-event-hook', '.*'],
    ['Stop', 'stop-hook', '.*'],
    ['Stop', 'permission-event-hook', '.*'],
    ['PreToolUse', 'tldr-read-enforcer', 'Read'],
    ['PostToolUse', 'tldr-post-edit', 'Edit|Write'],
  ] as const)('adds restored tool-event hook %s:%s once', (hookType, scriptName, matcher) => {
    const settings: ClaudeSettings = {};

    const first = addPanopticonHookIfMissing(
      settings,
      hookType,
      '/home/user/.panopticon/bin',
      scriptName,
      matcher,
    );
    const second = addPanopticonHookIfMissing(
      settings,
      hookType,
      '/home/user/.panopticon/bin',
      scriptName,
      matcher,
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(settings.hooks?.[hookType]).toEqual([
      {
        matcher,
        hooks: [{ type: 'command', command: `/home/user/.panopticon/bin/${scriptName}` }],
      },
    ]);
  });

  it('registers restored tool-event hooks globally during setup', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pan-setup-hooks-'));
    process.env.HOME = home;

    try {
      await setupHooksCommand();

      const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')) as ClaudeSettings;
      expect(settings.hooks?.PreToolUse).toEqual(expect.arrayContaining([
        {
          matcher: '.*',
          hooks: [{ type: 'command', command: join(home, '.panopticon', 'bin', 'pre-tool-hook') }],
        },
      ]));
      expect(settings.hooks?.PostToolUse).toEqual(expect.arrayContaining([
        {
          matcher: '.*',
          hooks: [{ type: 'command', command: join(home, '.panopticon', 'bin', 'heartbeat-hook') }],
        },
        {
          matcher: '.*',
          hooks: [{ type: 'command', command: join(home, '.panopticon', 'bin', 'permission-event-hook') }],
        },
      ]));
      expect(settings.hooks?.Stop).toEqual(expect.arrayContaining([
        {
          matcher: '.*',
          hooks: [{ type: 'command', command: join(home, '.panopticon', 'bin', 'stop-hook') }],
        },
        {
          matcher: '.*',
          hooks: [{ type: 'command', command: join(home, '.panopticon', 'bin', 'permission-event-hook') }],
        },
      ]));
      if (settings.hooks?.PreToolUse?.some((entry) => entry.hooks.some((hook) => hook.command.endsWith('/tldr-read-enforcer')))) {
        expect(settings.hooks.PreToolUse).toEqual(expect.arrayContaining([
          {
            matcher: 'Read',
            hooks: [{ type: 'command', command: join(home, '.panopticon', 'bin', 'tldr-read-enforcer') }],
          },
        ]));
        expect(settings.hooks?.PostToolUse).toEqual(expect.arrayContaining([
          {
            matcher: 'Edit|Write',
            hooks: [{ type: 'command', command: join(home, '.panopticon', 'bin', 'tldr-post-edit') }],
          },
        ]));
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('treats legacy panopticon/bin hook commands as already configured', () => {
    const settings: ClaudeSettings = {
      hooks: {
        PermissionRequest: [
          {
            matcher: '.*',
            hooks: [{ type: 'command', command: '$HOME/.panopticon/bin/permission-event-hook' }],
          },
        ],
      },
    };

    const added = addPanopticonHookIfMissing(
      settings,
      'PermissionRequest',
      '/home/user/.panopticon/bin',
      'permission-event-hook',
    );

    expect(added).toBe(false);
    expect(settings.hooks?.PermissionRequest).toHaveLength(1);
  });
});
