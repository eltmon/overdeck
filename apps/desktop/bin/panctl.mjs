#!/usr/bin/env node
/**
 * panctl launcher — invoked via `npx @panctl/desktop` or `panctl` after installing `@panctl/desktop` globally.
 *
 * Responsibilities:
 *   1. Verify Node 22+ is running (Electron bundles Node 22).
 *   2. Verify the dashboard server bundle exists inside the package.
 *   3. Locate the electron binary installed alongside this package.
 *   4. Spawn Electron with dist-electron/main.js as the entry point.
 *
 * Missing tools (tmux, ttyd, etc.) are handled lazily by the app — no upfront
 * install step is required to open Command Deck.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDir = join(__dirname, "..");

// ─── Prerequisite checks ──────────────────────────────────────────────────────

/** Check Node.js major version is >= 22. */
function checkNodeVersion() {
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 22) {
    console.error(
      `[panctl] Node.js 22 or later is required (found ${process.versions.node}).`
    );
    console.error("  Update Node.js: https://nodejs.org");
    process.exit(1);
  }
}

/** Verify the dashboard server bundle exists inside the package. */
function checkServerBundle() {
  const serverPath = join(packageDir, "server", "server.js");
  if (!existsSync(serverPath)) {
    console.error("[panctl] Dashboard server bundle not found.");
    console.error(`  Expected: ${serverPath}`);
    console.error("  This package may not have been built correctly.");
    console.error("  Try reinstalling: npm install -g @panctl/desktop");
    process.exit(1);
  }
}

// ─── Electron launch ──────────────────────────────────────────────────────────

/** Resolve the electron binary from the local node_modules. */
function resolveElectron() {
  const require = createRequire(import.meta.url);
  try {
    // The `electron` package exports its binary path as its module value.
    return require("electron");
  } catch {
    console.error("[panctl] electron package not found.");
    console.error("  Try reinstalling: npm install -g @panctl/desktop");
    process.exit(1);
  }
}

function launch() {
  checkNodeVersion();
  checkServerBundle();

  const electronBin = resolveElectron();
  const mainEntry = join(packageDir, "dist-electron", "main.js");

  const child = spawn(electronBin, [mainEntry], {
    stdio: "inherit",
    env: {
      ...process.env,
      // Ensure terminal rendering works correctly inside Claude Code / tmux.
      TERM: process.env.TERM || "xterm-256color",
      COLORTERM: process.env.COLORTERM || "truecolor",
      LANG: process.env.LANG || "en_US.UTF-8",
    },
  });

  child.on("error", (err) => {
    console.error("[panctl] Failed to start:", err.message);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      // Propagate signal to caller.
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

launch();
