import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { parseIssueIdSync, extractPrefixSync } from '../../../../lib/issue-id.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../../../../lib/projects.js';
import { writeRecordTieredExecutionOverride } from '../../../../lib/pan-dir/record.js';
import type { TieredExecutionIssueOverride } from '../../../../lib/agents/tier-table.js';
import type { VBriefDocument } from '../../../../lib/vbrief/types.js';
import { criticalPath, actionableDoc } from '../../../../lib/vbrief/dag.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import {
  getProjectPath,
  readJsonBody,
  requireTrustedMutationOrigin,
} from '../workspaces.js';

type PlanLocation = {
  path: string;
  lifecycleDir: string;
  doc: VBriefDocument;
};

interface PatchWorkspaceTieredExecutionDeps {
  resolvePlanLocation: (projectPath: string, issueId: string) => Effect.Effect<PlanLocation | null, unknown>;
  assembleWorkspacePlanTieredExecution: (
    issueId: string,
    planMetadata?: { [key: string]: unknown },
  ) => unknown;
}

export function createPatchWorkspaceTieredExecutionRoute({
  resolvePlanLocation,
  assembleWorkspacePlanTieredExecution,
}: PatchWorkspaceTieredExecutionDeps) {
  return HttpRouter.add(
    'PATCH',
    '/api/workspaces/:issueId/tiered-execution',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const originError = requireTrustedMutationOrigin(request);
      if (originError) return originError;

      const params = yield* HttpRouter.params;
      const issueId = params['issueId'] ?? '';
      if (!parseIssueIdSync(issueId)) {
        return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
      }

      const body = yield* readJsonBody;
      const override = (body as { override?: unknown }).override;
      if (override !== 'on' && override !== 'off' && override !== null) {
        return jsonResponse({ error: 'Invalid tiered-execution override' }, { status: 400 });
      }

      const resolvedProject = resolveProjectFromIssueSync(issueId);
      const project = resolvedProject ? getProjectSync(resolvedProject.projectKey) : null;
      if (!project) {
        return jsonResponse({ error: 'Project not found for issue' }, { status: 404 });
      }

      const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
      const projectPath = getProjectPath(undefined, issuePrefix);
      const location = yield* resolvePlanLocation(projectPath, issueId);
      if (!location) {
        return jsonResponse(
          { error: 'No vBRIEF plan found for this workspace' },
          { status: 404 },
        );
      }

      yield* Effect.promise(() =>
        writeRecordTieredExecutionOverride(project, issueId, override as TieredExecutionIssueOverride | null),
      );

      const tieredExecution = assembleWorkspacePlanTieredExecution(issueId, location.doc.plan.metadata);
      const cp = criticalPath(actionableDoc(location.doc));
      return jsonResponse({
        ...location.doc,
        criticalPath: cp,
        lifecycleDir: location.lifecycleDir,
        tieredExecution,
      });
    })),
  );
}
