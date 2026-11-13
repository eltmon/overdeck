import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Simulate real tmux CLI behavior: `tmux -V` succeeds, `tmux --version` exits 1
// with a usage error. The regression (pan up saying "tmux not found. Installing..."
// on machines that have tmux) came from probing with the default --version flag.
const execFileMock = vi.hoisted(() =>
  vi.fn(
    (
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout?: string, stderr?: string) => void,
    ) => {
      if (cmd === "tmux" && args[0] === "-V") {
        cb(null, "tmux 3.4", "");
      } else if (cmd === "tmux") {
        cb(new Error("usage: tmux [-2CDlNuVv] ..."));
      } else {
        cb(null, "", "");
      }
    },
  ),
);

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
  execFile: execFileMock,
}));

const loadConfigSyncMock = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/lib/config-yaml.js", () => ({
  loadConfigSync: loadConfigSyncMock,
}));

const ensureSemgrepInstalledMock = vi.hoisted(() => vi.fn());
const readSemgrepVersionMock = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/lib/semgrep/install.js", () => ({
  ensureSemgrepInstalled: ensureSemgrepInstalledMock,
  readSemgrepVersion: readSemgrepVersionMock,
  managedSemgrepPath: () => "/home/test/.overdeck/bin/semgrep",
  SEMGREP_VERSION: "1.180.0",
}));

import { exec } from "node:child_process";

import {
  detectLinuxPackageManager,
  ensureHostTools,
  getLinuxInstallCommand,
  getLinuxManualInstallHint,
  isToolInstalled,
  installTool,
  INSTALLABLE_TOOLS,
  PREREQ_REGISTRY,
} from "../../../../src/lib/prereqs/registry.js";

function mockSemgrepEnabled(enabled: boolean): void {
  loadConfigSyncMock.mockReturnValue({ config: { security: { semgrep: { enabled } } } });
}

describe("isToolInstalled", () => {
  it("detects tmux via -V (tmux does not support --version)", async () => {
    await expect(isToolInstalled("tmux")).resolves.toBe(true);
    const tmuxCalls = execFileMock.mock.calls.filter(([cmd]) => cmd === "tmux");
    expect(tmuxCalls).toHaveLength(1);
    expect(tmuxCalls[0][1]).toEqual(["-V"]);
  });
});

describe("detectLinuxPackageManager", () => {
  it.each(["pacman", "dnf", "zypper", "apk", "apt-get"] as const)(
    "detects %s when it is available",
    async (availablePackageManager) => {
      const commandAvailable = vi.fn(
        async (command: string) => command === availablePackageManager,
      );

      await expect(detectLinuxPackageManager(commandAvailable)).resolves.toBe(
        availablePackageManager,
      );
    },
  );

  it("returns null when no supported package manager is available", async () => {
    await expect(detectLinuxPackageManager(async () => false)).resolves.toBeNull();
  });
});

describe("Linux package install commands", () => {
  it.each([
    ["pacman", "sudo pacman -S --noconfirm jq"],
    ["dnf", "sudo dnf install -y jq"],
    ["zypper", "sudo zypper install -y jq"],
    ["apk", "sudo apk add jq"],
    ["apt-get", "sudo apt-get update && sudo apt-get install -y jq"],
  ] as const)("builds the jq command for %s", (packageManager, expected) => {
    expect(getLinuxInstallCommand("jq", packageManager)).toBe(expected);
  });

  it("uses the detected package-manager command in manual hints", () => {
    expect(getLinuxManualInstallHint("jq", "pacman")).toBe(
      "sudo pacman -S --noconfirm jq",
    );
  });

  it("links to jq downloads when no supported package manager is available", () => {
    expect(getLinuxManualInstallHint("jq", null)).toBe(
      "jq — download from https://jqlang.github.io/jq/download/",
    );
  });
});

describe("semgrep prerequisite (PAN-4585)", () => {
  it("registers semgrep as an installable tool with its own feature key", () => {
    expect(INSTALLABLE_TOOLS).toContain("semgrep");
    expect(PREREQ_REGISTRY.useSemgrep).toEqual(["semgrep"]);
  });

  it("refuses to install while the feature is disabled, without calling the installer", async () => {
    mockSemgrepEnabled(false);
    const result = await installTool("semgrep");
    expect(result.success).toBe(false);
    expect(result.message).toContain("security.semgrep.enabled");
    expect(ensureSemgrepInstalledMock).not.toHaveBeenCalled();
  });

  it("succeeds when enabled and the installer reports installed", async () => {
    mockSemgrepEnabled(true);
    ensureSemgrepInstalledMock.mockResolvedValue({
      status: "installed",
      version: "1.180.0",
      message: "Installed Semgrep 1.180.0",
    });
    const result = await installTool("semgrep");
    expect(result.success).toBe(true);
  });

  it("reports installed only when enabled and the managed version matches the pin", async () => {
    mockSemgrepEnabled(true);
    readSemgrepVersionMock.mockResolvedValue("1.180.0");
    await expect(isToolInstalled("semgrep")).resolves.toBe(true);

    readSemgrepVersionMock.mockResolvedValue("1.179.0");
    await expect(isToolInstalled("semgrep")).resolves.toBe(false);
  });

  it("reports not installed while disabled, without probing the version", async () => {
    mockSemgrepEnabled(false);
    readSemgrepVersionMock.mockClear();
    await expect(isToolInstalled("semgrep")).resolves.toBe(false);
    expect(readSemgrepVersionMock).not.toHaveBeenCalled();
  });
});

describe("ensureHostTools (PAN-5169)", () => {
  const originalExecFileImpl = execFileMock.getMockImplementation();

  beforeEach(() => {
    execFileMock.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        if (cmd === "tmux") {
          cb(Object.assign(new Error("spawn tmux ENOENT"), { code: "ENOENT" }));
        } else {
          cb(null, "", "");
        }
      },
    );
  });

  afterEach(() => {
    execFileMock.mockImplementation(originalExecFileImpl!);
    vi.mocked(exec).mockReset();
    vi.restoreAllMocks();
  });

  it("warns and does not exit under the herdr backend when tmux is missing", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await ensureHostTools({ backend: "herdr" });
    expect(exitSpy).not.toHaveBeenCalled();
    const execCalls = vi.mocked(exec).mock.calls;
    expect(execCalls.every(([command]) => !String(command).includes("tmux"))).toBe(true);
    expect(logSpy.mock.calls.some(([msg]) => String(msg).includes("tmux not found — the Herdr terminal backend does not need it"))).toBe(true);
  });

  it("exits 1 under the tmux backend when tmux is missing and the installer fails", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.mocked(exec).mockImplementation(
      ((_cmd: string, _opts: unknown, cb: (err: Error | null) => void) => {
        cb(new Error("install failed"));
      }) as never,
    );
    await ensureHostTools({ backend: "tmux" });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
