import { describe, expect, it } from 'vitest';
import { checkClaudePermissionMode } from '../doctor-permission-mode.js';

const BIN_DIR = '/home/op/.overdeck/bin';

function registeredSettingsText(): string {
  return JSON.stringify({
    hooks: { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: `${BIN_DIR}/auto-approve-hook` }] }] },
  });
}

describe('checkClaudePermissionMode (PAN-5151)', () => {
  it('returns ok under bypass regardless of settings', () => {
    const result = checkClaudePermissionMode({
      mode: 'bypass',
      settingsText: null,
      binDir: BIN_DIR,
      hookFileExists: false,
    });

    expect(result).toEqual({
      name: 'Claude Permission Mode',
      status: 'ok',
      message: 'bypass — tool calls are not gated; the auto-approve hook is not needed',
    });
  });

  it('returns ok under auto when the hook is registered and the script exists', () => {
    const result = checkClaudePermissionMode({
      mode: 'auto',
      settingsText: registeredSettingsText(),
      binDir: BIN_DIR,
      hookFileExists: true,
    });

    expect(result.status).toBe('ok');
    expect(result.name).toBe('Claude Permission Mode');
    expect(result.message).toContain('auto — auto-approve hook registered');
  });

  it('returns error under auto with no auto-approve-hook entry in settings.json, naming pan sync', () => {
    const result = checkClaudePermissionMode({
      mode: 'auto',
      settingsText: JSON.stringify({ hooks: {} }),
      binDir: BIN_DIR,
      hookFileExists: true,
    });

    expect(result.status).toBe('error');
    expect(result.name).toBe('Claude Permission Mode');
    expect(result.fix).toContain('pan sync');
  });

  it('returns error under auto with unparseable settings JSON', () => {
    const result = checkClaudePermissionMode({
      mode: 'auto',
      settingsText: '{not json',
      binDir: BIN_DIR,
      hookFileExists: true,
    });

    expect(result.status).toBe('error');
  });

  it('returns error under auto when the settings file is missing', () => {
    const result = checkClaudePermissionMode({
      mode: 'auto',
      settingsText: null,
      binDir: BIN_DIR,
      hookFileExists: true,
    });

    expect(result.status).toBe('error');
  });

  it('returns error under auto when registered but the hook script is missing from disk', () => {
    const result = checkClaudePermissionMode({
      mode: 'auto',
      settingsText: registeredSettingsText(),
      binDir: BIN_DIR,
      hookFileExists: false,
    });

    expect(result.status).toBe('error');
  });
});
