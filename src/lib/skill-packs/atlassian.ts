/** Atlassian Rovo MCP pack (PAN-5165): constants for the known pack, its auth header, and pan doctor. */
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
