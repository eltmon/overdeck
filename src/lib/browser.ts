/**
 * Cross-platform browser opener.
 * Used by `npx panopticon serve` to open the dashboard URL after server starts.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function openBrowser(url: string): Promise<void> {
  if (process.platform === "darwin") {
    await execFileAsync("open", [url]);
  } else if (process.platform === "win32") {
    // cmd.exe /c start is the standard way; /b runs without a new window
    await execFileAsync("cmd", ["/c", "start", "", url]);
  } else {
    // Linux: try xdg-open, fall back to sensible-browser
    try {
      await execFileAsync("xdg-open", [url]);
    } catch {
      try {
        await execFileAsync("sensible-browser", [url]);
      } catch {
        // Best-effort: ignore if neither is available
      }
    }
  }
}
