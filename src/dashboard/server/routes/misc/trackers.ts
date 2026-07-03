import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { loadConfigSync as loadPanConfig } from '../../../../lib/config.js';
import { loadConfigSync as loadYamlConfig } from '../../../../lib/config-yaml.js';
import { listProjectsSync } from '../../../../lib/projects.js';
import type { IssueDataService } from '../../services/issue-data-service.js';
import {
  getLinearApiKey as getLinearApiKeyShared,
  getGitHubConfig as getGitHubConfigShared,
  getRallyConfig as getRallyConfigShared,
} from '../../services/tracker-config.js';
import { jsonResponse } from '../../http-helpers.js';
import { readJsonBody } from './shared.js';

function getIssueDataService(): IssueDataService {
  const { getSharedIssueService } = require('../../services/issue-service-singleton.js');
  return getSharedIssueService();
}

// ─── Route: POST /api/trackers/refresh ───────────────────────────────────────

const postTrackersRefreshRoute = HttpRouter.add(
  'POST',
  '/api/trackers/refresh',
  Effect.promise(async () => {
    try {
      const svc = getIssueDataService();
      await Promise.all([
        svc.invalidateTracker('linear'),
        svc.invalidateTracker('github'),
        svc.invalidateTracker('rally'),
      ]);
      return jsonResponse({ success: true });
    }    catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error refreshing trackers:', error);
      return jsonResponse({ error: 'Failed to refresh: ' + msg }, { status: 500 });
      }}),
);

const getTrackerStatusRoute = HttpRouter.add(
  'GET',
  '/api/tracker-status',
  Effect.try({
    try: () => {
      const panConfig = loadPanConfig();
      const yamlConfig = loadYamlConfig();
      const primary = panConfig.trackers?.primary;
      const secondary = panConfig.trackers?.secondary;

      const trackerEnvVars: Record<string, string> = {
        linear: 'LINEAR_API_KEY',
        github: 'GITHUB_TOKEN',
        gitlab: 'GITLAB_TOKEN',
        rally: 'RALLY_API_KEY',
      };

      const trackerNames: Record<string, string> = {
        linear: 'Linear',
        github: 'GitHub',
        gitlab: 'GitLab',
        rally: 'Rally',
      };

      const configured: Array<{
        type: string;
        name: string;
        hasKey: boolean;
        envVar: string;
        isPrimary: boolean;
      }> = [];

      // Only report trackers that have at least one project using them
      const projects = listProjectsSync();
      const cfgs = projects.map(p => p.config as unknown as Record<string, unknown>);
      const trackerHasProjects: Record<string, boolean> = {
        linear: cfgs.some(c => !!c.linear_project),
        github: cfgs.some(c => !!c.github_repo),
        rally: cfgs.some(c => !!c.rally_project),
        gitlab: cfgs.some(c => !!c.gitlab_repo),
      };

      const trackersToCheck = [primary, secondary].filter(Boolean) as string[];
      for (const trackerType of trackersToCheck) {
        // Skip trackers that no project uses
        if (trackerHasProjects[trackerType] === false) continue;

        const envVar = trackerEnvVars[trackerType] || `${trackerType.toUpperCase()}_API_KEY`;
        const hasEnvKey = !!process.env[envVar];
        const hasConfigKey = !!(((yamlConfig as { trackerKeys?: Record<string, string | undefined> }).trackerKeys || {}) as Record<string, string | undefined>)[trackerType];

        let hasEnvFileKey = false;
        if (trackerType === 'linear') hasEnvFileKey = !!getLinearApiKeyShared();
        else if (trackerType === 'github') hasEnvFileKey = !!getGitHubConfigShared();
        else if (trackerType === 'rally') hasEnvFileKey = !!getRallyConfigShared();

        configured.push({
          type: trackerType,
          name: trackerNames[trackerType] || trackerType,
          hasKey: hasEnvKey || hasConfigKey || hasEnvFileKey,
          envVar,
          isPrimary: trackerType === primary,
        });
      }

      return jsonResponse({ primary, secondary, configured });
    },
    catch: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error checking tracker status:', error);
      return jsonResponse(
        { error: 'Failed to check tracker status: ' + msg },
        { status: 500 },
      );
    },
  }),
);

// ─── Route: POST /api/rally/validate ─────────────────────────────────────────

const postRallyValidateRoute = HttpRouter.add(
  'POST',
  '/api/rally/validate',
  Effect.gen(function* () {
    const body = yield* readJsonBody;
    const { apiKey, server, workspace, project } = body as Record<string, string | undefined>;

    if (!apiKey) {
      return jsonResponse({ valid: false, error: 'API key is required' }, { status: 400 });
    }

    return yield* Effect.promise(async () => {
    try {
        const { RallyRestApi } = await import('../../../../lib/tracker/rally-api.js');
        const api = new RallyRestApi({
          apiKey,
          server: server || 'https://rally1.rallydev.com',
        });

        const result = await Effect.runPromise(api.query({
          type: 'artifact',
          fetch: ['FormattedID'],
          query: '((State = "Open"))',
          limit: 1,
          workspace,
          project,
        }));

        return jsonResponse({
          valid: true,
          message: 'Rally connection successful',
          testQueryResult: `Found ${result.QueryResult.TotalResultCount} artifacts`,
        });
      }    catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        const isAuthError =
          error.message?.includes('Unauthorized') || error.message?.includes('401');
        const isParseError = error.message?.includes('Could not parse');
        return jsonResponse(
          {
            valid: false,
            error: error.message,
            errorType: isAuthError ? 'auth' : isParseError ? 'query' : 'network',
          },
          { status: 400 },
        );
        }})
  }),
);

export const trackersRouteLayer = Layer.mergeAll(
  postTrackersRefreshRoute,
  getTrackerStatusRoute,
  postRallyValidateRoute,
);
