/**
 * Build script for preparing the `panctl` npm package for publishing.
 *
 * This script:
 *   1. Builds the Electron main/preload bundles via tsdown.
 *   2. Copies the dashboard server bundle (dist/dashboard/server.js) into
 *      apps/desktop/server/server.js so it's included in the npm package.
 *   3. Copies the compiled frontend assets (dist/dashboard/public/) into
 *      apps/desktop/server/public/ so the Electron app can serve them.
 *
 * Usage:
 *   cd apps/desktop && node scripts/build-for-publish.mjs
 *
 * Prerequisites:
 *   - `npm run build` must have been run at the repo root to build the
 *     dashboard server and frontend first.
 */

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(__dirname, "..");
const repoRoot = resolve(desktopDir, "../..");

// ─── Build Electron bundles ───────────────────────────────────────────────────

console.log("[build-for-publish] Building Electron bundles...");
execSync("node node_modules/.bin/tsdown", {
  cwd: desktopDir,
  stdio: "inherit",
});

// ─── Copy dashboard server bundle ─────────────────────────────────────────────

const serverSrc = join(repoRoot, "dist/dashboard/server.js");
const serverDest = join(desktopDir, "server/server.js");

if (!existsSync(serverSrc)) {
  console.error(`[build-for-publish] Dashboard server not found: ${serverSrc}`);
  console.error("  Run 'npm run build' at the repo root first.");
  process.exit(1);
}

const serverDir = join(desktopDir, "server");
mkdirSync(serverDir, { recursive: true });

console.log(`[build-for-publish] Copying server bundle → server/server.js`);
cpSync(serverSrc, serverDest);

// ─── Copy frontend static assets ─────────────────────────────────────────────

const publicSrc = join(repoRoot, "dist/dashboard/public");
const publicDest = join(desktopDir, "server/public");

if (!existsSync(join(publicSrc, "index.html"))) {
  console.error(`[build-for-publish] Frontend assets not found: ${publicSrc}`);
  console.error("  Run 'npm run build' at the repo root first.");
  process.exit(1);
}

console.log("[build-for-publish] Copying frontend assets → server/public/");
if (existsSync(publicDest)) {
  rmSync(publicDest, { recursive: true });
}
cpSync(publicSrc, publicDest, { recursive: true });

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
