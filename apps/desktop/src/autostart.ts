/**
 * Auto-start nag flow for the Overdeck desktop app.
 *
 * Flow:
 *   Launch 1:   Full explanation dialog (warm, inviting)
 *   Launch 2-5: In-app toasts dispatched to renderer via "auto-start-nag:<n>:<max>" menu action
 *               - Shows: "Reminder N of 5", Enable button (prominent), Not Yet, Stop Reminding Me
 *   After 5 or "Stop reminding me": never prompt again (nagDismissed = true)
 *   Once enabled: auto-start registered via app.setLoginItemSettings
 *
 * State tracked in DesktopSettings.autoStart via settings.ts.
 */

import { app, dialog } from "electron";

import { getDesktopSettings, updateDesktopSetting } from "./settings.js";
import { dispatchMenuAction } from "./main.js";

const NAG_MAX = 5;

// ─── Enable auto-start ────────────────────────────────────────────────────────

export function enableAutoStart(): void {
  updateDesktopSetting("autoStart.enabled", true);
  updateDesktopSetting("autoStart.nagDismissed", true);
  app.setLoginItemSettings({ openAtLogin: true });
}

export function dismissAutoStartNag(): void {
  updateDesktopSetting("autoStart.nagDismissed", true);
}

// ─── Nag flow ─────────────────────────────────────────────────────────────────

export function handleAutoStartNag(): void {
  const { autoStart } = getDesktopSettings();

  if (autoStart.enabled || autoStart.nagDismissed) return;
  if (autoStart.nagCount >= NAG_MAX) {
    updateDesktopSetting("autoStart.nagDismissed", true);
    return;
  }

  const count = autoStart.nagCount + 1;
  updateDesktopSetting("autoStart.nagCount", count);

  if (count === 1) {
    // First launch: native dialog
    showFirstLaunchDialog();
  } else {
    // Subsequent launches: in-app toast dispatched to renderer
    // Dispatched with delay to let the window finish loading
    setTimeout(() => {
      dispatchMenuAction(`auto-start-nag:${count}:${NAG_MAX}`);
    }, 3_500);
  }
}

function showFirstLaunchDialog(): void {
  // Delay until window is ready
  setTimeout(() => {
    void dialog
      .showMessageBox({
        type: "info",
        title: "Start Overdeck automatically?",
        message: "Keep an eye on your agents — even when you forget to open the app.",
        detail:
          "Overdeck can start automatically when you log in, so you never miss an agent " +
          "asking for help or a merge that's ready to ship.\n\n" +
          "You can change this at any time in Settings → Desktop → Auto-start.",
        buttons: ["Enable Auto-start", "Not Yet"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          enableAutoStart();
        }
      });
  }, 2_000);
}
