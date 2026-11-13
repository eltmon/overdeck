/**
 * PAN-5169: darwin installers refuse to run `brew install` automatically when
 * `brew` is not on PATH, naming a download URL instead. Lives in its own
 * file because a module-level `platform.js` mock would otherwise flip the
 * platform for every test in registry.test.ts.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/lib/platform.js", () => ({
  detectPlatform: () => Effect.succeed("darwin"),
}));

const execMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  exec: execMock,
  execFile: vi.fn(),
}));

const loadConfigSyncMock = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/lib/config-yaml.js", () => ({
  loadConfigSync: loadConfigSyncMock,
}));

vi.mock("../../../../src/lib/semgrep/install.js", () => ({
  ensureSemgrepInstalled: vi.fn(),
  readSemgrepVersion: vi.fn(),
  managedSemgrepPath: () => "/home/test/.overdeck/bin/semgrep",
  SEMGREP_VERSION: "1.180.0",
}));

import { ensureHostTools, installTool } from "../../../../src/lib/prereqs/registry.js";

let originalPath: string | undefined;
let dir: string;

describe("darwin installs without Homebrew (PAN-5169)", () => {
  beforeEach(() => {
    originalPath = process.env.PATH;
    dir = mkdtempSync(join(tmpdir(), "pan-5169-brew-guard-"));
    process.env.PATH = dir;
    execMock.mockReset();
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("refuses to install tmux without brew on PATH, naming the download URL", async () => {
    const result = await installTool("tmux");
    expect(result).toMatchObject({ tool: "tmux", success: false });
    expect(result.message).toContain("Homebrew (brew) is not on PATH");
    expect(execMock).not.toHaveBeenCalled();
  });

  it("refuses to install jq without brew on PATH", async () => {
    const result = await installTool("jq");
    expect(result).toMatchObject({ tool: "jq", success: false });
    expect(result.message).toContain("Homebrew (brew) is not on PATH");
    expect(execMock).not.toHaveBeenCalled();
  });

  it("installs tmux via brew when brew is on PATH", async () => {
    const brewPath = join(dir, "brew");
    writeFileSync(brewPath, "#!/bin/sh\n");
    chmodSync(brewPath, 0o755);
    execMock.mockImplementation(
      ((_cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(null, "", "");
      }) as never,
    );
    const result = await installTool("tmux");
    expect(result).toMatchObject({ tool: "tmux", success: true });
    expect(execMock).toHaveBeenCalledWith("brew install tmux", expect.anything(), expect.anything());
  });

  it("ensureHostTools's warning names the download URL, not a bare brew install hint, with no brew on PATH", async () => {
    const { execFile } = await import("node:child_process");
    vi.mocked(execFile).mockImplementation(
      ((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout?: string, stderr?: string) => void) => {
        cb(Object.assign(new Error("spawn tmux ENOENT"), { code: "ENOENT" }));
      }) as never,
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await ensureHostTools({ backend: "herdr" });
    const messages = logSpy.mock.calls.map(([msg]) => String(msg));
    expect(messages.some((msg) => msg.includes("https://github.com/tmux/tmux/wiki/Installing"))).toBe(true);
    expect(messages.some((msg) => msg.includes("Install manually: brew install tmux"))).toBe(false);
  });
});
