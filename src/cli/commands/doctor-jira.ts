/**
 * `pan doctor` Jira credential check (PAN-5152, FR-10, AC-6).
 *
 * Makes one authenticated `GET myself` call per distinct Jira site among the
 * `tracker: jira` projects and names the fix when the check fails. No Jira
 * project means no rows and no request.
 */

import { Effect } from 'effect';
import { TrackerAuthError } from '../../lib/tracker/interface.js';
import { JiraRestApi } from '../../lib/tracker/jira-api.js';
import { jiraCredentialFix, resolveJiraCredentials, type JiraCredentials, type JiraProjectConfig } from '../../lib/tracker/jira-config.js';
import { findJiraProjectsAsync } from '../../lib/tracker/tracker-projects.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export interface JiraDoctorDeps {
  listJiraProjects?: () => Promise<Array<{ key: string; config: { jira?: JiraProjectConfig } }>>;
  resolveCredentials?: (project: { jira?: JiraProjectConfig }) => Promise<JiraCredentials | null>;
  fetchImpl?: typeof fetch;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String((error as { message?: unknown })?.message ?? error);
}

async function checkSite(credentials: JiraCredentials, project: JiraProjectConfig | undefined, fetchImpl?: typeof fetch): Promise<CheckResult> {
  const name = `Jira (${credentials.site})`;
  try {
    const api = new JiraRestApi({ ...credentials, deployment: project?.deployment, fetchImpl });
    const me = await Effect.runPromise(api.api<{ displayName?: string; name?: string }>('GET', '/myself'));
    return { name, status: 'ok', message: `Authenticated as ${me?.displayName ?? me?.name ?? 'unknown user'}` };
  } catch (error) {
    if (error instanceof TrackerAuthError) {
      const status = /HTTP (\d+)/.exec(error.message)?.[1];
      return {
        name,
        status: 'error',
        message: status ? `Jira rejected the credentials (HTTP ${status})` : 'Jira Cloud needs an account email with the API token',
        fix: jiraCredentialFix(),
      };
    }
    return {
      name,
      status: 'warn',
      message: `Jira site unreachable: ${errorMessage(error)}`,
      fix: 'Check JIRA_BASE_URL or the project jira.site value.',
    };
  }
}

/** One row per distinct Jira site; `[]` when no project uses Jira. */
export async function checkJiraCredentials(deps: JiraDoctorDeps = {}): Promise<CheckResult[]> {
  const listJiraProjects = deps.listJiraProjects ?? findJiraProjectsAsync;
  const resolveCredentials = deps.resolveCredentials ?? resolveJiraCredentials;
  const projects = await listJiraProjects();
  if (projects.length === 0) return [];

  const results: CheckResult[] = [];
  const checkedSites = new Set<string>();
  for (const { key, config } of projects) {
    const credentials = await resolveCredentials(config);
    if (!credentials) {
      results.push({
        name: `Jira (${config.jira?.site ?? key})`,
        status: 'error',
        message: 'No Jira API token configured (Jira Cloud also needs the account email and a site URL)',
        fix: jiraCredentialFix(),
      });
      continue;
    }
    if (checkedSites.has(credentials.site)) continue;
    checkedSites.add(credentials.site);
    results.push(await checkSite(credentials, config.jira, deps.fetchImpl));
  }
  return results;
}
