/** Atlassian Rovo MCP pack (PAN-5165): constants for the known pack, its auth header, and pan doctor. */
import { isCloudJiraSite } from '../tracker/jira-config.js';

export const ATLASSIAN_PACK_ID = 'atlassian';
export const ATLASSIAN_PACK_URL = 'https://github.com/atlassian/atlassian-mcp-server';
/** atlassian/atlassian-mcp-server HEAD on 2026-11-07. */
export const ATLASSIAN_PACK_COMMIT = '3be55622453304b905f0c0fd5ef96fa4d638627c';
export const ATLASSIAN_MCP_HOST = 'mcp.atlassian.com';
export const ATLASSIAN_MCP_URL = 'https://mcp.atlassian.com/v2/mcp';
/** Skills that create or edit Jira or Confluence content: the pack toggle never turns them on. */
export const ATLASSIAN_OPT_IN_SKILLS: readonly string[] = [
  'capture-tasks-from-meeting-notes',
  'generate-status-report',
  'spec-to-backlog',
  'triage-issue',
];
export const ATLASSIAN_DISCLOSURE =
  'Agents call the Atlassian Rovo MCP server at mcp.atlassian.com, which reads and changes your Jira and Confluence data. When Jira tracker credentials are set, the Jira account email and API token are sent to it as the Authorization header.';

export interface AtlassianTrackerKeys {
  jira?: string;
  jiraEmail?: string;
  jiraBaseUrl?: string;
}

/** `Basic base64(email:token)` from the Jira tracker keys, or null when either is missing or the site is Data Center. */
export function atlassianBasicAuth(keys: AtlassianTrackerKeys | undefined): string | null {
  const token = keys?.jira?.trim();
  const email = keys?.jiraEmail?.trim();
  if (!token || !email) return null;
  if (keys?.jiraBaseUrl && !isCloudJiraSite(keys.jiraBaseUrl)) return null;
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

function isAtlassianMcpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === ATLASSIAN_MCP_HOST;
  } catch {
    return false;
  }
}

function hasAuthorizationHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === 'authorization');
}

/** True when the server is an https mcp.atlassian.com endpoint with no Authorization header set (any case). */
export function atlassianNeedsInteractiveAuth(server: { url: string; headers: Record<string, string> }): boolean {
  return isAtlassianMcpUrl(server.url) && !hasAuthorizationHeader(server.headers);
}

/** Add the Authorization header to every https mcp.atlassian.com server that has none (any case); never mutates its input. */
export function withAtlassianAuth<T extends { url: string; headers: Record<string, string> }>(
  servers: Record<string, T>,
  keys: AtlassianTrackerKeys | undefined,
): Record<string, T> {
  const auth = atlassianBasicAuth(keys);
  const result: Record<string, T> = {};
  for (const [name, server] of Object.entries(servers)) {
    result[name] =
      auth && atlassianNeedsInteractiveAuth(server)
        ? { ...server, headers: { ...server.headers, Authorization: auth } }
        : { ...server, headers: { ...server.headers } };
  }
  return result;
}
