/**
 * PAN-383: UAT Agent — Browser-based requirement verification.
 *
 * Spawns after the test specialist passes to verify the application
 * works from a real browser perspective using Playwright MCP.
 */

import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { spawnEphemeralSpecialist, type SpecialistType } from './specialists.js';
import { setReviewStatus } from '../review-status.js';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Context for a UAT request
 */
export interface UatContext {
  projectKey: string;
  projectPath: string;
  issueId: string;
  workspace: string;
  branch?: string;
  frontendUrl: string;
  apiUrl: string;
  testEmail?: string;
}

/**
 * Find PRD/spec files for an issue in the workspace.
 */
async function findRequirements(issueId: string, workspacePath: string): Promise<string> {
  const normalizedId = issueId.toLowerCase();
  const parts: string[] = [];

  // Search common locations for PRD/spec files
  const searchPaths = [
    // Workspace-level planning docs
    join(workspacePath, '.planning', 'STATE.md'),
    // Docs directory
    join(workspacePath, 'docs'),
    join(workspacePath, 'fe', 'docs'),
    join(workspacePath, 'frontend', 'docs'),
    join(workspacePath, 'api', 'docs'),
  ];

  // Check .planning/STATE.md first (workspace planning context)
  for (const path of searchPaths.slice(0, 1)) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        parts.push(`## From ${path.replace(workspacePath, '.')}\n\n${content}`);
      } catch { /* skip unreadable files */ }
    }
  }

  // Search docs directories for files matching the issue ID
  for (const dir of searchPaths.slice(1)) {
    if (!existsSync(dir)) continue;
    try {
      const { stdout } = await execAsync(
        `find "${dir}" -maxdepth 2 -type f \\( -iname "*${normalizedId}*" -o -iname "*prd*" -o -iname "*spec*" \\) 2>/dev/null | head -10`,
        { encoding: 'utf-8' }
      );
      for (const file of stdout.trim().split('\n').filter(Boolean)) {
        try {
          const content = readFileSync(file, 'utf-8');
          // Truncate very long files
          const truncated = content.length > 8000
            ? content.substring(0, 8000) + '\n\n[... truncated for length ...]'
            : content;
          parts.push(`## From ${file.replace(workspacePath, '.')}\n\n${truncated}`);
        } catch { /* skip unreadable files */ }
      }
    } catch { /* skip on find errors */ }
  }

  // Also check the Linear/GitHub issue description via the issue tracker
  // (This is handled by the prompt — the specialist can read the issue)

  if (parts.length === 0) {
    return 'No PRD or spec files found in the workspace. Focus on smoke test and visual quality audit. Skip requirement verification phase.';
  }

  return parts.join('\n\n---\n\n');
}

/**
 * Derive workspace URLs from issue ID.
 * Convention: feature-min-xxx.myn.localhost
 */
function deriveWorkspaceUrls(issueId: string): { frontendUrl: string; apiUrl: string } {
  const slug = `feature-${issueId.toLowerCase()}`;
  return {
    frontendUrl: `https://${slug}.myn.localhost`,
    apiUrl: `https://api-${slug}.myn.localhost`,
  };
}

/**
 * Build the prompt for the UAT specialist.
 */
export async function buildUatPrompt(context: UatContext): Promise<string> {
  const templatePath = join(__dirname, 'prompts', 'uat-agent.md');

  if (!existsSync(templatePath)) {
    throw new Error(`UAT agent prompt template not found at ${templatePath}`);
  }

  const template = readFileSync(templatePath, 'utf-8');

  // Find requirements
  const requirements = await findRequirements(context.issueId, context.workspace);

  const dashboardUrl = process.env.DASHBOARD_URL || `http://localhost:${process.env.API_PORT || process.env.PORT || '3011'}`;
  const testEmail = context.testEmail || 'appletester@test.com';

  // Replace template variables
  const prompt = template
    .replace(/\{\{issueId\}\}/g, context.issueId)
    .replace(/\{\{frontendUrl\}\}/g, context.frontendUrl)
    .replace(/\{\{apiUrl\}\}/g, context.apiUrl)
    .replace(/\{\{apiUrl_dashboard\}\}/g, dashboardUrl)
    .replace(/\{\{workspacePath\}\}/g, context.workspace)
    .replace(/\{\{testEmail\}\}/g, testEmail)
    .replace(/\{\{requirements\}\}/g, requirements);

  return `<!-- panopticon:orchestration-context-start -->\n${prompt}\n<!-- panopticon:orchestration-context-end -->`;
}

/**
 * Spawn the UAT specialist for an issue.
 */
export async function spawnUatAgent(context: UatContext): Promise<{
  success: boolean;
  runId?: string;
  tmuxSession?: string;
  message: string;
  error?: string;
}> {
  // Build the prompt
  const prompt = await buildUatPrompt(context);

  // Update status to testing
  setReviewStatus(context.issueId.toUpperCase(), {
    uatStatus: 'testing',
    uatNotes: 'UAT specialist verifying in browser',
  });

  // Spawn the ephemeral specialist
  return spawnEphemeralSpecialist(context.projectKey, 'uat-agent' as SpecialistType, {
    issueId: context.issueId,
    branch: context.branch,
    workspace: context.workspace,
    promptOverride: prompt,
  });
}

/**
 * Build UAT context from an issue ID, auto-detecting workspace and URLs.
 */
export async function buildUatContext(
  projectKey: string,
  projectPath: string,
  issueId: string,
  workspace: string,
  branch?: string
): Promise<UatContext> {
  const urls = deriveWorkspaceUrls(issueId);

  return {
    projectKey,
    projectPath,
    issueId: issueId.toUpperCase(),
    workspace,
    branch: branch || `feature/${issueId.toLowerCase()}`,
    frontendUrl: urls.frontendUrl,
    apiUrl: urls.apiUrl,
    testEmail: 'appletester@test.com',
  };
}
