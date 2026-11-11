/**
 * Jira configuration types (PAN-5152).
 *
 * `JiraProjectConfig` is the optional `jira:` block a `tracker: jira` project
 * carries in `projects.yaml`. The Jira project key is the project's
 * `issue_prefix`, so it has no field here. `JiraCredentials` is the resolved
 * token, email and site that the Jira client authenticates with.
 */

import type { CanonicalState } from '../../core/state-mapping.js';

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
