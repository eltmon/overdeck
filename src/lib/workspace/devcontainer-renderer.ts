/**
 * Single source of truth for rendering a workspace's `.devcontainer/` directory
 * from a project's compose template.
 *
 * Replaces a duplicated render that previously lived inline in
 * `workspace-manager.ts` (Path 1 in the audit) and was *also* re-implemented
 * by the project-specific `infra/new-feature` shell scripts (Path 4) — a
 * recipe for drift. Anything that needs `.devcontainer/` rendered now goes
 * through `renderDevcontainer()` here.
 *
 * The render is **idempotent**: same template + same placeholders → identical
 * output. That means `ensureDevcontainer()` (the self-heal entry point) can
 * safely be called before every container-start operation without disturbing
 * a healthy workspace.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  symlinkSync,
} from 'fs';
import { basename, dirname, join } from 'path';
import { homedir } from 'os';
import {
  replacePlaceholders,
  type ProjectConfig,
  type TemplatePlaceholders,
} from '../workspace-config.js';

// ─── Placeholders ───────────────────────────────────────────────────────────

/**
 * Build the canonical placeholder set for a workspace.
 *
 * Used by `renderDevcontainer` and any other code that processes templates
 * for a workspace. Keeping this in one place stops two renderers from
 * disagreeing on what `{{FEATURE_FOLDER}}` means.
 */
export function createWorkspacePlaceholders(
  projectConfig: ProjectConfig,
  featureName: string,
  workspacePath: string,
  extra: Partial<TemplatePlaceholders> = {},
): TemplatePlaceholders {
  const featureFolder = `feature-${featureName}`;
  const domain = projectConfig.workspace?.dns?.domain || 'localhost';

  return {
    FEATURE_NAME: featureName,
    FEATURE_FOLDER: featureFolder,
    BRANCH_NAME: `feature/${featureName}`,
    COMPOSE_PROJECT: `${basename(projectConfig.path)}-${featureFolder}`,
    DOMAIN: domain,
    PROJECT_NAME: basename(projectConfig.path),
    PROJECT_PATH: projectConfig.path,
    PROJECTS_DIR: dirname(projectConfig.path),
    WORKSPACE_PATH: workspacePath,
    HOME: homedir(),
    ...extra,
  };
}

// ─── Compose-file path sanitization ─────────────────────────────────────────

/**
 * Replace hardcoded user home paths in a compose file with `${HOME}` so the
 * file works across machines and after `cp -r` between users.
 */
export function sanitizeComposeFile(filePath: string): void {
  if (!existsSync(filePath)) return;

  let content = readFileSync(filePath, 'utf-8');
  const original = content;

  const homePatterns = [
    /\/home\/[a-zA-Z0-9_-]+\//g,
    /\/Users\/[a-zA-Z0-9_-]+\//g,
  ];
  for (const pattern of homePatterns) {
    content = content.replace(pattern, '${HOME}/');
  }

  if (content !== original) {
    writeFileSync(filePath, content, 'utf-8');
  }
}

// ─── Template processor ─────────────────────────────────────────────────────

interface TemplateMapping {
  source: string;
  target: string;
}

/**
 * Render every `*.template` file from `templateDir` into `targetDir`.
 *
 * If `mappings` is provided, only those specific source→target pairs are
 * processed. Otherwise every `*.template` file is rendered to its name minus
 * the `.template` suffix.
 *
 * Files named `dev` or ending in `.sh` get +x mode so they're executable.
 */
export function processTemplates(
  templateDir: string,
  targetDir: string,
  placeholders: TemplatePlaceholders,
  mappings?: TemplateMapping[],
): string[] {
  const steps: string[] = [];
  if (!existsSync(templateDir)) return steps;

  if (mappings && mappings.length > 0) {
    for (const { source, target } of mappings) {
      const sourcePath = join(templateDir, source);
      const targetPath = join(targetDir, target);
      if (!existsSync(sourcePath)) continue;
      const processed = replacePlaceholders(readFileSync(sourcePath, 'utf-8'), placeholders);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, processed);
      steps.push(`Processed template: ${source} -> ${target}`);
    }
    return steps;
  }

  for (const file of readdirSync(templateDir)) {
    if (!file.endsWith('.template')) continue;
    const sourcePath = join(templateDir, file);
    const baseName = file.replace('.template', '');
    const targetPath = join(targetDir, baseName);
    const processed = replacePlaceholders(readFileSync(sourcePath, 'utf-8'), placeholders);
    writeFileSync(targetPath, processed);
    if (baseName === 'dev' || baseName.endsWith('.sh')) {
      chmodSync(targetPath, 0o755);
    }
    steps.push(`Processed template: ${file}`);
  }
  return steps;
}

