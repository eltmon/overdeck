/**
 * `pan workspace render-devcontainer <featureName>` — re-render the
 * `.devcontainer/` directory for a workspace from the project's compose
 * template.
 *
 * Idempotent: same template + same placeholders → byte-identical output.
 * Always overwrites — designed to be called from project-specific tooling
 * (e.g. MYN's `infra/new-feature` shell) so there is exactly one
 * implementation of the render. See MIN-848 for the cross-repo context.
 *
 * Resolution order for the project:
 *   1. `--project <key>` if passed.
 *   2. Issue prefix (e.g. `min-846` → MIN team → mind-your-now).
 *   3. The current working directory (matched against project.path entries).
 */

import { existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import {
  renderDevcontainer,
} from '../../lib/workspace/devcontainer-renderer.js';
import {
  extractTeamPrefix,
  findProjectByTeam,
  loadProjectsConfig,
} from '../../lib/projects.js';
import type { ProjectConfig } from '../../lib/workspace-config.js';

export interface WorkspaceRenderDevcontainerOptions {
  /** Project key in projects.yaml (e.g. `mind-your-now`). */
  project?: string;
  /** Override the inferred workspace path (defaults to `<project>/workspaces/feature-<name>`). */
  workspace?: string;
  /** Print the steps as JSON instead of human-readable text. */
  json?: boolean;
}

export async function workspaceRenderDevcontainerCommand(
  featureName: string,
  options: WorkspaceRenderDevcontainerOptions = {},
): Promise<void> {
  const project = resolveProjectConfig(featureName, options);
  if (!project) {
    console.error(
      chalk.red(
        `✗ Could not determine the project for "${featureName}". Pass --project <key> ` +
          `(e.g. --project mind-your-now) or run from inside a configured project tree.`,
      ),
    );
    process.exit(1);
  }

  const featureFolder = featureName.startsWith('feature-')
    ? featureName
    : `feature-${featureName}`;
  const bareName = featureFolder.replace(/^feature-/, '');

  const workspacePath =
    options.workspace ?? join(project.path, 'workspaces', featureFolder);

  if (!existsSync(workspacePath)) {
    console.error(
      chalk.red(`✗ Workspace path does not exist: ${workspacePath}`) +
        chalk.dim(`\n  Create the workspace folder and worktrees first, then re-run.`),
    );
    process.exit(1);
  }

  if (!project.workspace?.docker?.compose_template) {
    console.error(
      chalk.red(
        `✗ Project "${project.name}" has no workspace.docker.compose_template configured. ` +
          `Nothing to render.`,
      ),
    );
    process.exit(1);
  }

  try {
    const result = renderDevcontainer({
      workspacePath,
      projectConfig: project,
      featureName: bareName,
    });

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            devcontainerDir: result.devcontainerDir,
            steps: result.steps,
            warnings: result.warnings,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(chalk.green(`✓ Rendered ${result.devcontainerDir}`));
    for (const step of result.steps) {
      console.log(chalk.dim(`  • ${step}`));
    }
    for (const warning of result.warnings) {
      console.log(chalk.yellow(`  ! ${warning}`));
    }
  } catch (err: any) {
    console.error(chalk.red(`✗ Render failed: ${err.message ?? err}`));
    process.exit(1);
  }
}

function resolveProjectConfig(
  featureName: string,
  options: WorkspaceRenderDevcontainerOptions,
): ProjectConfig | null {
  // 1. Explicit --project flag wins.
  if (options.project) {
    const { projects } = loadProjectsConfig();
    const named = projects[options.project];
    if (named) return { ...named, name: options.project };
    console.error(chalk.yellow(`! No project named "${options.project}" in projects.yaml`));
    return null;
  }

  // 2. Issue-id-style prefix (e.g. "min-846" → MIN → mind-your-now).
  const prefix = extractTeamPrefix(featureName);
  if (prefix) {
    const project = findProjectByTeam(prefix);
    if (project) return project;
  }

  // 3. cwd inside a configured project tree.
  const cwd = process.cwd();
  const { projects } = loadProjectsConfig();
  for (const [key, p] of Object.entries(projects)) {
    if (cwd === p.path || cwd.startsWith(p.path + '/')) {
      return { ...p, name: key };
    }
  }

  return null;
}
