/**
 * Build script for preparing the `overdeck` npm package for publishing.
 *
 * This script:
 *   1. Builds the Electron main/preload bundles via tsdown.
 *   2. Stages the dashboard server (entry + chunk graph + frontend assets)
 *      into apps/desktop/server/ via prepare-server-resources.mjs so it's
 *      included in the npm package. (npm pack strips server/node_modules, so
 *      the npx flavor's node-pty resolution is tracked on PAN-2561.)
 *
 * Usage:
 *   cd apps/desktop && node scripts/build-for-publish.mjs
 *
 * Prerequisites:
 *   - `npm run build` must have been run at the repo root to build the
 *     dashboard server and frontend first.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

console.log("[build-for-publish] Done. Package is ready to publish:");
console.log("  cd apps/desktop && npm publish --access public");
