/**
 * Smoke tests for the npm-publishable package structure.
 *
 * Verifies that the required files and package.json fields are present
 * and correct for the `overdeck` npm package.
 */

import * as FS from "node:fs";
import * as Path from "node:path";
import { describe, expect, it } from "vitest";

const desktopDir = Path.resolve(__dirname, "..");

function readPkg(): Record<string, unknown> {
  const raw = FS.readFileSync(Path.join(desktopDir, "package.json"), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("package.json", () => {
  it("is not marked private (publishable)", () => {
    const pkg = readPkg();
    expect(pkg.private).toBeUndefined();
  });

  it("has name '@overdeck/desktop'", () => {
    const pkg = readPkg();
    expect(pkg.name).toBe("@overdeck/desktop");
  });

  it("has an overdeck-desktop bin entry pointing to bin/overdeck.mjs", () => {
    const pkg = readPkg();
    const bin = pkg.bin as Record<string, string> | undefined;
    expect(bin).toBeDefined();
    // The GUI shell's bin is `overdeck-desktop`; the plain `overdeck` command
    // is owned by @overdeck/core so the two never collide on a global install.
    expect(bin?.["overdeck-desktop"]).toBe("./bin/overdeck.mjs");
  });

  it("includes bin, dist-electron, server, and resources in files", () => {
    const pkg = readPkg();
    const files = pkg.files as string[] | undefined;
    expect(files).toBeDefined();
    expect(files).toContain("bin");
    expect(files).toContain("dist-electron");
    expect(files).toContain("server");
    expect(files).toContain("resources");
  });

  it("has engines.node >= 22", () => {
    const pkg = readPkg();
    const engines = pkg.engines as Record<string, string> | undefined;
    expect(engines?.node).toMatch(/>=\s*22/);
  });

  it("does not use Bun catalog: specifiers in devDependencies", () => {
    const pkg = readPkg();
    const devDeps = pkg.devDependencies as Record<string, string> | undefined;
    if (!devDeps) return;
    for (const [dep, version] of Object.entries(devDeps)) {
      expect(version, `${dep} must not use catalog: specifier`).not.toBe("catalog:");
    }
  });

  it("has a build:publish script", () => {
    const pkg = readPkg();
    const scripts = pkg.scripts as Record<string, string> | undefined;
    expect(scripts?.["build:publish"]).toBeDefined();
  });

  it("ships the staged CLI and preserves every existing extra resource", () => {
    const pkg = readPkg();
    const build = pkg.build as Record<string, unknown> | undefined;
    const extraResources = build?.extraResources as
      | Array<{ from?: string; to?: string; filter?: string[] }>
      | undefined;

    expect(extraResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "drizzle", to: "drizzle" }),
        expect.objectContaining({ from: "sync-sources", to: "sync-sources" }),
        expect.objectContaining({
          from: "cli",
          to: "dist",
          filter: expect.arrayContaining(["**/*", "!**/*.map"]),
        }),
        expect.objectContaining({ from: "cli/package.json", to: "package.json" }),
        expect.objectContaining({ from: "server", to: "server" }),
        expect.objectContaining({ from: "resources", to: "resources" }),
      ]),
    );
  });
});

describe("bin/overdeck.mjs", () => {
  const binPath = Path.join(desktopDir, "bin/overdeck.mjs");

  it("exists", () => {
    expect(FS.existsSync(binPath)).toBe(true);
  });

  it("starts with a Node.js shebang", () => {
    const content = FS.readFileSync(binPath, "utf8");
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("checks for server bundle before launching", () => {
    const content = FS.readFileSync(binPath, "utf8");
    expect(content).toContain("server.js");
  });

  it("resolves and uses the electron binary", () => {
    const content = FS.readFileSync(binPath, "utf8");
    expect(content).toContain('require("electron")');
  });
});

describe("scripts/build-for-publish.mjs", () => {
  it("exists", () => {
    const p = Path.join(desktopDir, "scripts/build-for-publish.mjs");
    expect(FS.existsSync(p)).toBe(true);
  });
});

describe("scripts/stamp-update-manifests.mjs", () => {
  it("converts the dist file URL before joining manifest paths", () => {
    const script = FS.readFileSync(
      Path.join(desktopDir, "scripts/stamp-update-manifests.mjs"),
      "utf8",
    );

    expect(script).toContain("fileURLToPath(new URL('../dist/', import.meta.url))");
    expect(script).not.toContain("distDir.pathname");
  });
});

describe("scripts/prepare-server-resources.mjs", () => {
  const scriptPath = Path.join(desktopDir, "scripts/prepare-server-resources.mjs");

  it("stages and smoke-runs the packaged CLI runtime", () => {
    const script = FS.readFileSync(scriptPath, "utf8");

    expect(script).toContain('const cliDir = join(desktopDir, "cli")');
    expect(script).toContain('cpSync(distCli, join(cliDir, "cli")');
    expect(script).toContain('join(smokeRuntime, "cli/index.js")');
    expect(script).toContain("Staged CLI smoke run failed");
  });

  it("stages the full sync-sources tree instead of only hooks", () => {
    const script = FS.readFileSync(scriptPath, "utf8");

    expect(script).toContain('cpSync(join(repoRoot, "sync-sources"), hooksStageDir, { recursive: true })');
    expect(script).not.toContain('cpSync(join(repoRoot, "sync-sources", "hooks")');
  });
});
