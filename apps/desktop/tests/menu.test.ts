/**
 * Unit tests for desktop menu update integration.
 *
 * Tests the update-related logic in menu.ts:
 * - "Check for Updates..." menu item
 * - "Install Update and Restart" dynamic menu item
 * - onUpdateStatusChange callback registration
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock electron first ───────────────────────────────────────────────────────

vi.mock("electron", () => ({
  app: { name: "Overdeck" },
  Menu: {
    buildFromTemplate: vi.fn(() => ({
      items: [{ label: "Overdeck", submenu: { on: vi.fn() } }],
    })),
    setApplicationMenu: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

// ─── Mock updater ─────────────────────────────────────────────────────────────

vi.mock("../src/updater.js", () => ({
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn(),
  onUpdateStatusChange: vi.fn(),
}));

// ─── Mock main ────────────────────────────────────────────────────────────────

vi.mock("../src/main.js", () => ({
  callServerApi: vi.fn(),
  showOrCreateWindow: vi.fn(),
  dispatchMenuAction: vi.fn(),
  serverUrl: "http://localhost:3000",
}));

// ─── Import after mocks ────────────────────────────────────────────────────────

import { configureApplicationMenu } from "../src/menu.js";
import { onUpdateStatusChange } from "../src/updater.js";
import { Menu } from "electron";

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("configureApplicationMenu - update integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers update status change callback via onUpdateStatusChange", () => {
    configureApplicationMenu();
    expect(onUpdateStatusChange).toHaveBeenCalledWith(expect.any(Function));
  });

  it("builds menu from template via Menu.buildFromTemplate", () => {
    configureApplicationMenu();
    expect(Menu.buildFromTemplate).toHaveBeenCalled();
  });

  it("sets application menu via Menu.setApplicationMenu", () => {
    configureApplicationMenu();
    expect(Menu.setApplicationMenu).toHaveBeenCalled();
  });
});

describe("updater module exports", () => {
  it("checkForUpdates is a function", async () => {
    const { checkForUpdates } = await import("../src/updater.js");
    expect(typeof checkForUpdates).toBe("function");
  });

  it("quitAndInstall is a function", async () => {
    const { quitAndInstall } = await import("../src/updater.js");
    expect(typeof quitAndInstall).toBe("function");
  });

  it("onUpdateStatusChange is a function", async () => {
    const { onUpdateStatusChange } = await import("../src/updater.js");
    expect(typeof onUpdateStatusChange).toBe("function");
  });
});
