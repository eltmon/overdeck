/**
 * Stage the dashboard server for desktop packaging (PAN-2561).
 *
 * The dashboard server build (src/dashboard/server/tsdown.config.ts) is
 * multi-entry and code-split: dist/dashboard/server.js statically imports
 * sibling rolldown chunks, and spawns the deacon/worker entries by path.
 * Shipping server.js alone (the pre-PAN-2561 packaging) can never boot.
 *
 * This script assembles apps/desktop/server/ (gitignored) from the repo-root
 * build output:
 *   - dist/dashboard/*.js       → server/          (entry + full chunk graph)
 *   - dist/dashboard/public/    → server/public/
 *   - server/package.json       ({type: "module"} so the chunks load as ESM)
 *   - server/node_modules/ holding the runtime deps the bundle externalizes.
 *     The externals are DISCOVERED by scanning the reachable chunk graph for
 *     bare import specifiers (so a build-config change cannot silently ship a
 *     broken package), then installed at the repo's installed versions.
 *     node-pty is additionally rebuilt for the ELECTRON ABI: the packaged
 *     server child runs under the Electron binary with ELECTRON_RUN_AS_NODE=1,
 *     which reports Electron's NODE_MODULE_VERSION (143 for Electron 40), not
 *     stock Node's — so a stock-Node build cannot be reused.
 *
 * Deliberately skipped externals: bun-only modules (never imported under
 * Node), and playwright (lazy import for artifact thumbnails, PAN-1645 —
 * degrades gracefully and would drag in browser binaries).
 *
 * Consumed by electron-builder extraResources ({from: "server", to: "server"})
 * and by build-for-publish.mjs for the npm package (npm pack strips nested
 * node_modules — the npx flavor's node-pty story is tracked on PAN-2561).
 *
 * Prerequisite: `npm run build` at the repo root.
 */

import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import Module from "node:module";
import * as OS from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(__dirname, "..");
const repoRoot = resolve(desktopDir, "../..");
const distDashboard = join(repoRoot, "dist/dashboard");
const serverDir = join(desktopDir, "server");

// ─── Preflight ────────────────────────────────────────────────────────────────

if (!existsSync(join(distDashboard, "server.js"))) {
  console.error(`[prepare-server] Dashboard server not found: ${join(distDashboard, "server.js")}`);
  console.error("  Run 'npm run build' at the repo root first.");
  process.exit(1);
}
if (!existsSync(join(distDashboard, "public/index.html"))) {
  console.error(`[prepare-server] Frontend assets not found: ${join(distDashboard, "public")}`);
  console.error("  Run 'npm run build' at the repo root first.");
  process.exit(1);
}

// ─── Copy chunk graph + static assets ─────────────────────────────────────────

rmSync(serverDir, { recursive: true, force: true });
mkdirSync(serverDir, { recursive: true });

// The tsdown config uses clean:false, so a long-lived local dist/dashboard can
// accumulate stale chunk hashes. Copying them is harmless (unreferenced); CI
// builds from a fresh checkout so the packaged graph is exact there.
const jsFiles = readdirSync(distDashboard, { withFileTypes: true }).filter(
  (entry) => entry.isFile() && entry.name.endsWith(".js"),
);
for (const entry of jsFiles) {
  cpSync(join(distDashboard, entry.name), join(serverDir, entry.name));
}
console.log(`[prepare-server] Copied ${jsFiles.length} server chunks → server/`);

cpSync(join(distDashboard, "public"), join(serverDir, "public"), { recursive: true });
console.log("[prepare-server] Copied frontend assets → server/public/");

// ─── Discover externalized runtime deps ───────────────────────────────────────
// Walk the chunk graph reachable from the build's entry points and collect
// bare import specifiers. dist/dashboard may contain stale chunks from prior
// builds (tsdown clean:false), so only reachable files count.

const ENTRY_POINTS = [
  "server.js",
  "deacon.js",
  "dashboard-db-worker.js",
  "checkpoint-worker.js",
  "memory-fts-worker.js",
];
const SKIP_PACKAGES = new Set([
  "@effect/platform-bun", // bun-only dynamic import, never reached under Node
  "playwright", // lazy import, degrades gracefully (PAN-1645)
  "playwright-core",
]);

