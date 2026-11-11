import { describe, expect, it } from 'vitest';
import { addOverdeckHookIfMissing, isAutoApproveHookRegistered, type ClaudeSettings } from '../claude-hooks-registration.js';

const BIN_DIR = '/home/op/.overdeck/bin';

describe('isAutoApproveHookRegistered (PAN-5151)', () => {
  it('returns true when the hook is registered with the all-tools matcher', () => {
    const settings: ClaudeSettings = {
      hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: `${BIN_DIR}/auto-approve-hook` }] }] },
    };

    expect(isAutoApproveHookRegistered(settings, BIN_DIR)).toBe(true);
  });

  it('returns false when the command matches but the matcher is scoped to one tool (e.g. Bash)', () => {
    const settings: ClaudeSettings = {
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `${BIN_DIR}/auto-approve-hook` }] }] },
    };

    expect(isAutoApproveHookRegistered(settings, BIN_DIR)).toBe(false);
  });

  it('returns false when no PreToolUse hook references auto-approve-hook', () => {
    const settings: ClaudeSettings = {
      hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: `${BIN_DIR}/stop-hook` }] }] },
    };

    expect(isAutoApproveHookRegistered(settings, BIN_DIR)).toBe(false);
  });

  it('returns false for empty or missing settings', () => {
    expect(isAutoApproveHookRegistered({}, BIN_DIR)).toBe(false);
  });
});

describe('addOverdeckHookIfMissing widens a narrow auto-approve-hook matcher (PAN-5151)', () => {
  it('widens an existing Bash-scoped registration to .* instead of reporting "already configured"', () => {
    const settings: ClaudeSettings = {
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `${BIN_DIR}/auto-approve-hook` }] }] },
    };

    const changed = addOverdeckHookIfMissing(settings, 'PreToolUse', BIN_DIR, 'auto-approve-hook');

    expect(changed).toBe(true);
    expect(settings.hooks!.PreToolUse).toHaveLength(1);
    expect(isAutoApproveHookRegistered(settings, BIN_DIR)).toBe(true);
  });

  it('moves auto-approve-hook into its own .* group without widening a sibling hook that shares the narrow group', () => {
    const settings: ClaudeSettings = {
      hooks: {
        PreToolUse: [{
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: `${BIN_DIR}/auto-approve-hook` },
            { type: 'command', command: `${BIN_DIR}/tmux-send-keys-guard` },
          ],
        }],
      },
    };

    const changed = addOverdeckHookIfMissing(settings, 'PreToolUse', BIN_DIR, 'auto-approve-hook');

    expect(changed).toBe(true);
    expect(isAutoApproveHookRegistered(settings, BIN_DIR)).toBe(true);
    const bashGroup = settings.hooks!.PreToolUse!.find((g) => g.matcher === 'Bash');
    expect(bashGroup?.hooks).toEqual([{ type: 'command', command: `${BIN_DIR}/tmux-send-keys-guard` }]);
  });

  it('does not touch a narrow-matcher registration for a different hook', () => {
    const settings: ClaudeSettings = {
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `${BIN_DIR}/gh-issue-trailer-hook` }] }] },
    };

    const changed = addOverdeckHookIfMissing(settings, 'PreToolUse', BIN_DIR, 'gh-issue-trailer-hook', 'Bash');

    expect(changed).toBe(false);
    expect(settings.hooks!.PreToolUse![0]!.matcher).toBe('Bash');
  });

  it('is a no-op when auto-approve-hook is already registered with .*', () => {
    const settings: ClaudeSettings = {
      hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: `${BIN_DIR}/auto-approve-hook` }] }] },
    };

    const changed = addOverdeckHookIfMissing(settings, 'PreToolUse', BIN_DIR, 'auto-approve-hook');

    expect(changed).toBe(false);
  });
});
