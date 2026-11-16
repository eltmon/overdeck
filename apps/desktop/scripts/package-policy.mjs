/**
 * Packaging policy for the desktop app's staged dashboard server (PAN-5424).
 * Imported by prepare-server-resources.mjs and build-for-publish.mjs, and by
 * tests/unit/scripts/desktop-package-policy.test.ts.
 */

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
