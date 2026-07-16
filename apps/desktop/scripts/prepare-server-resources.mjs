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
 *     @lydell/node-pty ships Node-API prebuilds, so the packaged server child
 *     can use the same platform package under stock Node and Electron.
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
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import Module, { createRequire } from "node:module";
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

// First-boot database migration SQL. The server resolves it as
// <packageRoot>/drizzle/... where packageRoot is one level above the bundle
// dir (resources/ in the packaged app, the package root in the npm flavor).
// Without it, a machine with no existing ~/.overdeck database crash-loops on
// first launch (PAN-2570 field reports).
const drizzleDest = join(desktopDir, "drizzle");
rmSync(drizzleDest, { recursive: true, force: true });
cpSync(join(repoRoot, "drizzle"), drizzleDest, { recursive: true });
console.log("[prepare-server] Copied migration SQL → drizzle/");

// ─── Stage the Claude Code hook bundle (PAN-2595) ─────────────────────────────
// Desktop installs never run `pan install`, so the dashboard server provisions
// the hooks at boot (src/lib/claude-hooks-provision.ts). It resolves them from
// SYNC_SOURCES.hooks = <packageRoot>/sync-sources/hooks — resources/ in the
// packaged app (extraResources maps sync-sources → sync-sources), the package
// root in the npx flavor (`files` includes sync-sources).
const hooksStageDir = join(desktopDir, "sync-sources");
rmSync(hooksStageDir, { recursive: true, force: true });
cpSync(join(repoRoot, "sync-sources", "hooks"), join(hooksStageDir, "hooks"), { recursive: true });
console.log("[prepare-server] Staged Claude hook bundle → sync-sources/hooks/");

// ─── Bare-specifier scan helpers (shared by supervisor + server staging) ──────

const builtins = new Set(Module.builtinModules);
const packageNameOf = (specifier) => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};
const VALID_PACKAGE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

// ─── Stage the PTY supervisor (PAN-2592) ──────────────────────────────────────
// Conversations and work agents wrap Claude in dist/pty-supervisor.js — a
// root-build artifact the server locates via resolvePtySupervisorScriptPath()
// (src/lib/channels/pty-supervisor-locate.ts). In the packaged layouts that
// resolver materializes server/supervisor/ into ${OVERDECK_HOME}/runtime/ and
// runs it under the HOST node (the tmux session outlives the app, and the
// AppImage mount is transient), so the vendored node-pty must keep its
// stock-Node multiarch prebuilds — do NOT reuse the Electron-ABI rebuild the
// dashboard server gets below, and do NOT name the vendor dir node_modules
// (npm pack strips nested node_modules from the npx flavor).
if (!existsSync(join(repoRoot, "dist/pty-supervisor.js"))) {
  console.error("[prepare-server] dist/pty-supervisor.js not found — run 'npm run build' at the repo root first.");
  process.exit(1);
}
const supervisorDir = join(serverDir, "supervisor");
mkdirSync(supervisorDir, { recursive: true });

// Walk the supervisor's relative-import closure over repo dist/ (the root
// build is code-split; shipping the entry alone cannot boot).
const supervisorSeen = new Set();
const supervisorQueue = ["pty-supervisor.js"];
const supervisorExternals = new Set();
while (supervisorQueue.length > 0) {
  const file = supervisorQueue.pop();
  if (supervisorSeen.has(file) || !existsSync(join(repoRoot, "dist", file))) continue;
  supervisorSeen.add(file);
  const source = readFileSync(join(repoRoot, "dist", file), "utf8");
  const specifiers = [
    ...source.matchAll(/from\s*["']([^"'\n]+)["']/g),
    ...source.matchAll(/import\(\s*["']([^"'\n]+)["']\s*\)/g),
    ...source.matchAll(/require\(\s*["']([^"'\n]+)["']\s*\)/g),
  ].map((match) => match[1]);
  for (const specifier of specifiers) {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const target = specifier.replace(/^\.\//, "");
      if (target.endsWith(".js") && !target.includes("/")) supervisorQueue.push(target);
      continue;
    }
    if (specifier.startsWith("node:")) continue;
    const packageName = packageNameOf(specifier);
    if (!VALID_PACKAGE.test(packageName)) continue;
    if (builtins.has(packageName)) continue;
    supervisorExternals.add(packageName);
  }
}
for (const file of supervisorSeen) {
  cpSync(join(repoRoot, "dist", file), join(supervisorDir, file));
}

