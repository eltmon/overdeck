import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import { CLAUDE_MD_TEMPLATES } from './paths.js';
import { FsError } from './errors.js';

export interface TemplateVariables {
  FEATURE_FOLDER: string;
  BRANCH_NAME: string;
  ISSUE_ID: string;
  WORKSPACE_PATH: string;
  FRONTEND_URL?: string;
  API_URL?: string;
  PROJECT_NAME?: string;
  PROJECT_DOMAIN?: string;
  [key: string]: string | undefined;
}

function loadSection(path: string, variables: TemplateVariables): string {
  let result = readFileSync(path, 'utf8');
  for (const [key, value] of Object.entries(variables)) {
    if (value !== undefined) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    }
  }
  return result;
}

export function generateClaudeMdSync(
  variables: TemplateVariables
): string {
  const sections: string[] = [];

  const defaultOrder = [
    'workspace-info.md',
    'beads.md',
    'commands-skills.md',
    'warnings.md',
  ];

  for (const section of defaultOrder) {
    const sectionPath = join(CLAUDE_MD_TEMPLATES, section);
    if (existsSync(sectionPath)) {
      sections.push(loadSection(sectionPath, variables));
    }
  }

  // PAN-1899: the legacy per-project section read (<projectRoot>/.panopticon/
  // claude-md/sections/*.md) has been retired. Project-specific context now
  // lives in the canonical project layer (<projectRoot>/.pan/context/project.md),
  // composed into the workspace by assembleWorkspaceContext (PAN-1201).

  if (sections.length === 0) {
    return `# Workspace: ${variables.FEATURE_FOLDER}

**Issue:** ${variables.ISSUE_ID}
**Branch:** ${variables.BRANCH_NAME}
**Path:** ${variables.WORKSPACE_PATH}

## Getting Started

This workspace was created by Panopticon. Use \`bd\` commands to track your work.
`;
  }

  return sections.join('\n\n---\n\n');
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Generate the workspace CLAUDE.md content. Effect-native. Fails with FsError
 * if any template section cannot be read.
 */
export const generateClaudeMd = (
  projectPath: string,
  variables: TemplateVariables,
): Effect.Effect<string, FsError> =>
  Effect.try({
    try: () => generateClaudeMdSync(variables),
    catch: (cause) =>
      new FsError({ path: projectPath, operation: 'generateClaudeMd', cause }),
  });
