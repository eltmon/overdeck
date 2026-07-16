/**
 * Verify the CLI from the built Linux AppImage, using its bundled Electron as
 * Node. This runs after electron-builder so staging-only success cannot mask a
 * broken extraResources layout.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import * as OS from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");
const desktopPkg = JSON.parse(readFileSync(join(desktopDir, "package.json"), "utf8"));
const appImage = join(desktopDir, "dist", `${desktopPkg.build.productName}-${desktopPkg.version}.AppImage`);

if (!existsSync(appImage)) {
  throw new Error(`[smoke-appimage-cli] AppImage not found: ${appImage}`);
}

const smokeRoot = mkdtempSync(join(OS.tmpdir(), "overdeck-appimage-smoke-"));
try {
  execFileSync(appImage, ["--appimage-extract"], {
    cwd: smokeRoot,
    // AppImage extraction prints every file path; discard that multi-megabyte
    // listing so execFileSync's output buffer cannot terminate a valid build.
    stdio: "ignore",
  });

  const appDir = join(smokeRoot, "squashfs-root");
  const packageManifest = join(appDir, "resources", "package.json");
  const cliEntry = join(appDir, "resources", "dist", "cli", "index.js");
  const cliModules = join(appDir, "resources", "dist", "node_modules");
  for (const requiredPath of [packageManifest, cliEntry, cliModules]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`[smoke-appimage-cli] Packaged CLI path missing: ${requiredPath}`);
    }
  }

  const appRun = readFileSync(join(appDir, "AppRun"), "utf8");
  const binaryName = appRun.match(/^BIN="\$APPDIR\/([^"/]+)"$/m)?.[1];
  if (!binaryName) {
    throw new Error("[smoke-appimage-cli] Could not resolve the bundled Electron binary from AppRun");
  }

  const smokeHome = join(smokeRoot, "home");
  mkdirSync(smokeHome);
  const version = execFileSync(join(appDir, binaryName), [cliEntry, "--version"], {
    cwd: appDir,
    encoding: "utf8",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      OVERDECK_HOME: smokeHome,
    },
  }).trim();

  if (version !== desktopPkg.version) {
    throw new Error(`[smoke-appimage-cli] Packaged CLI returned version '${version}', expected '${desktopPkg.version}'`);
  }
  console.log(`[smoke-appimage-cli] Verified packaged CLI under bundled Electron: ${version}`);
} finally {
  rmSync(smokeRoot, { recursive: true, force: true });
}
