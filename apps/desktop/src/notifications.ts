/**
 * Native desktop notifications for Overdeck events.
 *
 * Event types and their default enabled state (all configurable in Settings):
 *   inputNeeded   — Agent needs user input (default: on)
 *   stuckAgents   — Agent has been stuck > threshold (default: on)
 *   mergeFailures — Merge specialist failed (default: on)
 *   workComplete  — Agent signalled work done (default: on)
 *   planningDone  — Planning session complete (default: off)
 *   mergeReady    — PR ready for human merge (default: on)
 *
 * Notifications are sent from:
 * 1. Renderer → main via IPC (pan:notify) — for events the frontend detects
 * 2. Main process directly — in future when subscribing to domain events via WS
 */

import { app, ipcMain, Notification } from "electron";

import { IPC } from "./main.js";
import { showOrCreateWindow } from "./main.js";
import { getDesktopSettings } from "./settings.js";
import { resolveResourcePath } from "./main.js";
import type { NotificationEventType } from "./settings.js";

// ─── Send notification ────────────────────────────────────────────────────────

export function sendNotification(
  eventType: NotificationEventType,
  title: string,
  body: string,
): void {
  const settings = getDesktopSettings();
  if (!settings.notifications[eventType]) return;

  if (!Notification.isSupported()) return;

  const iconPath = resolveResourcePath("icon.png");

  const notification = new Notification({
    title,
    body,
    icon: iconPath ?? undefined,
    silent: false,
  });

  notification.on("click", () => showOrCreateWindow());
  notification.show();
}

// ─── IPC handler registration ─────────────────────────────────────────────────

export function registerNotificationHandlers(): void {
  ipcMain.handle(IPC.NOTIFY, (_event, eventType: unknown, title: unknown, body: unknown) => {
    if (
      typeof eventType === "string" &&
      typeof title === "string" &&
      typeof body === "string"
    ) {
      sendNotification(eventType as NotificationEventType, title, body);
    }
  });
}

// ─── App lifecycle integration ────────────────────────────────────────────────

/**
 * Called at app.ready to request notification permission on macOS.
 * On Linux/Windows, Notification.isSupported() handles availability.
 */
export function initializeNotifications(): void {
  if (!Notification.isSupported()) {
    console.log("[desktop/notifications] native notifications not supported on this platform");
  }
}
