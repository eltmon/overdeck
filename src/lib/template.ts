import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { CLAUDE_MD_TEMPLATES } from './paths.js';

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

export function loadTemplate(templatePath: string): string {
  if (!existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }
  return readFileSync(templatePath, 'utf8');
}

/**
 * Process {{#env LOCAL}}...{{/env}} and {{#env REMOTE}}...{{/env}} blocks.
 * Keeps content for matching env, strips blocks for non-matching env.
 */
export function processEnvBlocks(template: string, env: 'LOCAL' | 'REMOTE'): string {
  // Keep matching env blocks (strip the tags, keep content)
  let result = template.replace(
    new RegExp(`\\{\\{#env ${env}\\}\\}([\\s\\S]*?)\\{\\{/env\\}\\}`, 'g'),
    '$1'
  );

  // Remove non-matching env blocks entirely
  const otherEnv = env === 'LOCAL' ? 'REMOTE' : 'LOCAL';
  result = result.replace(
    new RegExp(`\\{\\{#env ${otherEnv}\\}\\}[\\s\\S]*?\\{\\{/env\\}\\}`, 'g'),
    ''
  );

  return result;
}

/**
 * Process {{#if varName}}...{{/if}} blocks.
 * Keeps content when the variable is truthy (non-empty string), strips otherwise.
 */
export function processIfBlocks(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(
    /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, varName: string, content: string) => {
      const value = vars[varName];
      return value && value.trim() ? content : '';
    }
  );
}

export function substituteVariables(
  template: string,
  variables: TemplateVariables
): string {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    if (value !== undefined) {
      // Replace {{KEY}} and ${KEY} patterns
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    }
  }

  return result;
}

export function generateClaudeMd(
  projectPath: string,
  variables: TemplateVariables
): string {
  const sections: string[] = [];

  // Layer 1: Panopticon default sections
  const defaultOrder = [
    'workspace-info.md',
    'beads.md',
    'commands-skills.md',
    'warnings.md',
  ];

  for (const section of defaultOrder) {
    const sectionPath = join(CLAUDE_MD_TEMPLATES, section);
    if (existsSync(sectionPath)) {
      const content = loadTemplate(sectionPath);
      sections.push(substituteVariables(content, variables));
    }
  }

  // Layer 2: Project-specific sections
  const projectSections = join(projectPath, '.panopticon', 'claude-md', 'sections');
  if (existsSync(projectSections)) {
    const projectFiles = readdirSync(projectSections)
      .filter((f) => f.endsWith('.md'))
      .sort();

    for (const file of projectFiles) {
      const content = loadTemplate(join(projectSections, file));
      sections.push(substituteVariables(content, variables));
    }
  }

  // If no sections found, return minimal CLAUDE.md
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
