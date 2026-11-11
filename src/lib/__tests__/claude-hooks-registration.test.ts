import { describe, expect, it } from 'vitest';
import { isAutoApproveHookRegistered, type ClaudeSettings } from '../claude-hooks-registration.js';

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
