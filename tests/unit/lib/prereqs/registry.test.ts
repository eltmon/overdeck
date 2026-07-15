import { describe, expect, it, vi } from "vitest";

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

import { isToolInstalled } from "../../../../src/lib/prereqs/registry.js";

describe("isToolInstalled", () => {
  it("detects tmux via -V (tmux does not support --version)", async () => {
    await expect(isToolInstalled("tmux")).resolves.toBe(true);
    const tmuxCalls = execFileMock.mock.calls.filter(([cmd]) => cmd === "tmux");
    expect(tmuxCalls).toHaveLength(1);
    expect(tmuxCalls[0][1]).toEqual(["-V"]);
  });
});
