/**
 * Cross-platform browser opener.
 * Used by `npx panopticon serve` to open the dashboard URL after server starts.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function openBrowser(url: string): Promise<void> {
  let cmd: string;

  if (process.platform === "darwin") {
    cmd = `open "${url}"`;
  } else if (process.platform === "win32") {
    cmd = `start "" "${url}"`;
  } else {
    // Linux: try xdg-open first, fall back to sensible-browser
    cmd = `xdg-open "${url}" 2>/dev/null || sensible-browser "${url}" 2>/dev/null || true`;
  }

  await execAsync(cmd);
}
