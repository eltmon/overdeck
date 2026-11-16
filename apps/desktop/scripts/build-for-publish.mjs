/**
 * Build script for preparing the `overdeck` npm package for publishing.
 *
 * This script:
 *   1. Builds the Electron main/preload bundles via tsdown.
 *   2. Stages the dashboard server (entry + chunk graph + frontend assets)
 *      into apps/desktop/server/ via prepare-server-resources.mjs so it's
 *      included in the npm package. (npm pack includes server/node_modules,
 *      so its size counts toward the npm tarball — see step 4.)
 *   3. Promotes electron to dependencies for the published package.
 *   4. Measures the packed tarball (npm pack --dry-run --json) and fails
 *      over 300 MB (PAN-5424).
 *
 * Usage:
 *   cd apps/desktop && node scripts/build-for-publish.mjs
 *
 * Prerequisites:
 *   - `npm run build` must have been run at the repo root to build the
 *     dashboard server and frontend first.
 */

import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDesktopPackSize } from "./package-policy.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(__dirname, "..");

// ─── Build Electron bundles ───────────────────────────────────────────────────

console.log("[build-for-publish] Building Electron bundles...");
execSync("node node_modules/.bin/tsdown", {
  cwd: desktopDir,
  stdio: "inherit",
});

// ─── Stage dashboard server (entry + chunks + assets + node-pty) ──────────────

console.log("[build-for-publish] Staging dashboard server via prepare-server-resources.mjs");
execSync("node scripts/prepare-server-resources.mjs", {
  cwd: desktopDir,
  stdio: "inherit",
});

// ─── Promote electron to dependencies for the published package ───────────────
// electron-builder requires electron in devDependencies, but npx/global install
// users need it in dependencies so the launcher can require("electron").

const pkgPath = join(desktopDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (pkg.devDependencies?.electron) {
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies.electron = pkg.devDependencies.electron;
  delete pkg.devDependencies.electron;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log("[build-for-publish] Promoted electron to dependencies for publish");
}

// ─── Measure the packed tarball; fail before publishing anything oversized ────
// npm pack --dry-run --json returns a numeric [0].size on npm 10.9.4 and
// 11.21.2 (the release job's npm). If a future npm, or an unexpected dry-run
// shape, leaves size missing or non-numeric, fall back to a real pack.

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function measurePackedSize() {
  let dryRunOutput;
  try {
    dryRunOutput = execFileSync(npmCmd, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: desktopDir,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
      shell: process.platform === "win32",
    });
  } catch (error) {
    console.error(`[build-for-publish] npm pack --dry-run failed: ${error.message}`);
    dryRunOutput = undefined;
  }

  if (dryRunOutput !== undefined) {
    try {
      const parsed = JSON.parse(dryRunOutput);
      if (Array.isArray(parsed) && parsed[0] && typeof parsed[0].size === "number") {
        return parsed[0];
      }
    } catch {
      // Falls through to the real-pack fallback below.
    }
  }

  console.log("[build-for-publish] npm pack --dry-run did not return a usable size; falling back to a real npm pack");
  const packDestination = mkdtempSync(join(tmpdir(), "overdeck-desktop-pack-"));
  try {
    const packOutput = execFileSync(npmCmd, ["pack", "--ignore-scripts", "--pack-destination", packDestination], {
      cwd: desktopDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      shell: process.platform === "win32",
    });
    const tgzName = packOutput.trim().split("\n").pop()?.trim();
    if (!tgzName) return undefined;
    return { size: statSync(join(packDestination, tgzName)).size };
  } catch (error) {
    console.error(`[build-for-publish] Fallback npm pack failed: ${error.message}`);
    return undefined;
  } finally {
    rmSync(packDestination, { recursive: true, force: true });
  }
}

console.log("[build-for-publish] Measuring packed tarball size...");
const packResult = checkDesktopPackSize(measurePackedSize());
if (!packResult.ok) {
  console.error(`[build-for-publish] ${packResult.message}`);
  console.error("  Find the heavy dependency with: du -sh apps/desktop/server/node_modules/* | sort -h | tail");
  process.exit(1);
}
console.log(`[build-for-publish] ${packResult.message}`);

console.log("[build-for-publish] Done. Package is ready to publish:");
console.log("  cd apps/desktop && npm publish --access public");
