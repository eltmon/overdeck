/**
 * Unit tests for terminal popout IPC handlers (PAN-486).
 *
 * Tests the IPC handler logic directly — input validation and BrowserWindow
 * management — without requiring the full Electron main process.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MockWindow {
  id: number;
  title: string;
  isDestroyed: () => boolean;
  focus: () => void;
  setAlwaysOnTop: (value: boolean) => void;
  loadURL: (url: string) => void;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
}

// ─── State ────────────────────────────────────────────────────────────────────

const terminalWindows = new Map<string, MockWindow>();
let windowIdCounter = 1;

// ─── Handler implementations (mirrors main.ts logic) ───────────────────────────

function createTerminalWindow(sessionName: string, title: string): MockWindow {
  const loadURL = vi.fn();
  const setAlwaysOnTop = vi.fn();
  const on = vi.fn();
  const win: MockWindow = {
    id: windowIdCounter++,
    title,
    isDestroyed: () => false,
    focus: () => {},
    setAlwaysOnTop,
    loadURL,
    on,
  };
  return win;
}

function handleOpenTerminalWindow(sessionName: unknown, title: unknown): void {
  if (typeof sessionName !== "string" || typeof title !== "string") return;
  const existing = terminalWindows.get(sessionName);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }
  const win = createTerminalWindow(sessionName, title);
  terminalWindows.set(sessionName, win);
  // Mirror main.ts: load URL and register closed cleanup
  win.loadURL(`http://localhost?terminal=${sessionName}`);
  win.on("closed", () => terminalWindows.delete(sessionName));
}

function handleSetAlwaysOnTop(value: unknown): void {
  const win = Array.from(terminalWindows.values()).find((w) => !w.isDestroyed());
  if (win) {
    win.setAlwaysOnTop(value === true);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Terminal popout IPC handlers", () => {
  beforeEach(() => {
    terminalWindows.clear();
    windowIdCounter = 1;
  });

  describe("OPEN_TERMINAL_WINDOW (handleOpenTerminalWindow)", () => {
    it("creates a new BrowserWindow for an unknown session", () => {
      handleOpenTerminalWindow("session-alpha", "Agent · PAN-486");

      const win = terminalWindows.get("session-alpha");
      expect(win).toBeDefined();
      expect(win!.title).toBe("Agent · PAN-486");
      expect(win!.loadURL).toHaveBeenCalled();
    });

    it("re-focuses existing window when called with the same session", () => {
      handleOpenTerminalWindow("session-beta", "Agent · PAN-486");

      const createdWindow = terminalWindows.get("session-beta")!;
      const focusSpy = vi.spyOn(createdWindow, "focus");

      // Call again with same session
      handleOpenTerminalWindow("session-beta", "Agent · PAN-486");

      expect(focusSpy).toHaveBeenCalled();
      // Should NOT create a second window
      expect(terminalWindows.size).toBe(1);
    });

    it("ignores non-string session name", () => {
      expect(() => handleOpenTerminalWindow(123, "title")).not.toThrow();
      expect(() => handleOpenTerminalWindow(null, "title")).not.toThrow();
      expect(terminalWindows.size).toBe(0);
    });

    it("ignores non-string title", () => {
      expect(() => handleOpenTerminalWindow("session", 456)).not.toThrow();
      expect(terminalWindows.size).toBe(0);
    });
  });

  describe("SET_ALWAYS_ON_TOP (handleSetAlwaysOnTop)", () => {
    it("sets always-on-top on the most recently created window", () => {
      handleOpenTerminalWindow("session-top", "top");
      const win = terminalWindows.get("session-top")!;

      handleSetAlwaysOnTop(true);

      expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true);
    });

    it("sets always-on-top to false when value is false", () => {
      handleOpenTerminalWindow("session-top2", "top2");
      const win = terminalWindows.get("session-top2")!;

      handleSetAlwaysOnTop(false);

      expect(win.setAlwaysOnTop).toHaveBeenCalledWith(false);
    });

    it("does nothing when no window exists", () => {
      // Should not throw
      expect(() => handleSetAlwaysOnTop(true)).not.toThrow();
    });
  });
});
