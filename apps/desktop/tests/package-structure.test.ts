/**
 * Smoke tests for the npm-publishable package structure.
 *
 * Verifies that the required files and package.json fields are present
 * and correct for the `panctl` npm package.
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

  it("has name 'panctl'", () => {
    const pkg = readPkg();
    expect(pkg.name).toBe("panctl");
  });

  it("has a bin entry pointing to bin/panctl.mjs", () => {
    const pkg = readPkg();
    const bin = pkg.bin as Record<string, string> | undefined;
    expect(bin).toBeDefined();
    expect(bin?.["panctl"]).toBe("./bin/panctl.mjs");
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
});

describe("bin/panctl.mjs", () => {
  const binPath = Path.join(desktopDir, "bin/panctl.mjs");

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
