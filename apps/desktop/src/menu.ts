/**
 * Application menu bar for the Panopticon desktop app.
 *
 * Standard Electron menus: File, Edit, View, Window, Help
 * Plus a Panopticon menu with all orchestration actions.
 *
 * macOS: app name menu with About, Settings, Services etc.
 * Linux/Windows: Settings in File menu.
 */

import { app, Menu, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";

import { callServerApi, showOrCreateWindow, dispatchMenuAction, serverUrl } from "./main.js";
import { checkForUpdates, quitAndInstall, onUpdateStatusChange } from "./updater.js";

// ─── Workspace submenu (refreshed on open) ────────────────────────────────────

interface WorkspaceSummary {
  issueId: string;
  title?: string;
}

async function fetchActiveWorkspaces(): Promise<WorkspaceSummary[]> {
  if (!serverUrl) return [];
  try {
    const resp = await fetch(`${serverUrl}/api/workspaces`, { signal: AbortSignal.timeout(2_000) });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { workspaces?: WorkspaceSummary[] };
    return data.workspaces?.slice(0, 10) ?? [];
  } catch {
    return [];
  }
}

// ─── Update menu state ─────────────────────────────────────────────────────────

let updateDownloaded = false;

function rebuildMenu(): void {
  const menu = Menu.buildFromTemplate(buildMenuTemplate());
  Menu.setApplicationMenu(menu);

  // Re-attach workspace submenu refresh listener
  const panopticonMenu = menu.items.find((item) => item.label === "Panopticon");
  if (panopticonMenu?.submenu) {
    panopticonMenu.submenu.on("menu-will-show", () => {
      void fetchActiveWorkspaces().then((workspaces) => {
        const wsItem = panopticonMenu.submenu?.items.find(
          (i) => i.id === "open-workspace-submenu",
        );
        if (wsItem) {
          wsItem.label = workspaces.length
            ? `Open Workspace (${workspaces.length})`
            : "Open Workspace";
        }
      });
    });
  }
}

function buildWorkspaceSubmenu(workspaces: WorkspaceSummary[]): MenuItemConstructorOptions[] {
  if (workspaces.length === 0) {
    return [{ label: "No active workspaces", enabled: false }];
  }
  return workspaces.map((ws) => ({
    label: ws.title ? `${ws.issueId} — ${ws.title}` : ws.issueId,
    click: () => {
      showOrCreateWindow();
      dispatchMenuAction(`open-workspace:${ws.issueId}`);
    },
  }));
}

// ─── Menu template ────────────────────────────────────────────────────────────

function buildMenuTemplate(): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];

  // macOS: app menu (first menu = app name on macOS)
  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Settings...",
          accelerator: "CmdOrCtrl+,",
          click: () => {
            showOrCreateWindow();
            dispatchMenuAction("open-settings");
          },
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  // File menu
  template.push({
    label: "File",
    submenu: [
      ...(process.platform !== "darwin"
        ? [
            {
              label: "Settings...",
              accelerator: "CmdOrCtrl+,",
              click: () => {
                showOrCreateWindow();
                dispatchMenuAction("open-settings");
              },
            },
            { type: "separator" as const },
          ]
        : []),
      { role: process.platform === "darwin" ? ("close" as const) : ("quit" as const) },
    ],
  });

  // Edit
  template.push({ role: "editMenu" as const });

  // View
  template.push({
    label: "View",
    submenu: [
      { role: "reload" as const },
      { role: "forceReload" as const },
      { role: "toggleDevTools" as const },
      { type: "separator" as const },
      { role: "resetZoom" as const },
      { role: "zoomIn" as const, accelerator: "CmdOrCtrl+=" },
      { role: "zoomOut" as const },
      { type: "separator" as const },
      { role: "togglefullscreen" as const },
    ],
  });

  // Window
  template.push({ role: "windowMenu" as const });

  // Panopticon
  template.push({
    label: "Panopticon",
    submenu: [
      {
        label: "Start Cloister",
        click: () => callServerApi("/api/cloister/start", "POST"),
      },
      {
        label: "Stop Cloister",
        click: () => callServerApi("/api/cloister/stop", "POST"),
      },
      {
        label: "Emergency Stop All Agents",
        click: () => callServerApi("/api/agents/emergency-stop", "POST"),
      },
      { type: "separator" },
      {
        label: "Open Workspace",
        id: "open-workspace-submenu",
        submenu: [{ label: "Loading...", enabled: false }],
      },
      { type: "separator" },
      {
        label: "Settings...",
        accelerator: process.platform !== "darwin" ? "CmdOrCtrl+," : undefined,
        click: () => {
          showOrCreateWindow();
          dispatchMenuAction("open-settings");
        },
      },
    ],
  });

  // Help
  template.push({
    role: "help" as const,
    submenu: [
      {
        label: "Check for Updates...",
        click: () => {
          void checkForUpdates();
        },
      },
      { type: "separator" },
      {
        label: "Flywheel Documentation",
        click: () =>
          void shell.openExternal(
            "https://github.com/eltmon/panopticon-cli/blob/main/docs/FLYWHEEL.md",
          ),
      },
      {
        label: "Panopticon on GitHub",
        click: () =>
          void shell.openExternal("https://github.com/eltmon/panopticon-cli"),
      },
      {
        label: "Report an Issue",
        click: () =>
          void shell.openExternal("https://github.com/eltmon/panopticon-cli/issues"),
      },
    ],
  });

  // Add "Install Update and Restart" item if update is downloaded
  if (updateDownloaded) {
    const helpMenu = template[template.length - 1];
    if (helpMenu && helpMenu.submenu && Array.isArray(helpMenu.submenu)) {
      helpMenu.submenu.push(
        { type: "separator" },
        {
          label: "Install Update and Restart",
          click: () => {
            quitAndInstall();
          },
        },
      );
    }
  }

  return template;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function configureApplicationMenu(): void {
  const menu = Menu.buildFromTemplate(buildMenuTemplate());
  Menu.setApplicationMenu(menu);

  // Refresh workspace submenu when the Panopticon menu is about to open
  const panopticonMenu = menu.items.find((item) => item.label === "Panopticon");
  if (panopticonMenu?.submenu) {
    panopticonMenu.submenu.on("menu-will-show", () => {
      void fetchActiveWorkspaces().then((workspaces) => {
        const wsItem = panopticonMenu.submenu?.items.find(
          (i) => i.id === "open-workspace-submenu",
        );
        if (wsItem) {
          // Electron doesn't support dynamic submenu replacement after build,
          // so we dispatch a menu action that opens a workspace picker in the renderer
          wsItem.label = workspaces.length
            ? `Open Workspace (${workspaces.length})`
            : "Open Workspace";
        }
      });
    });
  }

  // Listen for update status changes to rebuild menu when update is downloaded
  onUpdateStatusChange((status) => {
    if (status.downloaded && !updateDownloaded) {
      updateDownloaded = true;
      rebuildMenu();
    }
  });
}
