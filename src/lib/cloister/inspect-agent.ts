/**
 * PAN-382: Inspect Agent — Per-step verification specialist.
 *
 * Spawns after each bead completion to verify the implementation matches
 * its specification and architectural constraints before the agent
 * proceeds to the next bead.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  getDiffBase,
  getDiffStats,
  getCurrentHead,
  saveCheckpoint,
} from './inspect-checkpoints.js';
import { spawnEphemeralSpecialist, type SpecialistType } from './specialists.js';
import { setReviewStatus } from '../review-status.js';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Context for an inspection request
 */
export interface InspectContext {
  projectKey: string;
  projectPath: string;
  issueId: string;
  beadId: string;
  workspace: string;
  branch?: string;
  /** True when the issue has the flywheel-change label — narrow scope to skills/ only. */
  isFlywheelChange?: boolean;
}

/**
 * Result of inspection
 */
export interface InspectResult {
  success: boolean;
  inspectResult: 'PASS' | 'BLOCKED';
  beadId: string;
  notes?: string;
}

/**
 * Read a bead's description using the bd CLI.
 */
async function getBeadDescription(beadId: string, workspacePath: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`bd show ${beadId} --json`, {
      cwd: workspacePath,
      encoding: 'utf-8',
    });
    const bead = JSON.parse(stdout);
    const parts: string[] = [];
    if (bead.title) parts.push(`**Title:** ${bead.title}`);
    if (bead.description) parts.push(`**Description:** ${bead.description}`);
    if (bead.acceptance) parts.push(`**Acceptance Criteria:** ${bead.acceptance}`);
    if (bead.notes) parts.push(`**Notes:** ${bead.notes}`);
    if (bead.labels?.length) parts.push(`**Labels:** ${bead.labels.join(', ')}`);
    return parts.join('\n\n') || `Bead ${beadId} (no description available)`;
  } catch {
    // Fallback: try without --json
    try {
      const { stdout } = await execAsync(`bd show ${beadId}`, {
        cwd: workspacePath,
        encoding: 'utf-8',
      });
      return stdout.trim() || `Bead ${beadId} (no description available)`;
    } catch {
      return `Bead ${beadId} (unable to read bead description)`;
    }
  }
}

/**
 * Detect the compile/lint command for the workspace.
 */
function detectCompileCommand(workspacePath: string): string {
  // Check for common project types
  const checks: Array<{ file: string; command: string }> = [
    { file: 'tsconfig.json', command: 'npx tsc --noEmit && npx eslint . --max-warnings=0 2>/dev/null || npx eslint .' },
    { file: 'package.json', command: 'npm run build 2>&1 | tail -20' },
    { file: 'pom.xml', command: './mvnw compile -q' },
    { file: 'Cargo.toml', command: 'cargo check' },
    { file: 'go.mod', command: 'go build ./...' },
  ];

  for (const check of checks) {
    // Check workspace root and common subdirectories
    for (const subdir of ['', 'fe', 'api', 'frontend', 'backend']) {
      const checkPath = subdir ? join(workspacePath, subdir, check.file) : join(workspacePath, check.file);
      if (existsSync(checkPath)) {
        const cwd = subdir ? `cd ${subdir} && ` : '';
        return `${cwd}${check.command}`;
      }
    }
  }

  return 'echo "No compile command detected — skipping compile check"';
}

/**
 * Build the prompt for the inspect specialist.
 */
export async function buildInspectPrompt(context: InspectContext): Promise<string> {
  const templatePath = join(__dirname, 'prompts', 'inspect-agent.md');

  if (!existsSync(templatePath)) {
    throw new Error(`Inspect agent prompt template not found at ${templatePath}`);
  }

  const template = readFileSync(templatePath, 'utf-8');

  // Get bead description
  const beadDescription = await getBeadDescription(context.beadId, context.workspace);

  // Get diff scope
  const diffBase = await getDiffBase(context.projectKey, context.issueId, context.workspace);
  const diffStats = await getDiffStats(context.workspace, diffBase);
  const compileCommand = detectCompileCommand(context.workspace);

  const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${process.env.API_PORT || process.env.PORT || '3011'}`;

  // Build flywheel-change scope constraint (injected when label is set)
  const flywheelSection = context.isFlywheelChange
    ? `\n## CRITICAL: flywheel-change scope constraint\n\nThis issue has the \`flywheel-change\` label. The ONLY files that should be modified\nare \`skills/<name>/SKILL.md\` files. If the diff touches ANY file outside \`skills/\`,\nyou MUST return BLOCKED with reason "mis-scoped: diff includes non-skill files: <list>".\nNormal compile checks still apply to skill file syntax.\n`
    : '';

  // Replace template variables
  const prompt = (template + flywheelSection)
    .replace(/\{\{apiUrl\}\}/g, apiUrl)
    .replace(/\{\{projectPath\}\}/g, context.projectPath)
    .replace(/\{\{issueId\}\}/g, context.issueId)
    .replace(/\{\{beadId\}\}/g, context.beadId)
    .replace(/\{\{workspacePath\}\}/g, context.workspace)
    .replace(/\{\{checkpoint\}\}/g, diffBase.substring(0, 8))
    .replace(/\{\{diffBase\}\}/g, diffBase)
    .replace(/\{\{diffStats\}\}/g, diffStats)
    .replace(/\{\{beadDescription\}\}/g, beadDescription)
    .replace(/\{\{compileCommand\}\}/g, compileCommand)
    .replace(/\{\{resultStatus\}\}/g, '${RESULT_STATUS}')  // Placeholder for specialist to fill
    .replace(/\{\{resultNotes\}\}/g, '${RESULT_NOTES}');    // Placeholder for specialist to fill

  return `<!-- panopticon:orchestration-context-start -->\n${prompt}\n<!-- panopticon:orchestration-context-end -->`;
}

/**
 * Spawn the inspect specialist for a bead.
 */
export async function spawnInspectAgent(context: InspectContext): Promise<{
  success: boolean;
  runId?: string;
  tmuxSession?: string;
  message: string;
  error?: string;
}> {
  // Build the prompt
  const prompt = await buildInspectPrompt(context);

  // Update status to inspecting
  setReviewStatus(context.issueId.toUpperCase(), {
    inspectStatus: 'inspecting',
    inspectNotes: `Inspecting bead ${context.beadId}`,
  });

  // Spawn the ephemeral specialist
  return spawnEphemeralSpecialist(context.projectKey, 'inspect-agent' as SpecialistType, {
    issueId: context.issueId,
    branch: context.branch,
    workspace: context.workspace,
    promptOverride: prompt,
  });
}

/**
 * Handle inspect completion — called when the inspect specialist signals done.
 * Saves checkpoint on PASS.
 */
export async function onInspectComplete(
  projectKey: string,
  issueId: string,
  beadId: string,
  status: 'passed' | 'failed',
  workspacePath: string
): Promise<void> {
  if (status === 'passed') {
    const commitSha = await getCurrentHead(workspacePath);
    saveCheckpoint(projectKey, issueId, beadId, commitSha);
    console.log(`[inspect] Checkpoint saved for ${issueId} bead ${beadId} at ${commitSha.substring(0, 8)}`);

  } else {
    console.log(`[inspect] Bead ${beadId} blocked for ${issueId} — no checkpoint saved`);
  }
}
