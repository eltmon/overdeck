import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockWindow {
  isDestroyed: () => boolean;
  focus: () => void;
  setAlwaysOnTop: (value: boolean) => void;
  loadURL: (url: string) => void;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
}

const terminalWindows = new Map<string, MockWindow>();

function createTerminalWindow(title: string): MockWindow {
  return {
    isDestroyed: () => false,
    focus: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    loadURL: vi.fn(),
    on: vi.fn(),
  };
}

function openTerminalWindow(sessionName: unknown, title: unknown): void {
  if (typeof sessionName !== 'string' || typeof title !== 'string') return;

  const existing = terminalWindows.get(sessionName);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  const win = createTerminalWindow(title);
  terminalWindows.set(sessionName, win);
  win.loadURL(`http://localhost?terminal=${encodeURIComponent(sessionName)}&title=${encodeURIComponent(title)}`);
  win.on('closed', () => terminalWindows.delete(sessionName));
}

function setAlwaysOnTop(value: unknown): void {
  const win = Array.from(terminalWindows.values()).find(candidate => !candidate.isDestroyed());
  if (win) {
    win.setAlwaysOnTop(value === true);
  }
}

describe('terminal popout IPC helpers', () => {
  beforeEach(() => {
    terminalWindows.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a new popout window for a new session', () => {
    openTerminalWindow('session-alpha', 'PAN-486');
    const win = terminalWindows.get('session-alpha');
    expect(win).toBeDefined();
    expect(win?.loadURL).toHaveBeenCalled();
  });

  it('focuses the existing window instead of creating a duplicate', () => {
    openTerminalWindow('session-beta', 'PAN-486');
    const win = terminalWindows.get('session-beta')!;

    openTerminalWindow('session-beta', 'PAN-486');

    expect(win.focus).toHaveBeenCalled();
    expect(terminalWindows.size).toBe(1);
  });

  it('ignores invalid IPC payloads', () => {
    expect(() => openTerminalWindow(123, 'title')).not.toThrow();
    expect(() => openTerminalWindow('session', null)).not.toThrow();
    expect(terminalWindows.size).toBe(0);
  });

  it('toggles always-on-top on the active terminal window', () => {
    openTerminalWindow('session-top', 'PAN-486');
    const win = terminalWindows.get('session-top')!;

    setAlwaysOnTop(true);
    setAlwaysOnTop(false);

    expect(win.setAlwaysOnTop).toHaveBeenNthCalledWith(1, true);
    expect(win.setAlwaysOnTop).toHaveBeenNthCalledWith(2, false);
  });
});
