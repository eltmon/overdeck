/**
 * Self-heal entry point for `<workspace>/.devcontainer/`.
 *
 * Background (from the audit that produced PAN-955/956/957):
 *   - The rendered devcontainer is a regenerable build artifact, not user
 *     content.
 *   - It used to be silently destroyed by an automatic `git clean -fd -e
 *     .pan -e .beads` in the restart-from-plan manual fallback. The
 *     api container would keep running on its old image and look healthy,
 *     while Traefik returned 502s because nobody was listening on the
 *     routed port.
 *   - Two creation paths existed (TS workspace-manager + project shell
 *     `new-feature`) and they had drifted.
 *
 * Solution: one canonical render in `devcontainer-renderer.ts`, called from
 * a single self-heal helper here. Any code about to start, restart, or
 * inspect a workspace's containers should call `ensureDevcontainer` first.
 *
 * The heal is idempotent — if `.devcontainer/` already exists, this returns
 * `{ rendered: false }` without touching disk. If it's missing, it runs the
 * canonical renderer and returns `{ rendered: true }`.
 *
 * NOT a security boundary. Code that *intentionally* wants to rebuild can
 * `rmSync` and call this again.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { stepOk, stepSkipped, stepFailed } from '../lifecycle/types.js';
import type { StepResult } from '../lifecycle/types.js';
import {
  renderDevcontainer,
  type DevcontainerRenderResult,
} from './devcontainer-renderer.js';
import { getProject, resolveProjectFromIssue } from '../projects.js';

export interface EnsureDevcontainerInput {
  /** Absolute workspace path. e.g. `/home/x/Projects/myn/workspaces/feature-min-846`. */
  workspacePath: string;
  /** Issue ID (any case). Used to resolve project config and derive feature name. */
  issueId: string;
}

export interface EnsureDevcontainerResult {
  step: StepResult;
  /** True if `.devcontainer/` was missing and was just rendered. */
  rendered: boolean;
  /** The render result, when `rendered` is true. */
  renderDetail?: DevcontainerRenderResult;
}

/**
 * If `<workspace>/.devcontainer/` is missing, render it from the project
 * template. Otherwise, no-op.
 *
 * Returns a `StepResult` so the caller can compose this into a workflow log
 * (matches the `lifecycle/teardown-workspace.ts` step pattern).
 *
 * Errors are caught and returned as a failed step rather than thrown — most
 * callers want to keep going (e.g. `pan workspace up`) and surface the error
 * in the dashboard rather than crash the whole flow.
 */
export function ensureDevcontainer(
  input: EnsureDevcontainerInput,
): EnsureDevcontainerResult {
  const stepName = 'ensure:devcontainer';
  const devcontainerDir = join(input.workspacePath, '.devcontainer');

  if (existsSync(devcontainerDir)) {
    return {
      step: stepSkipped(stepName, [`Already exists: ${devcontainerDir}`]),
      rendered: false,
    };
  }

  if (!existsSync(input.workspacePath)) {
    return {
      step: stepFailed(stepName, `Workspace does not exist: ${input.workspacePath}`),
      rendered: false,
    };
  }

  const resolvedProject = resolveProjectFromIssue(input.issueId);
  const projectConfig = resolvedProject ? getProject(resolvedProject.projectKey) : null;
  if (!projectConfig) {
    return {
      step: stepFailed(
        stepName,
        `No project found for issue ${input.issueId} — cannot render .devcontainer/`,
      ),
      rendered: false,
    };
  }

  if (!projectConfig.workspace?.docker?.compose_template) {
    return {
      step: stepSkipped(stepName, [
        `Project ${projectConfig.path} has no compose_template configured — ` +
          `nothing to render.`,
      ]),
      rendered: false,
    };
  }

  // feature-min-846 → min-846. Workspace path leaf is the source of truth
  // for the feature name (same convention used elsewhere in workspace-manager).
  const featureName = pathLeaf(input.workspacePath).replace(/^feature-/, '');

  try {
    const renderDetail = renderDevcontainer({
      workspacePath: input.workspacePath,
      projectConfig,
      featureName,
    });
    return {
      step: stepOk(stepName, [
        `Rendered .devcontainer/ from ${projectConfig.workspace.docker.compose_template}`,
        ...renderDetail.steps,
        ...renderDetail.warnings.map(w => `warning: ${w}`),
      ]),
      rendered: true,
      renderDetail,
    };
  } catch (err: any) {
    return {
      step: stepFailed(stepName, err.message || 'Failed to render .devcontainer/', [
        `workspace: ${input.workspacePath}`,
        `template: ${projectConfig.workspace.docker.compose_template}`,
      ]),
      rendered: false,
    };
  }
}

function pathLeaf(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(idx + 1) : p;
}
