"use strict";

/**
 * electron-builder afterPack hook.
 * Runs electron-rebuild to recompile node-pty for Electron's bundled Node version.
 */
const { execSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const electronVersion = context.electronPlatformName
    ? context.packager.electronVersion
    : process.versions.electron;

  console.log(`[afterPack] Rebuilding native addons for Electron ${electronVersion}`);

  try {
    execSync(
      `electron-rebuild --version ${electronVersion} --module-dir .`,
      {
        cwd: path.resolve(__dirname, ".."),
        stdio: "inherit",
      }
    );
    console.log("[afterPack] Native addon rebuild complete");
  } catch (err) {
    console.error("[afterPack] Native addon rebuild failed:", err.message);
    // Don't throw — rebuild failure shouldn't block packaging
  }
};
