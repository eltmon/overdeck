import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { processEnvBlocks, processIfBlocks, substituteVariables } from '../template.js';
import { extractTeamPrefix, findProjectByTeam } from '../projects.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve the prompts directory, handling both dev (src/) and bundled (dist/) layouts.
 */
function resolvePromptsDir(): string {
  // Try direct sibling path first (works in dev: src/lib/cloister/prompts/)
  const direct = join(__dirname, 'prompts');
  if (existsSync(direct) && existsSync(join(direct, 'work-agent.md'))) {
    return direct;
  }

  // Fallback: resolve from package root (works when bundled into dist/)
  let packageRoot = __dirname;
  if (packageRoot.includes('/src/')) {
    packageRoot = packageRoot.replace(/\/src\/.*$/, '');
  } else {
    // dist/cli/ or dist/dashboard/ → go up to package root
    packageRoot = join(packageRoot, '..', '..');
  }
  const fromRoot = join(packageRoot, 'src', 'lib', 'cloister', 'prompts');
  if (existsSync(fromRoot)) {
    return fromRoot;
  }

  return direct; // Let it fail with a clear error below
}

export interface WorkAgentPromptContext {
  issueId: string;
  env: 'LOCAL' | 'REMOTE';
  workspacePath: string;
  projectRoot?: string;
  /** Skip dynamic context gathering (filesystem reads). True for REMOTE/dashboard. */
  skipDynamicContext?: boolean;
}

/**
 * Build the unified work agent prompt from the template.
 */
export function buildWorkAgentPrompt(ctx: WorkAgentPromptContext): string {
  const templatePath = join(resolvePromptsDir(), 'work-agent.md');

  if (!existsSync(templatePath)) {
    throw new Error(`Work agent prompt template not found at ${templatePath}`);
  }

  let template = readFileSync(templatePath, 'utf-8');

  // Gather dynamic context (only for LOCAL when filesystem is accessible)
  let beadsTasksStr = '';
  let stitchDesignsStr = '';
  let polyrepoContextStr = '';

  if (!ctx.skipDynamicContext && ctx.projectRoot) {
    const planningContent = readPlanningContext(ctx.workspacePath);

    const beadsTasks = readBeadsTasks(ctx.workspacePath, ctx.projectRoot, ctx.issueId);
    if (beadsTasks.length > 0) {
      beadsTasksStr = beadsTasks.join('\n');
    }

    const stitchDesigns = extractStitchDesigns(planningContent);
    if (stitchDesigns) {
      stitchDesignsStr = stitchDesigns;
    }

    polyrepoContextStr = buildPolyrepoContext(ctx.issueId, ctx.workspacePath);
  }

  // Build variables map
  const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${process.env.API_PORT || process.env.PORT || '3011'}`;
  const vars: Record<string, string | undefined> = {
    ISSUE_ID: ctx.issueId,
    ISSUE_ID_LOWER: ctx.issueId.toLowerCase(),
    WORKSPACE_PATH: ctx.workspacePath,
    PROJECT_ROOT: ctx.projectRoot || '',
    API_URL: apiUrl,
    BEADS_TASKS: beadsTasksStr,
    STITCH_DESIGNS: stitchDesignsStr,
    POLYREPO_CONTEXT: polyrepoContextStr,
  };

  // Processing pipeline: env blocks → if blocks → variable substitution
  template = processEnvBlocks(template, ctx.env);
  template = processIfBlocks(template, vars);
  template = substituteVariables(template, vars as any);

  return template;
}

/**
 * Read planning artifacts for an issue (STATE.md, etc.)
 */
export function readPlanningContext(workspacePath: string): string | null {
  const statePath = join(workspacePath, '.planning', 'STATE.md');
  if (existsSync(statePath)) {
    return readFileSync(statePath, 'utf-8');
  }
  return null;
}

/**
 * Check if STATE.md contains Stitch design information.
 * Returns the Stitch section if found, null otherwise.
 */
export function extractStitchDesigns(stateContent: string | null): string | null {
  if (!stateContent) return null;

  // Look for Stitch-related sections in STATE.md
  const stitchPatterns = [
    /## UI Designs[\s\S]*?(?=\n## |$)/i,
    /### Stitch Assets[\s\S]*?(?=\n### |\n## |$)/i,
    /## Stitch[\s\S]*?(?=\n## |$)/i,
  ];

  for (const pattern of stitchPatterns) {
    const match = stateContent.match(pattern);
    if (match) {
      return match[0].trim();
    }
  }

  // Also check for Stitch project/screen IDs mentioned anywhere
  if (
    stateContent.includes('Stitch') &&
    (stateContent.includes('Project ID') || stateContent.includes('Screen ID'))
  ) {
    const lines = stateContent.split('\n');
    const stitchLines: string[] = [];
    let inStitchSection = false;

    for (const line of lines) {
      if (line.toLowerCase().includes('stitch')) {
        inStitchSection = true;
      }
      if (inStitchSection) {
        stitchLines.push(line);
        if (line.trim() === '' && stitchLines.length > 3) {
          break;
        }
      }
    }

    if (stitchLines.length > 0) {
      return stitchLines.join('\n').trim();
    }
  }

  return null;
}

/**
 * Extract beads IDs from STATE.md content.
 * Looks for patterns like `panopticon-1dg` in backticks or tables.
 */
export function extractBeadsIdsFromState(stateContent: string): string[] {
  const ids: string[] = [];

  const backtickMatches = stateContent.match(/`([a-z]+-[a-z0-9]+)`/g) || [];
  for (const match of backtickMatches) {
    const id = match.replace(/`/g, '');
    if (id.match(/^[a-z]+-[a-z0-9]{2,4}$/)) {
      ids.push(id);
    }
  }

  return [...new Set(ids)];
}

