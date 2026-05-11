import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildClaudeUserSettings,
  bypassPrefixForAgentFlag,
  getClaudePermissionFlags,
  getClaudePermissionFlagsString,
  readYoloEnv,
  resolvePermissionMode,
} from '../claude-permissions.js';

const ORIGINAL_YOLO = process.env.PAN_YOLO;

describe('claude-permissions', () => {
  beforeEach(() => {
    delete process.env.PAN_YOLO;
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_YOLO === undefined) delete process.env.PAN_YOLO;
    else process.env.PAN_YOLO = ORIGINAL_YOLO;
  });

  describe('readYoloEnv', () => {
    it('returns undefined when PAN_YOLO is unset', () => {
      expect(readYoloEnv({})).toBeUndefined();
    });

    it.each(['1', 'true', 'yes', 'YES', 'on', ' True '])('parses "%s" as bypass', (raw) => {
      expect(readYoloEnv({ PAN_YOLO: raw })).toBe('bypass');
    });

    it.each(['0', 'false', 'no', 'NO', 'off'])('parses "%s" as auto', (raw) => {
      expect(readYoloEnv({ PAN_YOLO: raw })).toBe('auto');
    });

    it('returns undefined for unparseable values', () => {
      expect(readYoloEnv({ PAN_YOLO: 'maybe' })).toBeUndefined();
    });
  });

  describe('getClaudePermissionFlags', () => {
    it('returns auto flags for explicit auto mode', () => {
      expect(getClaudePermissionFlags('auto')).toEqual(['--permission-mode', 'auto']);
    });

    it('returns bypass flags for explicit bypass mode', () => {
      expect(getClaudePermissionFlags('bypass')).toEqual([
        '--dangerously-skip-permissions',
        '--permission-mode',
        'bypassPermissions',
      ]);
    });

    it('joins the array as a single string for shell construction', () => {
      expect(getClaudePermissionFlagsString('auto')).toBe('--permission-mode auto');
      expect(getClaudePermissionFlagsString('bypass')).toBe(
        '--dangerously-skip-permissions --permission-mode bypassPermissions',
      );
    });
  });

  describe('bypassPrefixForAgentFlag', () => {
    it('returns empty string under auto', () => {
      expect(bypassPrefixForAgentFlag('auto')).toBe('');
    });

    it('returns leading-space DSP under bypass', () => {
      expect(bypassPrefixForAgentFlag('bypass')).toBe(' --dangerously-skip-permissions');
    });

    it('honors PAN_YOLO=false even with no explicit arg', () => {
      process.env.PAN_YOLO = 'false';
      expect(bypassPrefixForAgentFlag()).toBe('');
    });

    it('honors PAN_YOLO=true even with no explicit arg', () => {
      process.env.PAN_YOLO = 'true';
      expect(bypassPrefixForAgentFlag()).toBe(' --dangerously-skip-permissions');
    });
  });

  describe('buildClaudeUserSettings — remote settings.json must NEVER hardcode bypass under auto', () => {
    // CRITICAL trust property (counterpart to the spawn-flag invariant):
    // ~/.claude/settings.json's permissions.defaultMode is what claude falls back
    // to when an invocation omits --permission-mode. If we write 'bypassPermissions'
    // here on a remote Fly VM while the user has chosen Auto, every unflagged
    // claude invocation on that VM (interactive shell, future helper script,
    // forgotten spawn site) silently runs in bypass — a P0 trust violation.

    it('emits defaultMode "default" under auto', () => {
      expect(buildClaudeUserSettings('auto')).toEqual({
        theme: 'dark',
        permissions: { defaultMode: 'default' },
      });
    });

    it('emits defaultMode "bypassPermissions" under bypass', () => {
      expect(buildClaudeUserSettings('bypass')).toEqual({
        theme: 'dark',
        permissions: { defaultMode: 'bypassPermissions' },
      });
    });

    it('honors PAN_YOLO=false → default', () => {
      process.env.PAN_YOLO = 'false';
      expect(buildClaudeUserSettings()).toEqual({
        theme: 'dark',
        permissions: { defaultMode: 'default' },
      });
    });

    it('honors PAN_YOLO=true → bypassPermissions', () => {
      process.env.PAN_YOLO = 'true';
      expect(buildClaudeUserSettings()).toEqual({
        theme: 'dark',
        permissions: { defaultMode: 'bypassPermissions' },
      });
    });

    it('JSON serialization under auto does NOT contain the bypass token', () => {
      process.env.PAN_YOLO = 'false';
      const json = JSON.stringify(buildClaudeUserSettings());
      expect(json).not.toMatch(/bypassPermissions/);
      expect(json).not.toMatch(/dangerously-skip-permissions/);
    });
  });

  describe('resolvePermissionMode precedence', () => {
    it('PAN_YOLO env wins over the explicit argument', () => {
      process.env.PAN_YOLO = 'false';
      expect(resolvePermissionMode('bypass')).toBe('auto');
    });

    it('PAN_YOLO env wins over config when no explicit argument is passed', () => {
      process.env.PAN_YOLO = 'true';
      expect(resolvePermissionMode()).toBe('bypass');
    });

    it('falls back to the explicit argument when env is unset', () => {
      expect(resolvePermissionMode('bypass')).toBe('bypass');
    });
  });
});
