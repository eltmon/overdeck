/**
 * Packaging policy for the desktop app's staged dashboard server (PAN-5424).
 * Imported by prepare-server-resources.mjs and build-for-publish.mjs, and by
 * tests/unit/scripts/desktop-package-policy.test.ts.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/** Bare specifiers scanImportClosure must not treat as server externals. */
export const SERVER_SKIP_PACKAGES = new Set([
  "@effect/platform-bun", // bun-only dynamic import, never reached under Node
  "playwright", // lazy import, degrades gracefully (PAN-1645)
  "playwright-core",
  // Bundled into dist/dashboard/transformers.node-*.js; the scanner matches a
  // JSDoc `from "@huggingface/transformers"` in that chunk. Installing it drags
  // in ~720 MB of onnxruntime (PAN-5424). The server only reads fact vectors;
  // embedding runs from the CLI runtime, which keeps transformers (PAN-5358).
  "@huggingface/transformers",
]);

/** Packages that must never appear in server/node_modules (PAN-5424). */
export const FORBIDDEN_SERVER_PACKAGES = [
  "@huggingface/transformers",
  "onnxruntime-node",
  "onnxruntime-web",
  "onnxruntime-common",
];

const walkForbidden = (nodeModulesDir, baseDir, forbidden, hits) => {
  if (!existsSync(nodeModulesDir)) return;
  for (const name of forbidden) {
    const candidate = join(nodeModulesDir, name);
    if (existsSync(candidate)) hits.push(relative(baseDir, candidate));
  }
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("@")) {
      const scopeDir = join(nodeModulesDir, entry.name);
      for (const scoped of readdirSync(scopeDir, { withFileTypes: true })) {
        if (!scoped.isDirectory()) continue;
        walkForbidden(join(scopeDir, scoped.name, "node_modules"), baseDir, forbidden, hits);
      }
      continue;
    }
    walkForbidden(join(nodeModulesDir, entry.name, "node_modules"), baseDir, forbidden, hits);
  }
};

/**
 * Returns every `<…>/node_modules/<forbidden>` directory under nodeModulesDir,
 * including nested node_modules, as paths relative to nodeModulesDir. Empty
 * when nodeModulesDir does not exist.
 */
export const findForbiddenPackages = (nodeModulesDir, forbidden = FORBIDDEN_SERVER_PACKAGES) => {
  const hits = [];
  walkForbidden(nodeModulesDir, nodeModulesDir, forbidden, hits);
  return hits.sort();
};

/** npm's decimal-MB display cap for the published @overdeck/desktop tarball (PAN-5424). */
export const MAX_DESKTOP_TARBALL_BYTES = 300_000_000;

/**
 * Judges one `npm pack --dry-run --json` entry (or the statSync-derived
 * equivalent). Never throws. `size` above `limit` fails; `size === limit`
 * passes. A missing or non-numeric `size` fails closed.
 */
export const checkDesktopPackSize = (entry, limit = MAX_DESKTOP_TARBALL_BYTES) => {
  const size = entry?.size;
  const limitMb = (limit / 1e6).toFixed(1);
  if (typeof size !== "number" || !Number.isFinite(size)) {
    return {
      ok: false,
      message: `@overdeck/desktop tarball size could not be measured; limit ${limitMb} MB`,
    };
  }
  const unpackedSize = entry?.unpackedSize;
  const unpackedMb = typeof unpackedSize === "number" ? (unpackedSize / 1e6).toFixed(1) : "?";
  const entryCount = entry?.entryCount ?? "?";
  const message = `@overdeck/desktop tarball ${(size / 1e6).toFixed(1)} MB (unpacked ${unpackedMb} MB, ${entryCount} files); limit ${limitMb} MB`;
  return { ok: size <= limit, message };
};
