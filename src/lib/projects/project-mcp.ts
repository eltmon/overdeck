/**
 * Project MCP servers (PAN-5061).
 *
 * `projects.<key>.mcp_servers` declares MCP servers for one project's agents,
 * in the role `mcpServers:` shape: a YAML list of single-key maps. This module
 * validates that list. An invalid entry is skipped with one warning naming the
 * project, the server and the reason; valid entries still apply. Warnings never
 * include values, so a header or env secret written inline cannot reach a log.
 */

export type ProjectMcpServer =
  | { type: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { type: 'http'; url: string; headers: Record<string, string> };

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;
const RESERVED_NAME = 'overdeck';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every((v) => typeof v === 'string');
}

function isAllowedHttpUrl(url: string): boolean {
  if (url.startsWith('https://')) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(url);
}

/** Validate one entry's definition; a string result is the reason it is invalid. */
function parseDefinition(def: unknown): ProjectMcpServer | string {
  if (!isPlainObject(def)) return 'definition must be a map';
  const type = def.type ?? 'stdio';
  if (type === 'stdio') {
    if (typeof def.command !== 'string' || def.command.length === 0) return 'command must be a non-empty string';
    if (def.args !== undefined && !(Array.isArray(def.args) && def.args.every((a) => typeof a === 'string'))) {
      return 'args must be a list of strings';
    }
    if (def.env !== undefined && !isStringMap(def.env)) return 'env must be a map of strings';
    return { type: 'stdio', command: def.command, args: (def.args as string[] | undefined) ?? [], env: (def.env as Record<string, string> | undefined) ?? {} };
  }
  if (type === 'http') {
    if (typeof def.url !== 'string' || !isAllowedHttpUrl(def.url)) {
      return 'url must start with https:// (or http://localhost / http://127.0.0.1)';
    }
    if (def.headers !== undefined && !isStringMap(def.headers)) return 'headers must be a map of strings';
    return { type: 'http', url: def.url, headers: (def.headers as Record<string, string> | undefined) ?? {} };
  }
  return 'type must be stdio or http';
}

/** Validate `projects.<key>.mcp_servers`; invalid entries are skipped with one warning each. */
export function parseProjectMcpServers(
  raw: unknown,
  projectKey: string,
  warn: (line: string) => void = console.warn,
): Record<string, ProjectMcpServer> {
  if (raw === undefined) return {};
  if (!Array.isArray(raw)) {
    warn(`[project-mcp] ${projectKey}: mcp_servers skipped: expected a list of single-key maps (- <name>: { command: ... })`);
    return {};
  }

  const servers: Record<string, ProjectMcpServer> = {};
  raw.forEach((entry, index) => {
    if (!isPlainObject(entry) || Object.keys(entry).length !== 1) {
      warn(`[project-mcp] ${projectKey}: server #${index + 1} skipped: each list element must be a single-key map`);
      return;
    }
    const [name, def] = Object.entries(entry)[0];
    const skip = (reason: string) => warn(`[project-mcp] ${projectKey}: server ${name} skipped: ${reason}`);
    if (!SERVER_NAME.test(name)) return skip('name must match ^[A-Za-z0-9_-]+$');
    if (name === RESERVED_NAME) return skip(`the name ${RESERVED_NAME} is reserved`);
    if (Object.prototype.hasOwnProperty.call(servers, name)) return skip('duplicate name (the first entry is kept)');
    const parsed = parseDefinition(def);
    if (typeof parsed === 'string') return skip(parsed);
    servers[name] = parsed;
  });
  return servers;
}
