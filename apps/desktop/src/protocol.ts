/**
 * overdeck:// custom protocol for serving static frontend assets in packaged builds.
 *
 * In dev mode:
 *   BrowserWindow loads from Vite dev server URL (VITE_DEV_SERVER_URL env var).
 *   HMR and source maps work normally.
 *
 * In packaged builds:
 *   BrowserWindow loads overdeck://app/index.html.
 *   This protocol handler serves files from the bundled dist/dashboard/public/.
 *   WebSocket connections (ws/rpc, ws/terminal) go to the embedded server port
 *   on localhost — the protocol handler only serves static assets.
 *
 * Security:
 *   - Path traversal protection: rejects paths containing ".."
 *   - Only files within the static root are served
 *   - Non-existent asset requests return -6 (net::ERR_FILE_NOT_FOUND)
 *   - HTML routes (no extension) fall back to index.html for SPA routing
 *
 * CSP:
 *   Renderer CSP is configured via vite.config.ts in the frontend.
 *   In packaged mode, connect-src must include ws://127.0.0.1:* for WebSocket.
 */

import * as FS from "node:fs";
import * as Path from "node:path";

import { protocol } from "electron";

import { DESKTOP_SCHEME, resolveServerStaticDir } from "./main.js";

let registered = false;

// ─── Path resolution ──────────────────────────────────────────────────────────

export function resolveStaticPath(staticRoot: string, requestUrl: string): string {
  const fallbackIndex = Path.join(staticRoot, "index.html");

  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return fallbackIndex;
  }

  const rawPath = decodeURIComponent(url.pathname);
  const normalized = Path.posix.normalize(rawPath).replace(/^\/+/, "");

  if (normalized.includes("..")) {
    return fallbackIndex;
  }

  const requestedPath = normalized.length > 0 ? normalized : "index.html";
  const resolved = Path.resolve(staticRoot, requestedPath);

  const staticRootResolved = Path.resolve(staticRoot);
  const inRoot =
    resolved === staticRootResolved ||
    resolved.startsWith(staticRootResolved + Path.sep);

  if (!inRoot) return fallbackIndex;

  // If path has a file extension, serve it (or 404)
  if (Path.extname(resolved)) {
    return resolved;
  }

  // SPA route: check for index.html in subdirectory, else root index
  const nestedIndex = Path.join(resolved, "index.html");
  if (FS.existsSync(nestedIndex)) return nestedIndex;

  return fallbackIndex;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register the overdeck:// protocol handler.
 * Must be called after app.ready (but registration via registerSchemesAsPrivileged
 * must happen before app.ready — done in main.ts).
 */
export function registerDesktopProtocol(): void {
  if (registered) return;

  const staticRoot = resolveServerStaticDir();
  if (!staticRoot) {
    console.error(
      "[desktop/protocol] Static bundle not found — packaged frontend assets missing. " +
        "Run 'npm run build:dashboard' first.",
    );
    return;
  }

  const fallbackIndex = Path.join(staticRoot, "index.html");

  protocol.registerFileProtocol(DESKTOP_SCHEME, (request, callback) => {
    const candidate = resolveStaticPath(staticRoot, request.url);
    const hasExt = Path.extname(candidate).length > 0;

    if (!FS.existsSync(candidate)) {
      if (hasExt) {
        // Asset not found — return 404
        callback({ error: -6 /* net::ERR_FILE_NOT_FOUND */ });
      } else {
        // SPA route — fall back to index
        callback({ path: fallbackIndex });
      }
      return;
    }

    callback({ path: candidate });
  });

  registered = true;
  console.log(`[desktop/protocol] registered ${DESKTOP_SCHEME}:// serving from ${staticRoot}`);
}
