// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)
// upstream: src/main/computer/action-contracts/computer-blocked-key-combos.ts @ c6b9ac9549b
// Design ported from vercel-labs/agent-desktop's per-platform blocked_combo lists (Apache-2.0).
//
// Linux, Windows and macOS slices of Orca's blocked-shortcut port (PAN-5452 D-7,
// PAN-5462 D-8, PAN-5463 D-10). The platform argument selects the table
// (PAN-5461 D-16).
import { ComputerUseError } from './errors.js';
import type { KeyPlatform } from './platform-types.js';

interface BlockedKeyCombo {
  modifiers: readonly string[];
  keys: readonly string[];
  effect: string;
}

interface PlatformKeyRules {
  modifierAliases: Readonly<Record<string, string>>;
  keyAliases: Readonly<Record<string, string>>;
  canonicalKey?: (key: string) => string;
  // Most specific first so the error names what the combo would actually do.
  blocked: readonly BlockedKeyCombo[];
}

const SHARED_KEY_ALIASES = { esc: 'escape' };

// Aliases mirror how each provider maps modifier names to physical keys.
const MACOS_RULES: PlatformKeyRules = {
  modifierAliases: {
    cmd: 'cmd',
    command: 'cmd',
    meta: 'cmd',
    super: 'cmd',
    win: 'cmd',
    cmdorctrl: 'cmd',
    commandorcontrol: 'cmd',
    ctrl: 'ctrl',
    control: 'ctrl',
    alt: 'alt',
    option: 'alt',
    shift: 'shift',
  },
  // The macOS provider sends both names as the same physical Delete key.
  keyAliases: { ...SHARED_KEY_ALIASES, delete: 'backspace' },
  blocked: [
    { modifiers: ['cmd', 'ctrl'], keys: ['q'], effect: 'lock the screen' },
    { modifiers: ['cmd', 'shift'], keys: ['q'], effect: 'log out of macOS' },
    { modifiers: ['cmd', 'alt'], keys: ['escape'], effect: 'open the Force Quit window' },
    { modifiers: ['cmd', 'shift'], keys: ['backspace'], effect: 'empty the Trash' },
    { modifiers: ['cmd'], keys: ['q'], effect: 'quit the app' },
  ],
};

const WINDOWS_RULES: PlatformKeyRules = {
  modifierAliases: {
    ctrl: 'ctrl',
    control: 'ctrl',
    cmdorctrl: 'ctrl',
    commandorcontrol: 'ctrl',
    meta: 'win',
    super: 'win',
    win: 'win',
    cmd: 'win',
    command: 'win',
    alt: 'alt',
    option: 'alt',
    shift: 'shift',
  },
  keyAliases: SHARED_KEY_ALIASES,
  // Ctrl+Alt+Delete is absent: Windows never honors a synthesized Secure Attention Sequence.
  blocked: [
    { modifiers: ['alt'], keys: ['f4'], effect: 'close the app' },
    { modifiers: ['win'], keys: ['l'], effect: 'lock Windows' },
    { modifiers: ['ctrl', 'shift'], keys: ['escape'], effect: 'open Task Manager' },
  ],
};

const NUMERIC_KEYSYM = 'numeric keysym';

