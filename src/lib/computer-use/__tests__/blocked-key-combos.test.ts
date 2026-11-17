import { describe, expect, it } from 'vitest';

import { assertKeyComboAllowed } from '../blocked-key-combos.js';
import { isComputerUseError } from '../errors.js';

function thrown(key: string, allowSystemShortcut: boolean): unknown {
  try {
    assertKeyComboAllowed(key, allowSystemShortcut);
    return null;
  } catch (error) {
    return error;
  }
}

describe('assertKeyComboAllowed (PAN-5452)', () => {
  it.each(['alt+F4', 'ctrl+alt+F2', 'super+l', 'CmdOrCtrl+Q', 'ctrl+alt+BackSpace', '0xff'])(
    'blocks %s (ac1)',
    (key) => {
      const error = thrown(key, false);
      expect(isComputerUseError(error)).toBe(true);
      expect((error as { code: string }).code).toBe('system_shortcut_blocked');
    },
  );

  it.each(['ctrl+a', 'ctrl+shift+p', 'Return'])('allows %s (ac2)', (key) => {
    expect(thrown(key, false)).toBeNull();
  });

  it('allows a blocked combo when allowSystemShortcut is true (ac3)', () => {
    expect(thrown('alt+F4', true)).toBeNull();
  });

  it.each(['Alt_L+F4', 'Control_L+q', 'Super_L+l', 'Alt_R+F4'])(
    'blocks X11 side-suffixed modifier names like %s',
    (key) => {
      const error = thrown(key, false);
      expect(isComputerUseError(error)).toBe(true);
      expect((error as { code: string }).code).toBe('system_shortcut_blocked');
    },
  );

  it('names the effect and the bypass flag in the error message', () => {
    const error = thrown('alt+F4', false) as Error;
    expect(error.message).toBe(
      "'alt+F4' would close the window, so computer use refuses it unless you pass --allow-system-shortcut",
    );
  });
});

describe('assertKeyComboAllowed platform (PAN-5461 D-16)', () => {
  it('applies the Linux rules when the platform is linux', () => {
    expect(() => assertKeyComboAllowed('alt+F4', false, 'linux')).toThrow(/close the window/);
    expect(() => assertKeyComboAllowed('ctrl+a', false, 'linux')).not.toThrow();
  });

  it.each(['windows', 'mac'] as const)('fails closed for %s even with allowSystemShortcut', (platform) => {
    for (const allow of [false, true]) {
      let error: unknown = null;
      try {
        assertKeyComboAllowed('ctrl+a', allow, platform);
      } catch (caught) {
        error = caught;
      }
      expect(isComputerUseError(error)).toBe(true);
      expect((error as { code: string }).code).toBe('unsupported_platform');
      expect((error as Error).message).toBe(`No blocked-shortcut rules for ${platform} yet.`);
    }
  });
});
