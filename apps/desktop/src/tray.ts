/**
 * System tray for the Overdeck desktop app.
 *
 * Creates a Tray with:
 * - Color-coded icon: green (idle), yellow (working), red (attention needed)
 * - Agent count badge overlay (macOS dock badge)
 * - Rich tooltip: agent count, attention items, last activity
 * - Context menu: Show Dashboard, Start/Stop Cloister, Emergency Stop, Settings, Quit
 *
 * Polls /api/health every 5s for live status.
 */

import * as Path from "node:path";

import { app, Menu, nativeImage, Tray } from "electron";
import type { MenuItemConstructorOptions } from "electron";

import { callServerApi, serverUrl, showOrCreateWindow, dispatchMenuAction, isQuitting } from "./main.js";
import { resolveResourcePath } from "./main.js";
import { getDesktopSettings } from "./settings.js";

export type AgentStatus = "idle" | "working" | "attention";

let tray: Tray | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

// ─── Icon ─────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "#22c55e",
  working: "#f59e0b",
  attention: "#ef4444",
};

function createTrayIcon(status: AgentStatus): Electron.NativeImage {
  const color = STATUS_COLORS[status];
  // 16×16 circle SVG rendered to NativeImage buffer
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
    <circle cx="8" cy="8" r="7" fill="${color}" stroke="#00000033" stroke-width="0.5"/>
    <ellipse cx="8" cy="8" rx="5.5" ry="3.8" stroke="#ffffff44" stroke-width="0.5" fill="none"/>
    <circle cx="8" cy="8" r="2" fill="#ffffff99"/>
    <circle cx="8" cy="8" r="1" fill="#00000066"/>
  </svg>`;

  return nativeImage.createFromBuffer(Buffer.from(svg));
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function buildTooltip(agentCount: number, attentionCount: number, lastActivity: string | null): string {
  const settings = getDesktopSettings();
  if (settings.tray.tooltipDetail === "minimal") {
    return `Overdeck — ${agentCount} agent${agentCount !== 1 ? "s" : ""}`;
  }

  const lines = ["Overdeck"];
  lines.push(`${agentCount} agent${agentCount !== 1 ? "s" : ""} running`);
  if (attentionCount > 0) {
    lines.push(`⚠ ${attentionCount} need${attentionCount !== 1 ? "" : "s"} attention`);
  }
  if (lastActivity) {
    lines.push(`Last: ${lastActivity}`);
  }
  return lines.join("\n");
}

// ─── Context menu ─────────────────────────────────────────────────────────────

function buildContextMenu(): Electron.Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "Show Dashboard",
      click: () => showOrCreateWindow(),
    },
    { type: "separator" },
    {
      label: "Start Cloister",
      click: () => callServerApi("/api/cloister/start", "POST"),
    },
    {
      label: "Stop Cloister",
      click: () => callServerApi("/api/cloister/stop", "POST"),
    },
    {
      label: "Emergency Stop All",
      click: () => callServerApi("/api/agents/emergency-stop", "POST"),
    },
    { type: "separator" },
    {
      label: "Settings",
      click: () => {
        showOrCreateWindow();
        dispatchMenuAction("open-settings");
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        // isQuitting is set by app.on("before-quit")
        app.quit();
      },
    },
  ];
  return Menu.buildFromTemplate(template);
}

// ─── Polling ──────────────────────────────────────────────────────────────────

interface HealthResponse {
  agentCount?: number;
  attentionCount?: number;
  lastActivity?: string;
  status?: string;
}

async function refreshTrayStatus(): Promise<void> {
  if (!tray || isQuitting) return;
  const url = serverUrl;
  if (!url) return;

  try {
    const resp = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3_000) });
    if (!resp.ok) return;

    const data = (await resp.json()) as HealthResponse;
    const agentCount = data.agentCount ?? 0;
    const attentionCount = data.attentionCount ?? 0;
    const lastActivity = data.lastActivity ?? null;

    const status: AgentStatus =
      attentionCount > 0 ? "attention" : agentCount > 0 ? "working" : "idle";

    tray.setImage(createTrayIcon(status));
    tray.setToolTip(buildTooltip(agentCount, attentionCount, lastActivity));
    tray.setContextMenu(buildContextMenu());

    // macOS dock badge
    const settings = getDesktopSettings();
    if (settings.tray.showBadge && process.platform === "darwin" && app.dock) {
      app.dock.setBadge(agentCount > 0 ? String(agentCount) : "");
    }
  } catch {
    // Server not ready yet — silently skip
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createTray(): void {
  if (tray) return;

  const icon = createTrayIcon("idle");
  tray = new Tray(icon);
  tray.setToolTip("Overdeck");
  tray.setContextMenu(buildContextMenu());

  // Single-click opens dashboard on all platforms
  tray.on("click", () => showOrCreateWindow());

  // Start polling
  pollTimer = setInterval(() => void refreshTrayStatus(), 5_000);
  void refreshTrayStatus();
}

export function destroyTray(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  tray?.destroy();
  tray = null;
}
