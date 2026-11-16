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

  it('names the effect and the bypass flag in the error message', () => {
    const error = thrown('alt+F4', false) as Error;
    expect(error.message).toBe(
      "'alt+F4' would close the window, so computer use refuses it unless you pass --allow-system-shortcut",
    );
  });
});
