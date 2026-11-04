/**
 * PAN-4927 W-INJ3 (PAN-4934): read the overdeck MCP config (Claude Code --mcp-config format)
 * and convert its stdio servers to ACP McpServerStdio entries for session/new and session/load.
 *
 * Stdio only: an http or sse entry would carry the token inside the ACP payload (PAN-4934 D-4).
 */
import { readFile } from "node:fs/promises";
import type * as EffectAcpSchema from "effect-acp/schema";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStdioServer(
  name: string,
  entry: unknown,
  warn: (line: string) => void,
): EffectAcpSchema.McpServerStdio | null {
  if (!isRecord(entry)) {
    warn(`[acp-host] MCP server ${name} skipped: entry is not an object`);
    return null;
  }
  if (entry.type !== undefined && entry.type !== "stdio") {
    warn(`[acp-host] MCP server ${name} skipped: type ${String(entry.type)} is not stdio`);
    return null;
  }
  if (typeof entry.command !== "string" || entry.command.length === 0) {
    warn(`[acp-host] MCP server ${name} skipped: no command`);
    return null;
  }
  const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
  const env = isRecord(entry.env)
    ? Object.entries(entry.env).map(([key, value]) => ({ name: key, value: String(value) }))
    : [];
  return { name, command: entry.command, args, env };
}

/** D-5/D-6: stdio entries in file order; [] and one stderr line on any read or shape error. */
export async function readAcpMcpServers(
  path: string,
  warn: (line: string) => void = (line) => console.error(line),
): Promise<EffectAcpSchema.McpServerStdio[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    warn(`[acp-host] overdeck MCP config skipped: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
    warn(`[acp-host] overdeck MCP config skipped: ${path} has no mcpServers object`);
    return [];
  }
  const servers: EffectAcpSchema.McpServerStdio[] = [];
  for (const [name, entry] of Object.entries(parsed.mcpServers)) {
    const server = toStdioServer(name, entry, warn);
    if (server) servers.push(server);
  }
  return servers;
}
