/**
 * Jira configuration types (PAN-5152).
 *
 * `JiraProjectConfig` is the optional `jira:` block a `tracker: jira` project
 * carries in `projects.yaml`. The Jira project key is the project's
 * `issue_prefix`, so it has no field here. `JiraCredentials` is the resolved
 * token, email and site that the Jira client authenticates with.
 */

import type { CanonicalState } from '../../core/state-mapping.js';
import { loadConfigNoMigration } from '../config-yaml.js';

/** The per-project `jira:` block in `projects.yaml`. */
export interface JiraProjectConfig {
  /** Jira site URL, e.g. `https://acme.atlassian.net`. Falls back to the Settings site URL. */
  site?: string;
  /** Overrides deployment detection. */
  deployment?: 'cloud' | 'datacenter';
  /** Jira status name per canonical state, merged over the state-mapping defaults. */
  status_map?: Partial<Record<CanonicalState | 'in_planning', string>>;
}

/** Resolved Jira credentials for one site. Cloud requires `email`; Data Center ignores it. */
export interface JiraCredentials {
  token: string;
  email?: string;
  site: string;
}

/** The fix to show when Jira credentials are missing or rejected. */
export function jiraCredentialFix(): string {
  return 'Set JIRA_API_TOKEN, JIRA_EMAIL and JIRA_BASE_URL in ~/.overdeck.env, or fill the Jira rows under Settings → Tracker Keys.';
}

/** True when the site is Jira Cloud (`*.atlassian.net`). */
export function isCloudJiraSite(site: string): boolean {
  try {
    return new URL(site).hostname.toLowerCase().endsWith('.atlassian.net');
  } catch {
    return false;
  }
}

/**
 * Resolve the Jira credentials for one project (D-15).
 *
 * The token and email come from Settings (`tracker_keys.jira*`), which
 * `load.ts` fills from `JIRA_API_TOKEN` / `JIRA_EMAIL` / `JIRA_BASE_URL`. The
 * site is the project's `jira.site`, else the Settings site URL. Returns null
 * when the token or site is missing, or when a Cloud site has no email.
 */
export async function resolveJiraCredentials(project: { jira?: JiraProjectConfig }): Promise<JiraCredentials | null> {
  const { config } = await loadConfigNoMigration();
  const token = config.trackerKeys?.jira;
  const email = config.trackerKeys?.jiraEmail;
  const site = project.jira?.site || config.trackerKeys?.jiraBaseUrl;
  if (!token || !site) return null;
  if (!email && isCloudJiraSite(site)) return null;
  return email ? { token, email, site } : { token, site };
}
