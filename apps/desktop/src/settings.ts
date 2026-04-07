/**
 * Desktop-specific settings, persisted to userData/desktop-settings.json.
 *
 * Covers: tray appearance, per-event notification toggles, auto-start config.
 * Loaded at app startup; updated via IPC from renderer.
 */

import * as FS from "node:fs";
import * as Path from "node:path";

import { app } from "electron";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DesktopSettings {
  tray: {
    showBadge: boolean;
    tooltipDetail: "minimal" | "full";
  };
  notifications: {
    inputNeeded: boolean;
    stuckAgents: boolean;
    mergeFailures: boolean;
    workComplete: boolean;
    planningDone: boolean;
    mergeReady: boolean;
  };
  autoStart: {
    enabled: boolean;
    nagCount: number;
    nagDismissed: boolean;
  };
}

export type NotificationEventType = keyof DesktopSettings["notifications"];

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS: DesktopSettings = {
  tray: {
    showBadge: true,
    tooltipDetail: "full",
  },
  notifications: {
    inputNeeded: true,
    stuckAgents: true,
    mergeFailures: true,
    workComplete: true,
    planningDone: false,
    mergeReady: true,
  },
  autoStart: {
    enabled: false,
    nagCount: 0,
    nagDismissed: false,
  },
};

// ─── State ────────────────────────────────────────────────────────────────────

let settings: DesktopSettings = deepClone(DEFAULTS);

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

function settingsPath(): string {
  return Path.join(app.getPath("userData"), "desktop-settings.json");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function loadDesktopSettings(): void {
  try {
    const raw = FS.readFileSync(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<DesktopSettings>;
    settings = {
      tray: { ...DEFAULTS.tray, ...parsed.tray },
      notifications: { ...DEFAULTS.notifications, ...parsed.notifications },
      autoStart: { ...DEFAULTS.autoStart, ...parsed.autoStart },
    };
  } catch {
    settings = deepClone(DEFAULTS);
  }
}

export function saveDesktopSettings(): void {
  try {
    FS.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch {
    console.error("[desktop] failed to save desktop settings");
  }
}

export function getDesktopSettings(): DesktopSettings {
  return settings;
}

/**
 * Update a single setting by dotted key (e.g. "notifications.inputNeeded").
 * Returns true if the key was found and updated.
 */
export function updateDesktopSetting(key: string, value: unknown): boolean {
  const [section, field] = key.split(".");
  if (!section || !field) return false;
  const s = settings as unknown as Record<string, Record<string, unknown>>;
  if (!s[section] || !(field in s[section])) return false;
  s[section][field] = value;
  saveDesktopSettings();
  return true;
}