const builtins = new Set(Module.builtinModules);
const seen = new Set();
const queue = ENTRY_POINTS.filter((entry) => existsSync(join(serverDir, entry)));
const packages = new Set();

const packageNameOf = (specifier) => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};
const VALID_PACKAGE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

while (queue.length > 0) {
  const file = queue.pop();
  if (seen.has(file) || !existsSync(join(serverDir, file))) continue;
  seen.add(file);
  const source = readFileSync(join(serverDir, file), "utf8");
  const specifiers = [
    ...source.matchAll(/from\s*["']([^"'\n]+)["']/g),
    ...source.matchAll(/import\(\s*["']([^"'\n]+)["']\s*\)/g),
    ...source.matchAll(/require\(\s*["']([^"'\n]+)["']\s*\)/g),
  ].map((match) => match[1]);
  for (const specifier of specifiers) {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const target = specifier.replace(/^\.\//, "");
      if (target.endsWith(".js") && !target.includes("/")) queue.push(target);
      continue;
    }
    if (specifier.startsWith("node:") || specifier.startsWith("bun:")) continue;
    const packageName = packageNameOf(specifier);
    if (!VALID_PACKAGE.test(packageName)) continue; // string literal noise in minified code
    if (builtins.has(packageName) || SKIP_PACKAGES.has(packageName)) continue;
    packages.add(packageName);
  }
}

// Pin each external to the version actually installed at the repo root, so
// the packaged server runs exactly what `pan up` runs. An external the root
// doesn't have installed is one the live server also runs without (e.g. ws's
// optional try/catch-guarded bufferutil) — skip it for parity.
const dependencies = {};
for (const packageName of [...packages].sort()) {
  const manifestPath = join(repoRoot, "node_modules", packageName, "package.json");
  if (!existsSync(manifestPath)) {
    console.warn(`[prepare-server] Skipping '${packageName}' — imported by the bundle but not installed at the repo root (matching pan up)`);
    continue;
  }
  dependencies[packageName] = JSON.parse(readFileSync(manifestPath, "utf8")).version;
}
console.log(
  `[prepare-server] Externalized deps (${seen.size} reachable chunks): ${Object.entries(dependencies)
    .map(([name, version]) => `${name}@${version}`)
    .join(", ")}`,
);

// ─── Install externals; rebuild node-pty for the Electron ABI ─────────────────

const desktopPkg = JSON.parse(readFileSync(join(desktopDir, "package.json"), "utf8"));
// electron lives in devDependencies normally, but build-for-publish.mjs
// promotes it to dependencies for the npm package — and npm publish re-runs
// this script via prepublishOnly after that promotion.
const electronRange = desktopPkg.devDependencies?.electron ?? desktopPkg.dependencies?.electron;
if (!electronRange) {
  console.error("[prepare-server] Cannot determine the Electron version from apps/desktop/package.json");
  process.exit(1);
}
const electronVersion = electronRange.replace(/^[\^~]/, "");

writeFileSync(
  join(serverDir, "package.json"),
  `${JSON.stringify(
    {
      name: "@overdeck/desktop-server",
      private: true,
      type: "module",
      dependencies,
    },
    null,
    2,
  )}\n`,
);

console.log("[prepare-server] Installing externalized deps...");
execSync("npm install --omit=dev --no-audit --no-fund", {
  cwd: serverDir,
  stdio: "inherit",
});

// The npm tarball ships prebuilds only for stock-Node ABIs, but the packaged
// server child runs under the Electron binary (ELECTRON_RUN_AS_NODE=1) whose
// NODE_MODULE_VERSION is Electron's own (143 for Electron 40). Compile from
// source for that ABI; node-pty's runtime loader falls back to
// build/Release/pty.node when no matching prebuild exists.
//
// Use @electron/rebuild's programmatic API rather than a `npx electron-rebuild`
// shell-out: bun's workspace install does not reliably link the scoped
// package's bin where npx/PATH can see it on CI (the v0.45.3 failure), and
// the in-process call also removes shell-quoting and Windows .cmd-shim
// concerns. Resolve the tool from the workspace when bun did link it; fall
// back to a private npm install (npm's linking is deterministic everywhere).
console.log(`[prepare-server] Rebuilding node-pty for Electron ${electronVersion}...`);
const rebuildRange =
  desktopPkg.devDependencies?.["@electron/rebuild"] ?? desktopPkg.dependencies?.["@electron/rebuild"];
