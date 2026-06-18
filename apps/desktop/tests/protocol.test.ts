/**
 * Unit tests for resolveStaticPath (protocol.ts).
 *
 * resolveStaticPath is security-critical: it prevents path-traversal attacks
 * when serving static assets via the overdeck:// custom protocol.
 *
 * Mocks 'electron' and './main.js' so we can test the pure path logic
 * without launching the app.
 */

import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("electron", () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
}));

vi.mock("../src/main.js", () => ({
  DESKTOP_SCHEME: "overdeck",
  resolveServerStaticDir: () => "/fake/static",
}));

// Import after mocks
import { resolveStaticPath } from "../src/protocol.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let staticRoot = "";

function touch(relPath: string): string {
  const full = Path.join(staticRoot, relPath);
  FS.mkdirSync(Path.dirname(full), { recursive: true });
  FS.writeFileSync(full, "");
  return full;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("resolveStaticPath", () => {
  beforeEach(() => {
    staticRoot = FS.mkdtempSync(Path.join(OS.tmpdir(), "pan-protocol-"));
    // Create index.html at root (used as fallback)
    touch("index.html");
  });

  afterEach(() => {
    FS.rmSync(staticRoot, { recursive: true, force: true });
  });

  it("resolves a normal asset path", () => {
    touch("assets/main.js");
    const result = resolveStaticPath(
      staticRoot,
      `overdeck://app/assets/main.js`,
    );
    expect(result).toBe(Path.join(staticRoot, "assets/main.js"));
  });

  it("rejects path traversal — returns fallback index.html", () => {
    const result = resolveStaticPath(
      staticRoot,
      `overdeck://app/../../etc/passwd`,
    );
    expect(result).toBe(Path.join(staticRoot, "index.html"));
  });

  it("rejects encoded path traversal (%2F..%2F)", () => {
    const result = resolveStaticPath(
      staticRoot,
      `overdeck://app/%2F..%2F..%2Fetc%2Fpasswd`,
    );
    expect(result).toBe(Path.join(staticRoot, "index.html"));
  });

  it("returns index.html for empty path (SPA root)", () => {
    const result = resolveStaticPath(staticRoot, `overdeck://app/`);
    expect(result).toBe(Path.join(staticRoot, "index.html"));
  });

  it("returns root index.html for unknown SPA route (no extension)", () => {
    // /settings has no file extension and no nested index.html
    const result = resolveStaticPath(staticRoot, `overdeck://app/settings`);
    expect(result).toBe(Path.join(staticRoot, "index.html"));
  });

  it("returns nested index.html when present for SPA subroute", () => {
    touch("subapp/index.html");
    const result = resolveStaticPath(staticRoot, `overdeck://app/subapp`);
    expect(result).toBe(Path.join(staticRoot, "subapp/index.html"));
  });

  it("returns the file path for asset with extension (even if not on disk)", () => {
    // File doesn't exist — protocol handler will return 404; resolver just resolves the path
    const result = resolveStaticPath(
      staticRoot,
      `overdeck://app/missing.css`,
    );
    expect(result).toBe(Path.join(staticRoot, "missing.css"));
    // Must be within staticRoot
    expect(result.startsWith(staticRoot + Path.sep) || result === staticRoot).toBe(true);
  });

  it("falls back to index.html for an invalid URL", () => {
    const result = resolveStaticPath(staticRoot, "not a url at all %%%");
    expect(result).toBe(Path.join(staticRoot, "index.html"));
  });

  it("resolves path that looks out-of-root after normalization to fallback", () => {
    // Construct a URL whose resolved path would escape staticRoot
    const escapeAttempt = `overdeck://app/${encodeURIComponent("../secret")}`;
    const result = resolveStaticPath(staticRoot, escapeAttempt);
    expect(result).toBe(Path.join(staticRoot, "index.html"));
  });
});
