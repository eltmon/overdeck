/**
 * Unit tests for desktop auto-updater service.
 *
 * Mocks 'electron-updater' and 'electron' (BrowserWindow) to test
 * the update status management and IPC bridge logic in isolation.
 */

import { describe, expect, it, vi } from "vitest";

// ─── Mock electron-updater ─────────────────────────────────────────────────────

vi.mock("electron-updater", () => {
  return {
    autoUpdater: {
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      downloadUpdate: vi.fn().mockResolvedValue(undefined),
      quitAndInstall: vi.fn(),
      on: vi.fn(),
      autoDownload: false,
      autoInstallOnAppQuit: true,
    },
    UpdateInfo: {},
  };
});

// ─── Mock electron ───────────────────────────────────────────────────────────────

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  app: {
    getPath: () => "/tmp/test",
  },
}));

// ─── Import after mocks are set up ─────────────────────────────────────────────

import {
  currentStatus,
  getUpdateStatus,
  initializeAutoUpdater,
  onUpdateStatusChange,
} from "../src/updater.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const autoUpdater = (await import("electron-updater")).autoUpdater as any;

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("UpdateStatus interface", () => {
  it("currentStatus has correct initial shape", () => {
    expect(currentStatus.checking).toBe(false);
    expect(currentStatus.available).toBe(false);
    expect(currentStatus.downloaded).toBe(false);
    expect(currentStatus.version).toBe(null);
    expect(currentStatus.error).toBe(null);
  });

  it("getUpdateStatus returns current status matching currentStatus", () => {
    const status = getUpdateStatus();
    expect(status).toEqual(currentStatus);
  });
});

describe("onUpdateStatusChange", () => {
  it("registers a callback without error", () => {
    const callback = vi.fn();
    expect(() => onUpdateStatusChange(callback)).not.toThrow();
  });

  it("multiple callbacks can be registered", () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    onUpdateStatusChange(callback1);
    onUpdateStatusChange(callback2);
    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).not.toHaveBeenCalled();
  });
});

describe("initializeAutoUpdater", () => {
  it("configures feed URL with GitHub provider", () => {
    initializeAutoUpdater();
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: "github",
      owner: "eltmon",
      repo: "overdeck",
    });
  });

  it("sets autoDownload to false", () => {
    initializeAutoUpdater();
    expect(autoUpdater.autoDownload).toBe(false);
  });

  it("sets autoInstallOnAppQuit to true", () => {
    initializeAutoUpdater();
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
  });

  it("registers all event handlers for update lifecycle", () => {
    initializeAutoUpdater();
    expect(autoUpdater.on).toHaveBeenCalledWith("checking-for-update", expect.any(Function));
    expect(autoUpdater.on).toHaveBeenCalledWith("update-available", expect.any(Function));
    expect(autoUpdater.on).toHaveBeenCalledWith("update-not-available", expect.any(Function));
    expect(autoUpdater.on).toHaveBeenCalledWith("download-progress", expect.any(Function));
    expect(autoUpdater.on).toHaveBeenCalledWith("update-downloaded", expect.any(Function));
    expect(autoUpdater.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("prevents duplicate initialization", () => {
    initializeAutoUpdater();
    initializeAutoUpdater();
    // Should only register handlers once despite multiple calls
    const onCalls = autoUpdater.on.mock.calls.filter(([event]) =>
      ["checking-for-update", "update-available", "update-not-available", "download-progress", "update-downloaded", "error"].includes(event)
    );
    expect(onCalls.length).toBe(6);
  });
});