// Guard: the supervisor must stay runnable from the vendored tree alone. A
// build change that adds a new external would ship a supervisor that cannot
// boot on user machines — fail the build instead of shipping it.
const SUPERVISOR_ALLOWED_EXTERNALS = new Set(["@lydell/node-pty"]);
const unexpectedExternals = [...supervisorExternals].filter((name) => !SUPERVISOR_ALLOWED_EXTERNALS.has(name));
if (unexpectedExternals.length > 0) {
  console.error(`[prepare-server] pty-supervisor gained unvendored externals: ${unexpectedExternals.join(", ")}`);
  console.error("  Vendor them in supervisor staging (and pty-supervisor-locate.ts) or bundle them into the artifact.");
  process.exit(1);
}
for (const packageName of supervisorExternals) {
  const packageDir = join(repoRoot, "node_modules", packageName);
  if (!existsSync(packageDir)) {
    console.error(`[prepare-server] Supervisor external '${packageName}' is not installed at the repo root.`);
    process.exit(1);
  }
  cpSync(packageDir, join(supervisorDir, "vendor", packageName), { recursive: true, dereference: true });
  const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const packageRequire = createRequire(realpathSync(join(packageDir, "package.json")));
  for (const optionalName of Object.keys(packageJson.optionalDependencies ?? {})) {
    let optionalEntry;
    try {
      optionalEntry = packageRequire.resolve(optionalName);
    } catch {
      continue; // Only the current platform's optional prebuild is installed.
    }
    let optionalDir = dirname(optionalEntry);
    while (optionalDir !== dirname(optionalDir) && !existsSync(join(optionalDir, "package.json"))) {
      optionalDir = dirname(optionalDir);
    }
    cpSync(optionalDir, join(supervisorDir, "vendor", optionalName), { recursive: true, dereference: true });
  }
}
console.log(
  `[prepare-server] Staged pty-supervisor (${supervisorSeen.size} chunks, vendored: ${[...supervisorExternals].join(", ") || "none"}) → server/supervisor/`,
);

// Smoke-run the supervisor in its MATERIALIZED form (vendor/ → node_modules/,
// isolated from the repo's node_modules so resolution can't silently fall back
// to it): a bare invocation must reach the usage error (exit 2), proving the
// chunk graph is complete and the vendored node-pty native import loads under
// the build host's node. Anything else means the packaged supervisor cannot
// boot on user machines — fail the build. Mirrors
// materializePtySupervisorRuntime() in src/lib/channels/pty-supervisor-locate.ts.
{
  const smokeDir = join(OS.tmpdir(), `overdeck-supervisor-smoke-${process.pid}`);
  rmSync(smokeDir, { recursive: true, force: true });
  mkdirSync(smokeDir, { recursive: true });
  for (const name of readdirSync(supervisorDir)) {
    if (name === "vendor") continue;
    cpSync(join(supervisorDir, name), join(smokeDir, name));
  }
  cpSync(join(supervisorDir, "vendor"), join(smokeDir, "node_modules"), { recursive: true });
  // realpath the entry: on macOS tmpdir is /var/folders → /private/var, and
  // the supervisor's run-as-main guard compares import.meta.url (canonical)
  // against argv[1] (as given) — a symlinked path exits 0 without running.
  const smokeEntry = realpathSync(join(smokeDir, "pty-supervisor.js"));
  let smokeStatus = 0;
  let smokeOutput = "";
  try {
    execSync(`node ${JSON.stringify(smokeEntry)}`, { stdio: "pipe" });
  } catch (error) {
    smokeStatus = error?.status ?? -1;
    smokeOutput = String(error?.stderr ?? error);
  }
  rmSync(smokeDir, { recursive: true, force: true });
  if (smokeStatus !== 2) {
    console.error(`[prepare-server] Materialized pty-supervisor smoke run returned exit ${String(smokeStatus)} — expected the usage error (2).`);
    if (smokeOutput) console.error(smokeOutput);
    process.exit(1);
  }
  console.log("[prepare-server] Verified: materialized pty-supervisor boots to its usage error under host node");
}

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

const seen = new Set();
const queue = ENTRY_POINTS.filter((entry) => existsSync(join(serverDir, entry)));
const packages = new Set();

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

const rootPkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
if (typeof rootPkg.version !== "string" || !rootPkg.version) {
  console.error("[prepare-server] Repo-root package.json has no version — cannot stamp the server stub");
  process.exit(1);
}

const desktopPkg = JSON.parse(readFileSync(join(desktopDir, "package.json"), "utf8"));
if (!(desktopPkg.devDependencies?.electron ?? desktopPkg.dependencies?.electron)) {
  console.error("[prepare-server] Cannot determine the Electron version from apps/desktop/package.json");
  process.exit(1);
}

writeFileSync(
  join(serverDir, "package.json"),
  `${JSON.stringify(
    {
      name: "@overdeck/desktop-server",
      // The dashboard's readPackageVersion() resolves the app version from the
      // nearest package.json above the bundle — this stub is that file in both
      // the packaged and npx layouts, so it must carry the version (PAN-2591).
      version: rootPkg.version,
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

const desktopRequire = Module.createRequire(join(desktopDir, "package.json"));

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

// @lydell/node-pty uses Node-API prebuilds, so one binary works across the
// supported Node and Electron runtimes without an ABI-specific rebuild. Load
// it under the actual Electron binary (ELECTRON_RUN_AS_NODE needs no display)
// so packaging fails before release if the platform prebuild is absent.
try {
  const electronBinary = desktopRequire("electron");
  execSync(`"${electronBinary}" -e "require('@lydell/node-pty')"`, {
    cwd: serverDir,
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  console.log("[prepare-server] Verified: @lydell/node-pty loads under Electron");
} catch (error) {
  if (error?.status) {
    console.error("[prepare-server] @lydell/node-pty failed to load under Electron.");
    process.exit(1);
  }
  console.warn("[prepare-server] electron binary not resolvable here — skipping the ABI load check");
}

console.log("[prepare-server] Done. server/ is ready for packaging.");