if (!rebuildRange) {
  console.error("[prepare-server] @electron/rebuild is missing from apps/desktop/package.json");
  process.exit(1);
}

const desktopRequire = Module.createRequire(join(desktopDir, "package.json"));
let rebuild;
try {
  ({ rebuild } = desktopRequire("@electron/rebuild"));
} catch {
  const toolsDir = join(OS.tmpdir(), "overdeck-desktop-rebuild-tools");
  console.log(`[prepare-server] @electron/rebuild not resolvable from the workspace — installing into ${toolsDir}`);
  mkdirSync(toolsDir, { recursive: true });
  writeFileSync(
    join(toolsDir, "package.json"),
    `${JSON.stringify(
      { name: "overdeck-desktop-rebuild-tools", private: true, dependencies: { "@electron/rebuild": rebuildRange } },
      null,
      2,
    )}\n`,
  );
  execSync("npm install --omit=dev --no-audit --no-fund", { cwd: toolsDir, stdio: "inherit" });
  ({ rebuild } = Module.createRequire(join(toolsDir, "package.json"))("@electron/rebuild"));
}

await rebuild({
  buildPath: serverDir,
  electronVersion,
  force: true,
  onlyModules: ["@homebridge/node-pty-prebuilt-multiarch"],
});

const ptyBinary = join(
  serverDir,
  "node_modules/@homebridge/node-pty-prebuilt-multiarch/build/Release/pty.node",
);
if (!existsSync(ptyBinary)) {
  console.error(`[prepare-server] node-pty native binary missing: ${ptyBinary}`);
  console.error("  The electron-targeted rebuild did not produce a build/Release/pty.node.");
  process.exit(1);
}

// Prune node-pty's prebuilds/ and @electron/rebuild's bin/ artifact dirs.
// Neither is on the runtime path we ship (no electron-ABI prebuild exists, so
// the loader always falls back to build/Release), and bin/ contains a file
// HARDLINKED to build/Release/pty.node — intra-package hardlinks make npm
// publish fail with "415 Hard link is not allowed" (the v0.45.4 npm failure).
const ptyPackageDir = join(serverDir, "node_modules/@homebridge/node-pty-prebuilt-multiarch");
rmSync(join(ptyPackageDir, "prebuilds"), { recursive: true, force: true });
rmSync(join(ptyPackageDir, "bin"), { recursive: true, force: true });

// Break any remaining intra-tree hardlinks the same way: rewrite multi-link
// files as independent copies so `npm pack` never emits hard-link tar entries.
const breakHardLinks = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      breakHardLinks(entryPath);
    } else if (entry.isFile() && statSync(entryPath).nlink > 1) {
      const content = readFileSync(entryPath);
      const mode = statSync(entryPath).mode;
      rmSync(entryPath);
      writeFileSync(entryPath, content, { mode });
    }
  }
};
breakHardLinks(serverDir);

// Belt-and-suspenders ABI check: a fresh npm install also leaves a stock-Node
// prebuild copied to build/Release, so existence alone cannot prove the
// rebuild ran. Load the binary under the actual Electron binary when it is
// resolvable (ELECTRON_RUN_AS_NODE needs no display).
try {
  const electronBinary = desktopRequire("electron");
  execSync(`"${electronBinary}" -e "require(process.env.PTY_BINARY)"`, {
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PTY_BINARY: ptyBinary },
  });
  console.log("[prepare-server] Verified: pty.node loads under the Electron ABI");
} catch (error) {
  if (error?.status) {
    console.error("[prepare-server] pty.node failed to load under the Electron binary — wrong ABI.");
    process.exit(1);
  }
  console.warn("[prepare-server] electron binary not resolvable here — skipping the ABI load check");
}

console.log("[prepare-server] Done. server/ is ready for packaging.");
