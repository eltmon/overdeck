/**
 * Unit tests for the connect window and its IPC guard (PAN-4402 W-5).
 *
 * Electron is mocked: BrowserWindow is a minimal fake and ipcMain.handle
 * records handlers so the tests can invoke them with any sender.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = [];
    webContents = { send: vi.fn() };
    destroyed = false;
    listeners = new Map<string, () => void>();
    constructor(public options: unknown) {
      FakeBrowserWindow.instances.push(this);
    }
    once(name: string, listener: () => void) { this.listeners.set(name, listener); }
    on(name: string, listener: () => void) { this.listeners.set(name, listener); }
    loadFile = vi.fn(async () => undefined);
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    restore() {}
    show = vi.fn();
    focus = vi.fn();
    close() {
      this.destroyed = true;
      this.listeners.get("closed")?.();
    }
  }
  return {
    handlers,
    FakeBrowserWindow,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    },
  };
});

vi.mock("electron", () => ({
  BrowserWindow: electron.FakeBrowserWindow,
  ipcMain: electron.ipcMain,
}));

vi.mock("../src/main.js", () => ({
  resolveResourcePath: vi.fn(() => "/fake/resources/connect.html"),
}));

import {
  CONNECT_IPC,
  type ConnectHandlers,
  closeConnectWindow,
  openConnectWindow,
  registerConnectIpc,
} from "../src/connect-window.js";

const injected = {
  getState: vi.fn(() => ({
    mode: "remote" as const,
    canUseThisComputer: true,
    // Extra fields stand in for anything a caller might leak; getState must drop them.
    machine: { label: "desk", baseUrl: "http://100.101.102.103:3011", token: "odk_secret", tokenCiphertext: "c" },
  })),
  pair: vi.fn(async () => ({ ok: true as const })),
  openMachine: vi.fn(async () => ({ ok: true as const })),
  useLocal: vi.fn(async () => ({ ok: true as const })),
  forget: vi.fn(async () => ({ ok: true as const })),
} satisfies ConnectHandlers;

function invoke(channel: string, sender: unknown, ...args: unknown[]): unknown {
  const handler = electron.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler({ sender }, ...args);
}

beforeEach(() => {
  closeConnectWindow();
  electron.FakeBrowserWindow.instances.length = 0;
  electron.handlers.clear();
  vi.clearAllMocks();
  registerConnectIpc(injected);
});

describe("connect window", () => {
  it("creates one window and reuses it on a second open", () => {
    const first = openConnectWindow();
    const second = openConnectWindow("Can't reach desk.");
    expect(second).toBe(first);
    expect(electron.FakeBrowserWindow.instances).toHaveLength(1);
    expect(first.loadFile).toHaveBeenCalledWith("/fake/resources/connect.html");
  });

  it("refuses every channel from a foreign sender without calling the handler", async () => {
    openConnectWindow();
    const foreign = { id: "remote-dashboard" };
    for (const channel of [CONNECT_IPC.GET_STATE, CONNECT_IPC.OPEN_MACHINE, CONNECT_IPC.USE_LOCAL, CONNECT_IPC.FORGET]) {
      expect(await invoke(channel, foreign)).toEqual({ ok: false, error: "not allowed" });
    }
    expect(await invoke(CONNECT_IPC.PAIR, foreign, "http://127.0.0.1:3911/#pair=odp_x")).toEqual({
      ok: false,
      error: "not allowed",
    });
    expect(injected.getState).not.toHaveBeenCalled();
    expect(injected.pair).not.toHaveBeenCalled();
    expect(injected.openMachine).not.toHaveBeenCalled();
    expect(injected.useLocal).not.toHaveBeenCalled();
    expect(injected.forget).not.toHaveBeenCalled();
  });

  it("refuses calls when no connect window is open", async () => {
    expect(await invoke(CONNECT_IPC.GET_STATE, {})).toEqual({ ok: false, error: "not allowed" });
  });

  it("returns state with the error and without any token field", async () => {
    const win = openConnectWindow("Can't reach desk.");
    const state = await invoke(CONNECT_IPC.GET_STATE, win.webContents);
    expect(state).toEqual({
      mode: "remote",
      machine: { label: "desk", baseUrl: "http://100.101.102.103:3011" },
      canUseThisComputer: true,
      error: "Can't reach desk.",
    });
    expect(JSON.stringify(state)).not.toContain("token");
  });

  it("passes a pairing link from the connect window to the handler", async () => {
    const win = openConnectWindow();
    await invoke(CONNECT_IPC.PAIR, win.webContents, "http://127.0.0.1:3911/#pair=odp_x");
    expect(injected.pair).toHaveBeenCalledWith("http://127.0.0.1:3911/#pair=odp_x");
  });

  it("turns a thrown handler into an error result", async () => {
    injected.pair.mockRejectedValueOnce(new Error("keyring locked"));
    const win = openConnectWindow();
    expect(await invoke(CONNECT_IPC.PAIR, win.webContents, "x")).toEqual({ ok: false, error: "keyring locked" });
  });
});
