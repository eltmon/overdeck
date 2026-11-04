import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readAcpMcpServers } from "../mcp-config.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pan-acp-mcp-config-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeConfig(content: unknown): Promise<string> {
  const path = join(dir, "overdeck-mcp.json");
  await writeFile(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

describe("readAcpMcpServers (PAN-4934)", () => {
  it("converts the W-INJ1 config to one ACP stdio entry", async () => {
    const warn = vi.fn();
    const path = await writeConfig({
      mcpServers: {
        overdeck: {
          type: "stdio",
          command: "/usr/bin/node",
          args: ["/r/dist/cli/index.js", "mcp", "serve"],
          env: {
            OVERDECK_MCP_TOKEN_FILE: "/a/mcp-token",
            OVERDECK_HOME: "/h",
            OVERDECK_DASHBOARD_URL: "http://127.0.0.1:3011",
          },
        },
      },
    });

    const servers = await readAcpMcpServers(path, warn);

    expect(servers).toEqual([
      {
        name: "overdeck",
        command: "/usr/bin/node",
        args: ["/r/dist/cli/index.js", "mcp", "serve"],
        env: [
          { name: "OVERDECK_MCP_TOKEN_FILE", value: "/a/mcp-token" },
          { name: "OVERDECK_HOME", value: "/h" },
          { name: "OVERDECK_DASHBOARD_URL", value: "http://127.0.0.1:3011" },
        ],
      },
    ]);
    expect(servers[0]).not.toHaveProperty("type");
    expect(warn).not.toHaveBeenCalled();
  });

  it("converts an entry without type and defaults absent args and env to []", async () => {
    const warn = vi.fn();
    const path = await writeConfig({ mcpServers: { overdeck: { command: "/usr/bin/node" } } });

    expect(await readAcpMcpServers(path, warn)).toEqual([
      { name: "overdeck", command: "/usr/bin/node", args: [], env: [] },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("skips http and command-less entries with one warning each and keeps the stdio sibling", async () => {
    const warn = vi.fn();
    const path = await writeConfig({
      mcpServers: {
        remote: { type: "http", url: "http://127.0.0.1:9000/mcp" },
        broken: { type: "stdio", args: ["x"] },
        overdeck: { type: "stdio", command: "/usr/bin/node", args: ["x"] },
      },
    });

    const servers = await readAcpMcpServers(path, warn);

    expect(servers.map((server) => server.name)).toEqual(["overdeck"]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![0]).toMatch(/^\[acp-host\] MCP server remote skipped:/);
    expect(warn.mock.calls[1]![0]).toMatch(/^\[acp-host\] MCP server broken skipped:/);
  });

  it.each([
    ["a missing file", async () => join(dir, "missing.json")],
    ["invalid JSON", async () => writeConfig("{not json")],
    ["a config without mcpServers", async () => writeConfig({})],
  ])("returns [] with one warning for %s", async (_label, makePath) => {
    const warn = vi.fn();

    expect(await readAcpMcpServers(await makePath(), warn)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/^\[acp-host\] overdeck MCP config skipped:/);
  });
});
