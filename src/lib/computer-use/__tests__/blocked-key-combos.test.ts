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

  it('has a rule table for every key platform, so none fails closed', () => {
    for (const platform of ['linux', 'windows', 'mac'] as const) {
      expect(() => assertKeyComboAllowed('ctrl+a', false, platform)).not.toThrow();
    }
  });
});

describe('assertKeyComboAllowed on windows (PAN-5462 D-8)', () => {
  function windowsError(key: string, allowSystemShortcut = false): unknown {
    try {
      assertKeyComboAllowed(key, allowSystemShortcut, 'windows');
      return null;
    } catch (error) {
      return error;
    }
  }

  it.each([
    ['alt+f4', 'close the app'],
    ['win+l', 'lock Windows'],
    ['cmd+l', 'lock Windows'],
    ['super+l', 'lock Windows'],
    ['ctrl+shift+esc', 'open Task Manager'],
  ])('blocks %s and names the effect (ac1)', (key, effect) => {
    const error = windowsError(key);
    expect(isComputerUseError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('system_shortcut_blocked');
    expect((error as Error).message).toContain(`would ${effect}`);
  });

  it('accepts ctrl+q, which Windows apps handle themselves (ac2)', () => {
    expect(windowsError('ctrl+q')).toBeNull();
  });

  it('still rejects alt+f4 and ctrl+q on linux (ac3)', () => {
    expect(() => assertKeyComboAllowed('alt+f4', false, 'linux')).toThrow(/close the window/);
    expect(() => assertKeyComboAllowed('ctrl+q', false, 'linux')).toThrow(/quit the app/);
  });

  it('accepts alt+f4 when allowSystemShortcut is true (ac4)', () => {
    expect(windowsError('alt+f4', true)).toBeNull();
  });
});

describe('assertKeyComboAllowed on macOS (PAN-5463 D-10)', () => {
  function macError(key: string, allow = false): unknown {
    try {
      assertKeyComboAllowed(key, allow, 'mac');
      return null;
    } catch (error) {
      return error;
    }
  }

  it.each([
    ['cmd+q', 'quit the app'],
    ['cmd+ctrl+q', 'lock the screen'],
    ['cmd+shift+q', 'log out of macOS'],
    ['command+option+esc', 'open the Force Quit window'],
    ['meta+alt+escape', 'open the Force Quit window'],
    ['cmd+shift+delete', 'empty the Trash'],
    ['CmdOrCtrl+Shift+Backspace', 'empty the Trash'],
    ['cmd+alt+shift+q', 'log out of macOS'],
  ])('blocks %s as "%s"', (key, effect) => {
    const error = macError(key);
    expect(isComputerUseError(error) && error.code).toBe('system_shortcut_blocked');
    expect((error as Error).message).toContain(`would ${effect}`);
  });

  it.each(['cmd+a', 'cmd+c', 'ctrl+q', 'cmd+shift+p', 'Return'])('allows %s', (key) => {
    expect(macError(key)).toBeNull();
  });

  it('allows a blocked combo with allowSystemShortcut, while Linux rules still block theirs', () => {
    expect(macError('cmd+shift+q', true)).toBeNull();
    expect(() => assertKeyComboAllowed('ctrl+alt+delete', false, 'linux')).toThrow(/log out and power off/);
  });
});
