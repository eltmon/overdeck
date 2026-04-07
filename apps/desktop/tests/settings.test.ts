/**
 * Unit tests for desktop settings persistence.
 *
 * Mocks 'electron' (app.getPath) and uses a real temp directory for file I/O
 * so we test actual JSON read/write without launching Electron.
 */

import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock electron before importing settings ──────────────────────────────────

let mockUserDataDir = "";

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name === "userData") return mockUserDataDir;
      throw new Error(`Unexpected getPath call: ${name}`);
    },
  },
}));

// Import after mock is set up
import {
  getDesktopSettings,
  loadDesktopSettings,
  saveDesktopSettings, // used indirectly via updateDesktopSetting
  updateDesktopSetting,
} from "../src/settings.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const settingsFile = () => Path.join(mockUserDataDir, "desktop-settings.json");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("loadDesktopSettings", () => {
  beforeEach(() => {
    mockUserDataDir = FS.mkdtempSync(Path.join(OS.tmpdir(), "pan-settings-"));
  });

  afterEach(() => {
    FS.rmSync(mockUserDataDir, { recursive: true, force: true });
  });

  it("uses defaults when settings file is missing", () => {
    loadDesktopSettings();
    const s = getDesktopSettings();
    expect(s.tray.showBadge).toBe(true);
    expect(s.tray.tooltipDetail).toBe("full");
    expect(s.notifications.inputNeeded).toBe(true);
    expect(s.notifications.planningDone).toBe(false);
    expect(s.autoStart.enabled).toBe(false);
    expect(s.autoStart.nagCount).toBe(0);
  });

  it("uses defaults when settings file contains corrupt JSON", () => {
    FS.writeFileSync(settingsFile(), "{ this is not json ]]]");
    loadDesktopSettings();
    const s = getDesktopSettings();
    expect(s.tray.showBadge).toBe(true);
    expect(s.autoStart.nagCount).toBe(0);
  });

  it("merges partial settings with defaults", () => {
    // Only override one field — rest should come from defaults
    FS.writeFileSync(
      settingsFile(),
      JSON.stringify({ tray: { showBadge: false } }),
    );
    loadDesktopSettings();
    const s = getDesktopSettings();
    expect(s.tray.showBadge).toBe(false);
    expect(s.tray.tooltipDetail).toBe("full"); // default filled in
    expect(s.notifications.inputNeeded).toBe(true); // default
    expect(s.autoStart.nagCount).toBe(0); // default
  });

  it("loads fully-specified settings correctly", () => {
    const full = {
      tray: { showBadge: false, tooltipDetail: "minimal" },
      notifications: {
        inputNeeded: false,
        stuckAgents: false,
        mergeFailures: true,
        workComplete: false,
        planningDone: true,
        mergeReady: false,
      },
      autoStart: { enabled: true, nagCount: 3, nagDismissed: true },
    };
    FS.writeFileSync(settingsFile(), JSON.stringify(full));
    loadDesktopSettings();
    const s = getDesktopSettings();
    expect(s.tray.tooltipDetail).toBe("minimal");
    expect(s.notifications.planningDone).toBe(true);
    expect(s.autoStart.nagCount).toBe(3);
    expect(s.autoStart.nagDismissed).toBe(true);
  });
});

describe("saveDesktopSettings / round-trip", () => {
  beforeEach(() => {
    mockUserDataDir = FS.mkdtempSync(Path.join(OS.tmpdir(), "pan-settings-"));
    loadDesktopSettings(); // start from defaults
  });

  afterEach(() => {
    FS.rmSync(mockUserDataDir, { recursive: true, force: true });
  });

  it("persists settings to disk and reloads them correctly", () => {
    updateDesktopSetting("tray.showBadge", false);
    updateDesktopSetting("autoStart.nagCount", 2);

    // Verify file was written
    expect(FS.existsSync(settingsFile())).toBe(true);

    // Reload from disk and check values survive round-trip
    loadDesktopSettings();
    const s = getDesktopSettings();
    expect(s.tray.showBadge).toBe(false);
    expect(s.autoStart.nagCount).toBe(2);
  });
});

describe("updateDesktopSetting", () => {
  beforeEach(() => {
    mockUserDataDir = FS.mkdtempSync(Path.join(OS.tmpdir(), "pan-settings-"));
    loadDesktopSettings(); // start from defaults
  });

  afterEach(() => {
    FS.rmSync(mockUserDataDir, { recursive: true, force: true });
  });

  it("updates a valid nested key and returns true", () => {
    const result = updateDesktopSetting("notifications.inputNeeded", false);
    expect(result).toBe(true);
    expect(getDesktopSettings().notifications.inputNeeded).toBe(false);
  });

  it("updates autoStart.nagCount", () => {
    const result = updateDesktopSetting("autoStart.nagCount", 5);
    expect(result).toBe(true);
    expect(getDesktopSettings().autoStart.nagCount).toBe(5);
  });

  it("returns false for an unknown section", () => {
    const result = updateDesktopSetting("unknown.field", true);
    expect(result).toBe(false);
  });

  it("returns false for a key with no dot separator", () => {
    const result = updateDesktopSetting("noDotHere", true);
    expect(result).toBe(false);
  });

  it("returns false for an unknown field in a valid section", () => {
    const result = updateDesktopSetting("tray.nonExistentField", true);
    expect(result).toBe(false);
  });

  it("saves to disk after a successful update", () => {
    updateDesktopSetting("tray.tooltipDetail", "minimal");
    const raw = FS.readFileSync(settingsFile(), "utf8");
    const parsed = JSON.parse(raw) as { tray: { tooltipDetail: string } };
    expect(parsed.tray.tooltipDetail).toBe("minimal");
  });
});
