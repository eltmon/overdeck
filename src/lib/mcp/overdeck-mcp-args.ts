/**
 * Claude Code launch flags for the `overdeck` MCP server (PAN-4927 W-INJ1, PAN-4932 C-1).
 * Leaf module so launcher-generator.ts imports it without an import cycle.
 * Equals form on purpose: `--allowedTools <x> "$prompt"` swallows the prompt.
 */
import { shellQuote } from '../shell-quote.js';

export const OVERDECK_MCP_SERVER_NAME = 'overdeck';
export const CLAUDE_OVERDECK_MCP_CONFIG_FILE = 'overdeck-mcp.json';
const ALLOWED_TOOLS_FLAG = /(^|\s)--allowed(Tools|-tools)(=|\s)/;

/** ` --mcp-config=<path>` plus ` --allowedTools=mcp__overdeck` when `command` has no allow-list yet; '' without a path. */
export function overdeckMcpArgs(configPath: string | undefined, command: string): string {
  if (!configPath) return '';
  const allow = ALLOWED_TOOLS_FLAG.test(command) ? '' : ` --allowedTools=mcp__${OVERDECK_MCP_SERVER_NAME}`;
  return ` --mcp-config=${shellQuote(configPath)}${allow}`;
}
