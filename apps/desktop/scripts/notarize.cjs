"use strict";

/**
 * electron-builder afterSign hook — notarize the signed macOS .app with
 * Apple's notary service, then staple the ticket.
 *
 * Runs ONLY when App Store Connect API-key credentials are present in the
 * environment. Without them it no-ops with a log line, so local `dist:mac`
 * builds and any CI run without the secrets still succeed (ad-hoc / unsigned,
 * exactly as before) instead of failing the whole build.
 *
 * Required env (set by .github/workflows/release.yml on the macOS runner):
 *   APPLE_API_KEY     — path to the App Store Connect API key .p8 file
 *   APPLE_API_KEY_ID  — the key's Key ID
 *   APPLE_API_ISSUER  — the API key Issuer ID
 */
const { execSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function notarizeHook(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER } = process.env;
  if (!APPLE_API_KEY || !APPLE_API_KEY_ID || !APPLE_API_ISSUER) {
    console.log(
      "[notarize] Skipping — App Store Connect API-key env not set " +
        "(APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER). " +
        "The app is signed but NOT notarized; downloaders will see a Gatekeeper warning.",
    );
    return;
  }

  // Lazy-require so the hook loads even if the dep isn't installed in a
  // non-mac context.
  const { notarize } = require("@electron/notarize");

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`[notarize] Submitting ${appName}.app to Apple notary service (notarytool)…`);
  await notarize({
    tool: "notarytool",
    appPath,
    appleApiKey: APPLE_API_KEY,
    appleApiKeyId: APPLE_API_KEY_ID,
    appleApiIssuer: APPLE_API_ISSUER,
  });

  console.log("[notarize] Notarization accepted — stapling ticket…");
  execSync(`xcrun stapler staple "${appPath}"`, { stdio: "inherit" });
  console.log("[notarize] Done — app is signed, notarized, and stapled.");
};