// ─── The devcontainer renderer (canonical) ──────────────────────────────────

export interface DevcontainerRenderResult {
  /** Absolute path to the rendered `.devcontainer/` directory. */
  devcontainerDir: string;
  /** Files written / copied / sanitized, in execution order. */
  steps: string[];
  /** Non-fatal warnings (e.g. dev-symlink already exists). */
  warnings: string[];
}

export interface DevcontainerRenderOptions {
  workspacePath: string;
  /** Project root where the template directory is configured. */
  projectConfig: ProjectConfig;
  /** Feature name without the `feature-` prefix (e.g. `min-846`). */
  featureName: string;
}

/**
 * Render `<workspace>/.devcontainer/` from the project's
 * `workspaceConfig.docker.compose_template` directory.
 *
 * Idempotent: identical inputs → identical files. No version stamp, no drift
 * detection, no migration logic. Anything that wants the workspace to have a
 * fresh `.devcontainer/` calls this; if the inputs haven't changed it's a
 * no-op-equivalent (files get re-written byte-for-byte the same).
 *
 * Throws if the project doesn't define a compose template (then there is
 * nothing to render and the caller should handle that gracefully).
 */
export function renderDevcontainer(
  opts: DevcontainerRenderOptions,
): DevcontainerRenderResult {
  const result: DevcontainerRenderResult = {
    devcontainerDir: join(opts.workspacePath, '.devcontainer'),
    steps: [],
    warnings: [],
  };

  const composeTemplate = opts.projectConfig.workspace?.docker?.compose_template;
  if (!composeTemplate) {
    throw new Error(
      `Project at ${opts.projectConfig.path} has no workspace.docker.compose_template — nothing to render`,
    );
  }

  const templateDir = join(opts.projectConfig.path, composeTemplate);
  if (!existsSync(templateDir)) {
    throw new Error(`Compose template directory not found: ${templateDir}`);
  }

  mkdirSync(result.devcontainerDir, { recursive: true });

  const placeholders = createWorkspacePlaceholders(
    opts.projectConfig,
    opts.featureName,
    opts.workspacePath,
  );

  // 1. Render every *.template file.
  result.steps.push(
    ...processTemplates(templateDir, result.devcontainerDir, placeholders),
  );

  // 2. Copy non-template files (Dockerfile, scripts, etc.).
  for (const file of readdirSync(templateDir)) {
    if (file.endsWith('.template')) continue;
    const sourcePath = join(templateDir, file);
    const targetPath = join(result.devcontainerDir, file);
    copyFileSync(sourcePath, targetPath);
    result.steps.push(`Copied: ${file}`);
  }

  // 3. Sanitize any compose files (replace hardcoded $HOME).
  let sanitized = 0;
  for (const file of readdirSync(result.devcontainerDir)) {
    if (file.includes('compose') && (file.endsWith('.yml') || file.endsWith('.yaml'))) {
      sanitizeComposeFile(join(result.devcontainerDir, file));
      sanitized++;
    }
  }
  if (sanitized > 0) {
    result.steps.push(`Sanitized ${sanitized} compose file(s) for platform compatibility`);
  }

  // 4. Ensure the `dev` script and the `<workspace>/dev` symlink are wired up.
  const devScriptInContainer = join(result.devcontainerDir, 'dev');
  const devScriptAtRoot = join(opts.workspacePath, 'dev');

  if (existsSync(devScriptInContainer)) {
    try {
      chmodSync(devScriptInContainer, 0o755);
    } catch (err: any) {
      result.warnings.push(`Could not chmod ${devScriptInContainer}: ${err.message}`);
    }

    if (!existsSync(devScriptAtRoot)) {
      try {
        symlinkSync('.devcontainer/dev', devScriptAtRoot);
        result.steps.push('Created ./dev symlink');
      } catch (err: any) {
        result.warnings.push(`Could not create ./dev symlink: ${err.message}`);
      }
    }
  }

  return result;
}
