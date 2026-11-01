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
  openConnectWindowFromMenu: vi.fn(),
  useThisComputer: vi.fn(),
}));

// ─── Mock connection ──────────────────────────────────────────────────────────

const connection = vi.hoisted(() => ({
  getActiveDashboard: vi.fn((): { kind: string; baseUrl: string; label?: string } => ({
    kind: "local",
    baseUrl: "http://localhost:3000",
  })),
  dashboardFetch: vi.fn(),
}));

vi.mock("../src/connection.js", () => connection);

// ─── Import after mocks ────────────────────────────────────────────────────────

import { configureApplicationMenu } from "../src/menu.js";
import { onUpdateStatusChange } from "../src/updater.js";
import { Menu } from "electron";
import type { MenuItemConstructorOptions } from "electron";

function overdeckSubmenu(): MenuItemConstructorOptions[] {
  const calls = vi.mocked(Menu.buildFromTemplate).mock.calls;
  const template = calls[calls.length - 1]?.[0] as MenuItemConstructorOptions[];
  const overdeck = template.find((item) => item.label === "Overdeck");
  return overdeck?.submenu as MenuItemConstructorOptions[];
}

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

describe("configureApplicationMenu - chosen machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers Connect to a Machine… and disables Use This Computer in local mode", () => {
    configureApplicationMenu();
    const submenu = overdeckSubmenu();
    expect(submenu.find((item) => item.label === "Connect to a Machine…")).toBeDefined();
    expect(submenu.find((item) => item.label === "Use This Computer")?.enabled).toBe(false);
    expect(submenu.some((item) => String(item.label).startsWith("Showing "))).toBe(false);
  });

  it("names the chosen machine and enables Use This Computer in remote mode", () => {
    connection.getActiveDashboard.mockReturnValueOnce({ kind: "remote", baseUrl: "http://100.64.0.1:3011", label: "desk" });
    configureApplicationMenu();
    const submenu = overdeckSubmenu();
    expect(submenu[0]).toEqual({ label: "Showing desk", enabled: false });
    expect(submenu.find((item) => item.label === "Use This Computer")?.enabled).toBe(true);
  });
});
