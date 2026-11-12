/**
 * Atlassian MCP doctor check (PAN-5165 WI-7). Silent unless the `atlassian`
 * pack is registered. When it is off everywhere, the endpoint is never
 * probed. Otherwise an MCP `initialize` is POSTed to the Rovo MCP endpoint,
 * with the Jira Basic header when tracker keys resolve one, and the result
 * is mapped to one row. Never logs a header value or a token.
 */
import { ATLASSIAN_MCP_URL, ATLASSIAN_PACK_ID, atlassianBasicAuth, type AtlassianTrackerKeys } from '../../lib/skill-packs/atlassian.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-sageox.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export interface AtlassianDoctorDeps {
  getPack: (id: string) => Promise<{ commit: string } | null>;
  packOnSomewhere: (id: string) => Promise<boolean>;
  trackerKeys: () => Promise<AtlassianTrackerKeys | undefined>;
  fetchImpl: typeof fetch;
  /** Default 10_000. */
  timeoutMs: number;
}

const NAME = 'Atlassian MCP';

const REJECTED_TOKEN_FIX =
  "An org admin must enable API token auth for the Rovo MCP server and the token needs MCP scopes; or declare a project mcp_servers entry named atlassian with url https://mcp.atlassian.com/v2/mcp and no headers (it overrides the pack's server) and sign in with /mcp.";
const NOT_SIGNED_IN_MESSAGE =
  'Atlassian MCP not signed in: no Jira email and API token, so Claude Code agents use your /mcp sign-in and Codex agents get no atlassian server';
const NOT_SIGNED_IN_FIX =
  'Set JIRA_EMAIL and JIRA_API_TOKEN (Settings → Tracker Keys), or run claude mcp add --transport http atlassian https://mcp.atlassian.com/v2/mcp and sign in with /mcp.';

function anyOverrideTrue(prefix: string, overrides: Record<string, boolean>): boolean {
  return Object.entries(overrides).some(([key, value]) => value === true && key.startsWith(prefix));
}

/**
 * True when the pack toggle, or any of its skills, is on anywhere: global,
 * a project, or an issue (D-5: a pack contributes once any one of its
 * skills resolves on, including a per-skill override with no pack toggle).
 */
async function defaultPackOnSomewhere(id: string): Promise<boolean> {
  const {
    listLowerLevelOverrides,
    listLowerLevelPackOverrides,
    readGlobalPackOverrides,
    readGlobalSkillOverrides,
    readProjectPackOverrides,
    readProjectSkillOverrides,
  } = await import('../../lib/skill-overrides/store.js');
  const { readIssueOverrides } = await import('../../lib/skill-overrides/issue-file.js');
  const skillPrefix = `${id}/`;

  if ((await readGlobalPackOverrides())[id] === true) return true;
  if (anyOverrideTrue(skillPrefix, await readGlobalSkillOverrides())) return true;

  const packLower = (await listLowerLevelPackOverrides())[id];
  for (const projectKey of packLower?.projects ?? []) {
    if ((await readProjectPackOverrides(projectKey))[id] === true) return true;
  }
  for (const issueId of packLower?.issues ?? []) {
    if ((await readIssueOverrides(issueId)).packs[id] === true) return true;
  }

  const skillLower = await listLowerLevelOverrides();
  for (const [skillId, { projects, issues }] of Object.entries(skillLower)) {
    if (!skillId.startsWith(skillPrefix)) continue;
    for (const projectKey of projects) {
      if (anyOverrideTrue(skillPrefix, await readProjectSkillOverrides(projectKey))) return true;
    }
    for (const issueId of issues) {
      if (anyOverrideTrue(skillPrefix, (await readIssueOverrides(issueId)).skills)) return true;
    }
  }
  return false;
}

const defaultDeps: AtlassianDoctorDeps = {
  getPack: async (id) => (await import('../../lib/skill-packs/sources.js')).getPack(id),
  packOnSomewhere: defaultPackOnSomewhere,
  trackerKeys: async () => (await (await import('../../lib/config-yaml.js')).loadConfigNoMigration()).config.trackerKeys,
  fetchImpl: fetch,
  timeoutMs: 10_000,
};

export async function checkAtlassianMcp(deps: Partial<AtlassianDoctorDeps> = {}): Promise<CheckResult[]> {
  const { getPack, packOnSomewhere, trackerKeys, fetchImpl, timeoutMs } = { ...defaultDeps, ...deps };
  try {
    if (!(await getPack(ATLASSIAN_PACK_ID))) return [];
    if (!(await packOnSomewhere(ATLASSIAN_PACK_ID))) {
      return [{ name: NAME, status: 'ok', message: 'atlassian pack registered and off everywhere; endpoint not checked' }];
    }

    const auth = atlassianBasicAuth(await trackerKeys());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(ATLASSIAN_MCP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(auth ? { Authorization: auth } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'overdeck-doctor', version: '1' } },
        }),
        signal: controller.signal,
      });
      if (auth && response.ok) return [{ name: NAME, status: 'ok', message: `Signed in with the Jira API token (HTTP ${response.status})` }];
      if (auth && (response.status === 401 || response.status === 403)) {
        return [{ name: NAME, status: 'error', message: `Atlassian rejected the Jira API token (HTTP ${response.status})`, fix: REJECTED_TOKEN_FIX }];
      }
      if (!auth && response.status === 401) {
        return [{ name: NAME, status: 'warn', message: NOT_SIGNED_IN_MESSAGE, fix: NOT_SIGNED_IN_FIX }];
      }
      if (!auth && response.ok) return [{ name: NAME, status: 'ok', message: `endpoint answered (HTTP ${response.status})` }];
      return [{ name: NAME, status: 'warn', message: `Atlassian MCP endpoint answered HTTP ${response.status}` }];
    } catch (error) {
      return [{ name: NAME, status: 'warn', message: `Atlassian MCP endpoint unreachable: ${(error as Error).message}` }];
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    // Config or override reads never crash the rest of pan doctor; degrade to one warn row.
    return [{ name: NAME, status: 'warn', message: `Atlassian MCP check failed: ${(error as Error).message}` }];
  }
}