/**
 * Read beads tasks for an issue from both workspace and project root.
 * Uses STATE.md to find the associated beads IDs.
 */
export function readBeadsTasks(
  workspacePath: string,
  projectRoot: string,
  issueId: string
): string[] {
  const tasks: string[] = [];
  const normalizedId = issueId.toLowerCase();

  const stateContent = readPlanningContext(workspacePath);
  const beadsIds = stateContent ? extractBeadsIdsFromState(stateContent) : [];

  const beadsPaths = [
    join(workspacePath, '.beads', 'issues.jsonl'),
    join(projectRoot, '.beads', 'issues.jsonl'),
  ];

  const seenIds = new Set<string>();

  for (const beadsPath of beadsPaths) {
    if (!existsSync(beadsPath)) continue;

    try {
      const content = readFileSync(beadsPath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        try {
          const task = JSON.parse(line);
          if (seenIds.has(task.id)) continue;

          const tags = task.tags || [];
          const isMatch =
            beadsIds.includes(task.id) ||
            tags.some((t: string) => t.toLowerCase().includes(normalizedId)) ||
            task.title?.toLowerCase().includes(normalizedId);

          if (isMatch) {
            seenIds.add(task.id);
            tasks.push(`- [${task.status || 'open'}] ${task.title} (${task.id})`);
          }
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return tasks;
}

/**
 * Generate polyrepo context section if applicable.
 */
export function buildPolyrepoContext(issueId: string, workspacePath: string): string {
  const teamPrefix = extractTeamPrefix(issueId);
  const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;

  if (
    !projectConfig?.workspace?.type ||
    projectConfig.workspace.type !== 'polyrepo' ||
    !projectConfig.workspace.repos
  ) {
    return '';
  }

  const repos = projectConfig.workspace.repos;
  const lines: string[] = [
    '## Project Structure (Polyrepo)',
    '',
    '**IMPORTANT:** This project uses a **polyrepo** structure. The workspace root is NOT a git repository.',
    'Each subdirectory is a separate git worktree:',
    '',
    '| Directory | Purpose |',
    '|-----------|---------|',
  ];

  for (const repo of repos) {
    lines.push(`| \`${repo.name}/\` | Git worktree for ${repo.path} |`);
  }

  lines.push('');
  lines.push('**Git operations:**');
  lines.push(
    '- Run `git status`, `git log`, etc. INSIDE the subdirectories (e.g., `cd fe && git status`)'
  );
  lines.push(
    `- The workspace root (\`${workspacePath}\`) has no \`.git\` directory`
  );
  lines.push(
    `- Each subdirectory has its own branch: \`${repos[0]?.branch_prefix || 'feature/'}${issueId.toLowerCase()}\``
  );
  lines.push('');

  return lines.join('\n');
}
