/**
 * Project Registry - Multi-project support for Panopticon
 *
 * Maps Linear team prefixes and labels to project paths for workspace creation.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { PANOPTICON_HOME } from './paths.js';

export const PROJECTS_CONFIG_FILE = join(PANOPTICON_HOME, 'projects.yaml');

/**
 * Issue routing rule - routes issues with certain labels to specific paths
 */
export interface IssueRoutingRule {
  labels?: string[];
  default?: boolean;
  path: string;
}

/**
 * Project configuration
 */
export interface ProjectConfig {
  name: string;
  path: string;
  linear_team?: string;
  issue_routing?: IssueRoutingRule[];
  /** Custom command to create workspaces (e.g., infra/new-feature for MYN) */
  workspace_command?: string;
}

/**
 * Full projects configuration file
 */
export interface ProjectsConfig {
  projects: Record<string, ProjectConfig>;
}

/**
 * Resolved project info for workspace creation
 */
export interface ResolvedProject {
  projectKey: string;
  projectName: string;
  projectPath: string;
  linearTeam?: string;
}

/**
 * Load projects configuration from ~/.panopticon/projects.yaml
 */
export function loadProjectsConfig(): ProjectsConfig {
  if (!existsSync(PROJECTS_CONFIG_FILE)) {
    return { projects: {} };
  }

  try {
    const content = readFileSync(PROJECTS_CONFIG_FILE, 'utf-8');
    const config = parseYaml(content) as ProjectsConfig;
    return config || { projects: {} };
  } catch (error: any) {
    console.error(`Failed to parse projects.yaml: ${error.message}`);
    return { projects: {} };
  }
}

/**
 * Save projects configuration
 */
export function saveProjectsConfig(config: ProjectsConfig): void {
  const dir = PANOPTICON_HOME;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const yaml = stringifyYaml(config, { indent: 2 });
  writeFileSync(PROJECTS_CONFIG_FILE, yaml, 'utf-8');
}

/**
 * Get a list of all registered projects
 */
export function listProjects(): Array<{ key: string; config: ProjectConfig }> {
  const config = loadProjectsConfig();
  return Object.entries(config.projects).map(([key, projectConfig]) => ({
    key,
    config: projectConfig,
  }));
}

/**
 * Add or update a project in the registry
 */
export function registerProject(key: string, projectConfig: ProjectConfig): void {
  const config = loadProjectsConfig();
  config.projects[key] = projectConfig;
  saveProjectsConfig(config);
}

/**
 * Remove a project from the registry
 */
export function unregisterProject(key: string): boolean {
  const config = loadProjectsConfig();
  if (config.projects[key]) {
    delete config.projects[key];
    saveProjectsConfig(config);
    return true;
  }
  return false;
}

/**
 * Extract Linear team prefix from an issue ID
 * E.g., "MIN-123" -> "MIN", "PAN-456" -> "PAN"
 */
export function extractTeamPrefix(issueId: string): string | null {
  const match = issueId.match(/^([A-Z]+)-\d+$/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Find project by Linear team prefix
 */
export function findProjectByTeam(teamPrefix: string): ProjectConfig | null {
  const config = loadProjectsConfig();

  for (const [, projectConfig] of Object.entries(config.projects)) {
    if (projectConfig.linear_team?.toUpperCase() === teamPrefix.toUpperCase()) {
      return projectConfig;
    }
  }

  return null;
}

/**
 * Resolve the correct project path for an issue based on labels
 *
 * @param project - The project config
 * @param labels - Array of label names from the Linear issue
 * @returns The resolved path (may differ from project.path based on routing rules)
 */
export function resolveProjectPath(project: ProjectConfig, labels: string[] = []): string {
  if (!project.issue_routing || project.issue_routing.length === 0) {
    return project.path;
  }

  // Normalize labels to lowercase for comparison
  const normalizedLabels = labels.map(l => l.toLowerCase());

  // First, check label-based routing rules
  for (const rule of project.issue_routing) {
    if (rule.labels && rule.labels.length > 0) {
      const ruleLabels = rule.labels.map(l => l.toLowerCase());
      const hasMatch = ruleLabels.some(label => normalizedLabels.includes(label));
      if (hasMatch) {
        return rule.path;
      }
    }
  }

  // Then, find default rule
  for (const rule of project.issue_routing) {
    if (rule.default) {
      return rule.path;
    }
  }

  // Fall back to project path
  return project.path;
}

/**
 * Resolve project from an issue ID (and optional labels)
 *
 * @param issueId - Linear issue ID (e.g., "MIN-123")
 * @param labels - Optional array of label names
 * @returns Resolved project info or null if not found
 */
export function resolveProjectFromIssue(
  issueId: string,
  labels: string[] = []
): ResolvedProject | null {
  const teamPrefix = extractTeamPrefix(issueId);
  if (!teamPrefix) {
    return null;
  }

  const config = loadProjectsConfig();

  // Find project by team prefix
  for (const [key, projectConfig] of Object.entries(config.projects)) {
    if (projectConfig.linear_team?.toUpperCase() === teamPrefix) {
      const resolvedPath = resolveProjectPath(projectConfig, labels);
      return {
        projectKey: key,
        projectName: projectConfig.name,
        projectPath: resolvedPath,
        linearTeam: projectConfig.linear_team,
      };
    }
  }

  return null;
}

/**
 * Get a project by key
 */
export function getProject(key: string): ProjectConfig | null {
  const config = loadProjectsConfig();
  return config.projects[key] || null;
}

/**
 * Check if projects.yaml exists and has any projects
 */
export function hasProjects(): boolean {
  const config = loadProjectsConfig();
  return Object.keys(config.projects).length > 0;
}

/**
 * Create a default projects.yaml with example structure
 */
export function createDefaultProjectsConfig(): ProjectsConfig {
  const defaultConfig: ProjectsConfig = {
    projects: {
      // Example project - commented out in actual file
    },
  };

  return defaultConfig;
}

/**
 * Initialize projects.yaml with example configuration
 */
export function initializeProjectsConfig(): void {
  if (existsSync(PROJECTS_CONFIG_FILE)) {
    console.log(`Projects config already exists at ${PROJECTS_CONFIG_FILE}`);
    return;
  }

  const exampleYaml = `# Panopticon Project Registry
# Maps Linear teams to project paths for workspace creation

projects:
  # Example: Mind Your Now project
  # myn:
  #   name: "Mind Your Now"
  #   path: /home/user/projects/myn
  #   linear_team: MIN
  #   issue_routing:
  #     # Route docs/marketing issues to docs repo
  #     - labels: [docs, marketing, seo, landing-pages]
  #       path: /home/user/projects/myn/docs
  #     # Default: main repo
  #     - default: true
  #       path: /home/user/projects/myn

  # Example: Panopticon itself
  # panopticon:
  #   name: "Panopticon"
  #   path: /home/user/projects/panopticon
  #   linear_team: PAN
`;

  const dir = PANOPTICON_HOME;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(PROJECTS_CONFIG_FILE, exampleYaml, 'utf-8');
  console.log(`Created example projects config at ${PROJECTS_CONFIG_FILE}`);
}
