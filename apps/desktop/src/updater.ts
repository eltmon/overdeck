/**
 * Auto-updater service using electron-updater.
 *
 * Handles automatic background checks for updates, downloads, and installation.
 * Uses GitHub Releases as the update server.
 */

import { autoUpdater, UpdateInfo } from "electron-updater";
import { BrowserWindow } from "electron";

// Auto-updater configuration
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

let checkIntervalId: ReturnType<typeof setInterval> | null = null;
let initialized = false;

// Update state for IPC bridge
export interface UpdateStatus {
  checking: boolean;
  available: boolean;
  downloaded: boolean;
  version: string | null;
  error: string | null;
}

export let currentStatus: UpdateStatus = {
  checking: false,
  available: false,
  downloaded: false,
  version: null,
  error: null,
};

// Callbacks for update events
type UpdateStatusCallback = (status: UpdateStatus) => void;
let statusCallbacks: UpdateStatusCallback[] = [];

/**
 * Register a callback to receive update status changes.
 */
export function onUpdateStatusChange(callback: UpdateStatusCallback): void {
  statusCallbacks.push(callback);
}

/**
 * Notify all listeners of status change
 */
function notifyStatusChange(): void {
  for (const cb of statusCallbacks) {
    cb(currentStatus);
  }
}

/**
 * Send update event to all browser windows
 */
function broadcastToRenderers(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}

/**
 * Initialize the auto-updater service.
 * Sets up event handlers and starts periodic update checks.
 */
export function initializeAutoUpdater(channel: string = "latest"): void {
  if (initialized) {
    console.log("[updater] Already initialized, skipping...");
    return;
  }
  initialized = true;

  // Configure to use GitHub Releases
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "eltmon",
    repo: "panopticon-cli",
  });

  // Respect release channel so canary users don't get stable updates and vice versa
  autoUpdater.channel = channel;

  // Don't auto-download - we want to notify user first
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Set up event handlers
  autoUpdater.on("checking-for-update", () => {
    currentStatus = { ...currentStatus, checking: true, error: null };
    notifyStatusChange();
    broadcastToRenderers("update-status", currentStatus);
    console.log("[updater] Checking for update...");
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    currentStatus = {
      checking: false,
      available: true,
      downloaded: false,
      version: info.version,
      error: null,
    };
    notifyStatusChange();
    broadcastToRenderers("update-status", currentStatus);
    console.log(`[updater] Update available: ${info.version}`);
  });

  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    currentStatus = {
      checking: false,
      available: false,
      downloaded: false,
      version: info.version,
      error: null,
    };
    notifyStatusChange();
    broadcastToRenderers("update-status", currentStatus);
    console.log(`[updater] Update not available. Current version: ${info.version}`);
  });

  autoUpdater.on("download-progress", (progressObj) => {
    const percent = progressObj.percent.toFixed(1);
    currentStatus = { ...currentStatus, checking: false };
    notifyStatusChange();
    broadcastToRenderers("update-download-progress", {
      percent,
      transferred: progressObj.transferred,
      total: progressObj.total,
    });
    console.log(`[updater] Download progress: ${percent}%`);
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    currentStatus = {
      checking: false,
      available: true,
      downloaded: true,
      version: info.version,
      error: null,
    };
    notifyStatusChange();
    broadcastToRenderers("update-status", currentStatus);
    broadcastToRenderers("update-downloaded", { version: info.version });
    console.log(`[updater] Update downloaded: ${info.version}`);
  });

  autoUpdater.on("error", (err: Error) => {
    currentStatus = {
      checking: false,
      available: false,
      downloaded: false,
      version: null,
      error: err.message,
    };
    notifyStatusChange();
    broadcastToRenderers("update-status", currentStatus);
    console.error("[updater] Error:", err.message);
  });

  // Check for updates on app startup (after a short delay to let the app initialize)
  setTimeout(() => {
    checkForUpdates();
  }, 3000);

  // Start periodic update checks
  startPeriodicChecks();
}

/**
 * Start periodic update checks every 4 hours.
 */
export function startPeriodicChecks(): void {
  if (checkIntervalId !== null) return; // Already running

  checkIntervalId = setInterval(() => {
    checkForUpdates();
  }, FOUR_HOURS_MS);

  console.log("[updater] Started periodic update checks (every 4 hours)");
}

/**
 * Stop periodic update checks.
 */
export function stopPeriodicChecks(): void {
  if (checkIntervalId !== null) {
    clearInterval(checkIntervalId);
    checkIntervalId = null;
    console.log("[updater] Stopped periodic update checks");
  }
}

/**
 * Check for updates manually.
 * Returns a promise that resolves when the check completes.
 */
export async function checkForUpdates(): Promise<void> {
  if (currentStatus.checking) {
    console.log("[updater] Already checking for update, skipping...");
    return;
  }

  try {
    console.log("[updater] Starting update check...");
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.error("[updater] Check for updates failed:", err);
  }
}

/**
 * Download the available update.
 */
export async function downloadUpdate(): Promise<void> {
  if (!currentStatus.available) {
    console.log("[updater] No update available to download");
    return;
  }

  try {
    console.log("[updater] Starting update download...");
    await autoUpdater.downloadUpdate();
  } catch (err) {
    console.error("[updater] Download update failed:", err);
  }
}

/**
 * Quit and install the downloaded update.
 */
export function quitAndInstall(): void {
  if (!currentStatus.downloaded) {
    console.log("[updater] No update downloaded to install");
    return;
  }

  console.log("[updater] Quitting and installing update...");
  autoUpdater.quitAndInstall();
}

/**
 * Get current update status.
 */
export function getUpdateStatus(): UpdateStatus {
  return currentStatus;
}
