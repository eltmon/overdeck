import { existsSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";

/**
 * Wait until all required files exist and an optional TCP port is open.
 * @param {Object} opts
 * @param {string} opts.baseDir
 * @param {string[]} opts.files
 * @param {number} [opts.tcpPort]
 * @param {number} [opts.pollMs]
 * @param {number} [opts.timeoutMs]
 */
export async function waitForResources({
  baseDir,
  files,
  tcpPort,
  pollMs = 200,
  timeoutMs = 120_000,
}) {
  const start = Date.now();

  while (true) {
    const elapsed = Date.now() - start;
    if (elapsed > timeoutMs) {
      throw new Error(`Timed out waiting for resources after ${timeoutMs}ms`);
    }

    const missingFiles = files.filter((f) => !existsSync(join(baseDir, f)));
    if (missingFiles.length > 0) {
      await sleep(pollMs);
      continue;
    }

    if (tcpPort) {
      const open = await isTcpPortOpen("127.0.0.1", tcpPort);
      if (!open) {
        await sleep(pollMs);
        continue;
      }
    }

    break;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTcpPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
