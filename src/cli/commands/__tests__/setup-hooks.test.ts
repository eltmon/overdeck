import { describe, expect, it } from 'vitest';

import {
  addPanopticonHookIfMissing,
  type ClaudeSettings,
} from '../setup/hooks.js';

describe('setup hooks', () => {
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