const LINUX_RULES: PlatformKeyRules = {
  modifierAliases: {
    ctrl: 'ctrl',
    control: 'ctrl',
    cmdorctrl: 'ctrl',
    commandorcontrol: 'ctrl',
    // xdotool sends Meta_L, which default XKB layouts put on the Alt modifier.
    meta: 'alt',
    super: 'super',
    win: 'super',
    cmd: 'super',
    command: 'super',
    alt: 'alt',
    option: 'alt',
    shift: 'shift',
  },
  // X11 names F11 and F12 L1 and L2 too.
  keyAliases: { ...SHARED_KEY_ALIASES, l1: 'f11', l2: 'f12' },
  // Xlib and GDK resolve 0x/U hex keysyms and drop an optional XF86 prefix; xdotool reads any
  // other token starting with a digit as a raw keycode (atoi ignores trailing text).
  canonicalKey: (key) => (/^(\d[\s\S]+|u[0-9a-f]+)$/.test(key) ? NUMERIC_KEYSYM : key.replace(/^xf86_?/, '')),
  blocked: [
    {
      modifiers: [],
      keys: [NUMERIC_KEYSYM],
      effect: 'send a numeric keysym or keycode that computer use cannot check',
    },
    {
      modifiers: [],
      keys: ['poweroff', 'powerdown', 'logoff', 'sleep', 'suspend', 'hibernate', 'standby'],
      effect: 'power off, suspend or log out of the session',
    },
    { modifiers: [], keys: ['screensaver'], effect: 'lock the screen' },
    {
      modifiers: [],
      keys: Array.from({ length: 12 }, (_, index) => `switch_vt_${index + 1}`),
      effect: 'switch to another virtual terminal',
    },
    { modifiers: [], keys: ['terminate_server'], effect: 'end the X session' },
    {
      modifiers: ['ctrl', 'alt'],
      keys: ['delete'],
      effect: 'open the log out and power off dialog',
    },
    { modifiers: ['ctrl', 'alt'], keys: ['backspace'], effect: 'end the X session' },
    {
      modifiers: ['ctrl', 'alt'],
      keys: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12'],
      effect: 'switch to another virtual terminal',
    },
    { modifiers: ['ctrl', 'alt'], keys: ['l'], effect: 'lock the screen' },
    { modifiers: ['super'], keys: ['l'], effect: 'lock the screen' },
    { modifiers: ['alt'], keys: ['f4'], effect: 'close the window' },
    { modifiers: ['ctrl'], keys: ['q'], effect: 'quit the app' },
  ],
};

// Extra modifiers still match: Ctrl+Alt+Shift+Q quits the app just like Ctrl+Q.
function findBlockedKeyCombo(key: string, rules: PlatformKeyRules): BlockedKeyCombo | null {
  const isLinux = rules === LINUX_RULES;
  const parts = key === '+' ? ['+'] : key.split('+');
  const modifiers = new Set<string>();
  let keyName = '';
  for (const part of parts) {
    const normalized = part.trim().toLowerCase();
    // X11 keysym names such as Alt_L/Control_R carry a side suffix the alias table doesn't have.
    const modifierName = (isLinux ? normalized.replace(/_[lr]$/, '') : normalized).replace(/[\s_-]/g, '');
    const modifier = rules.modifierAliases[modifierName];
    if (modifier) {
      modifiers.add(modifier);
    } else {
      const aliased = rules.keyAliases[normalized] ?? normalized;
      keyName = rules.canonicalKey ? rules.canonicalKey(aliased) : aliased;
    }
  }
  return (
    rules.blocked.find(
      (combo) => combo.keys.includes(keyName) && combo.modifiers.every((modifier) => modifiers.has(modifier)),
    ) ?? null
  );
}

function rulesFor(platform: KeyPlatform): PlatformKeyRules | null {
  if (platform === 'linux') return LINUX_RULES;
  if (platform === 'windows') return WINDOWS_RULES;
  if (platform === 'mac') return MACOS_RULES;
  return null;
}

/**
 * Throws `system_shortcut_blocked` for a chord that quits, locks, logs out or switches VTs (FR-8).
 * Platforms without a rule table throw `unsupported_platform`, even with allowSystemShortcut (D-16).
 */
export function assertKeyComboAllowed(key: string, allowSystemShortcut: boolean, platform: KeyPlatform = 'linux'): void {
  const rules = rulesFor(platform);
  if (!rules) {
    throw new ComputerUseError('unsupported_platform', `No blocked-shortcut rules for ${platform} yet.`);
  }
  if (allowSystemShortcut) return;
  const blocked = findBlockedKeyCombo(key, rules);
  if (blocked) {
    throw new ComputerUseError(
      'system_shortcut_blocked',
      `'${key}' would ${blocked.effect}, so computer use refuses it unless you pass --allow-system-shortcut`,
    );
  }
}
