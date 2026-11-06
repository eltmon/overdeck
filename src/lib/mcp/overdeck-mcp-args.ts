/**
 * Claude Code launch flags for the `overdeck` MCP server (PAN-4927 W-INJ1, PAN-4932 C-1).
 * Leaf module so launcher-generator.ts imports it without an import cycle.
 * Equals form on purpose: `--allowedTools <x> "$prompt"` swallows the prompt.
 */
import { shellQuote } from '../shell-quote.js';

export const OVERDECK_MCP_SERVER_NAME = 'overdeck';
export const CLAUDE_OVERDECK_MCP_CONFIG_FILE = 'overdeck-mcp.json';
const ALLOWED_TOOLS_FLAG = /(^|\s)--allowed(Tools|-tools)(=|\s)/;

/**
 * ` --mcp-config=<path>` plus ` --allowedTools=mcp__<name>,...` (default `mcp__overdeck`) when `command` has no
 * allow-list yet, and ` --strict-mcp-config` when `strict` (PAN-5061); '' without a path or strict. No `opts` keeps the pre-PAN-5061 output.
 */
export function overdeckMcpArgs(
  configPath: string | undefined,
  command: string,
  opts: { serverNames?: readonly string[]; strict?: boolean } = {},
): string {
  const strict = opts.strict ? ' --strict-mcp-config' : '';
  if (!configPath) return strict;
  const names = opts.serverNames && opts.serverNames.length > 0 ? opts.serverNames : [OVERDECK_MCP_SERVER_NAME];
  const allow = ALLOWED_TOOLS_FLAG.test(command) ? '' : ` --allowedTools=${names.map((n) => `mcp__${n}`).join(',')}`;
  return ` --mcp-config=${shellQuote(configPath)}${allow}${strict}`;
}
