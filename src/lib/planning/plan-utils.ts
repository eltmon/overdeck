/**
 * Shared Planning Utilities
 *
 * Extracted from CLI plan command so both CLI and dashboard
 * use the same logic. This is the single source of truth for:
 * - PRD file discovery
 * - Complexity analysis
 * - STATE.md / WORKSPACE.md generation
 * - Beads task creation
 * - PRD directory copy + git commit
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { ComplexityLevel } from '../cloister/complexity.js';
import { hasPRDDraft, getPRDDraftPath } from '../prd-draft.js';
import {
  PROJECT_DOCS_SUBDIR,
  PROJECT_PRDS_SUBDIR,
  PROJECT_PRDS_ACTIVE_SUBDIR,
} from '../paths.js';

const execAsync = promisify(exec);

// ── Types ──

export interface PlanIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  url: string;
  state?: { name: string };
  priority?: number;
  labels?: { name: string }[];
  assignee?: { name: string };
  project?: { name: string };
}

export interface PlanTask {
  name: string;
  description: string;
  dependsOn?: string;
  difficulty?: ComplexityLevel;
}

export interface DiscoveryDecision {
  question: string;
  answer: string;
}

export interface ComplexityAnalysis {
  isComplex: boolean;
  reasons: string[];
  subsystems: string[];
  estimatedTasks: number;
}

export interface PlanResult {
  files: {
    state: string;
    workspace: string;
    prd?: string;
  };
  prdCommitted: boolean;
  beads: {
    success: boolean;
    created: string[];
    errors: string[];
  };
}

// ── PRD Discovery ──

export async function findPRDFiles(issueId: string, cwd?: string): Promise<string[]> {
  const found: string[] = [];
  const searchRoot = cwd || process.cwd();

  // Check pre-workspace PRD drafts first
  if (hasPRDDraft(issueId)) {
    found.push(getPRDDraftPath(issueId));
  }

  const searchPaths = [
    join(PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR, PROJECT_PRDS_ACTIVE_SUBDIR),
    join(PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR, 'planned'),
    join(PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR),
    join(PROJECT_DOCS_SUBDIR, 'prd'),
    PROJECT_PRDS_SUBDIR,
    PROJECT_DOCS_SUBDIR,
  ];

  const issueIdLower = issueId.toLowerCase();

  for (const searchPath of searchPaths) {
    const fullPath = join(searchRoot, searchPath);
    if (!existsSync(fullPath)) continue;

    try {
      const { stdout: result } = await execAsync(
        `find "${fullPath}" -type f -name "*.md" 2>/dev/null | xargs grep -l -i "${issueIdLower}" 2>/dev/null || true`,
        { encoding: 'utf-8' }
      );

      const files = result.trim().split('\n').filter(f => f);
      found.push(...files);
    } catch {
      // Ignore search errors
    }
  }

  return [...new Set(found)];
}

// ── Complexity Analysis ──

export function analyzeComplexity(issue: PlanIssue, prdFiles: string[]): ComplexityAnalysis {
  const reasons: string[] = [];
  const subsystems: string[] = [];
  let estimatedTasks = 1;

  const desc = (issue.description || '').toLowerCase();
  const title = issue.title.toLowerCase();
  const combined = `${title} ${desc}`;

  // Check for multiple subsystems
  if (combined.includes('frontend') || combined.includes('ui') || combined.includes('component')) {
    subsystems.push('frontend');
  }
  if (combined.includes('backend') || combined.includes('api') || combined.includes('endpoint')) {
    subsystems.push('backend');
  }
  if (combined.includes('database') || combined.includes('migration') || combined.includes('schema')) {
    subsystems.push('database');
  }
  if (combined.includes('test') || combined.includes('e2e') || combined.includes('playwright')) {
    subsystems.push('tests');
  }

  if (subsystems.length > 1) {
    reasons.push(`Multiple subsystems involved: ${subsystems.join(', ')}`);
    estimatedTasks += subsystems.length;
  }

  // Check for ambiguous requirements
  const ambiguousPatterns = [
    'should we', 'maybe', 'or', 'consider', 'option', 'approach',
    'tbd', 'to be determined', 'needs discussion', 'unclear'
  ];
  for (const pattern of ambiguousPatterns) {
    if (combined.includes(pattern)) {
      reasons.push('Requirements may be ambiguous');
      break;
    }
  }

  // Check for architecture keywords
  const architecturePatterns = [
    'refactor', 'architecture', 'redesign', 'restructure', 'migrate',
    'integration', 'authentication', 'authorization', 'security'
  ];
  for (const pattern of architecturePatterns) {
    if (combined.includes(pattern)) {
      reasons.push(`Architecture decision needed: ${pattern}`);
      estimatedTasks += 2;
      break;
    }
  }

  if (desc.length > 500) {
    reasons.push('Detailed description suggests complexity');
    estimatedTasks += 1;
  }

  if (prdFiles.length > 0) {
    reasons.push('PRD exists - complexity already documented');
  }

  const complexLabels = ['complex', 'large', 'epic', 'multi-phase', 'architecture'];
  for (const label of issue.labels || []) {
    if (complexLabels.some(cl => label.name.toLowerCase().includes(cl))) {
      reasons.push(`Label indicates complexity: ${label.name}`);
      estimatedTasks += 2;
    }
  }

  const isComplex = reasons.length >= 2 || subsystems.length > 1 || estimatedTasks >= 4;

  return {
    isComplex,
    reasons,
    subsystems,
    estimatedTasks: Math.max(estimatedTasks, subsystems.length + 1),
  };
}

// ── Content Generation ──

export function generateStateContent(
  issue: PlanIssue,
  decisions: DiscoveryDecision[],
  tasks: PlanTask[]
): string {
  const lines: string[] = [
    `# Agent State: ${issue.identifier}`,
    '',
    `**Last Updated:** ${new Date().toISOString()}`,
    '',
    '## Current Position',
    '',
    `- **Issue:** ${issue.identifier}`,
    `- **Title:** ${issue.title}`,
    `- **Status:** Planning complete, ready for execution`,
    `- **Linear:** ${issue.url}`,
    '',
    '## Decisions Made During Planning',
    '',
  ];

  if (decisions.length > 0) {
    for (const decision of decisions) {
      lines.push(`- **${decision.question}:** ${decision.answer}`);
    }
  } else {
    lines.push('- No specific decisions recorded');
  }

  lines.push('');
  lines.push('## Planned Tasks');
  lines.push('');

  for (const task of tasks) {
    lines.push(`- [ ] ${task.name}${task.dependsOn ? ` (after: ${task.dependsOn})` : ''}`);
  }

  lines.push('');
  lines.push('## Blockers/Concerns');
  lines.push('');
  lines.push('- None identified during planning');
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('<!-- Add notes as work progresses -->');
  lines.push('');

  return lines.join('\n');
}

export function generateWorkspaceContent(issue: PlanIssue, prdFiles: string[], cwd?: string): string {
  const searchRoot = cwd || process.cwd();
  const lines: string[] = [
    `# Workspace: ${issue.identifier}`,
    '',
    `> ${issue.title}`,
    '',
    '## Quick Links',
    '',
    `- [Linear Issue](${issue.url})`,
  ];

  for (const prd of prdFiles) {
    const relativePath = prd.replace(searchRoot + '/', '');
    lines.push(`- [PRD](${relativePath})`);
  }

  lines.push('');
  lines.push('## Context Files');
  lines.push('');
  lines.push('- `STATE.md` - Current progress and decisions');
  lines.push('- `WORKSPACE.md` - This file');
  lines.push('');
  lines.push('## Beads');
  lines.push('');
  lines.push('Check current task status:');
  lines.push('```bash');
  lines.push('bd ready  # Next actionable task');
  lines.push(`bd list --tag ${issue.identifier}  # All tasks for this issue`);
  lines.push('```');
  lines.push('');
  lines.push('## Agent Instructions');
  lines.push('');
  lines.push('1. Run `bd ready` to get next task');
  lines.push('2. Complete the task following relevant skills');
  lines.push('3. Run `bd close "<task name>" --reason "..."` when done');
  lines.push('4. Update STATE.md with progress');
  lines.push('5. Repeat until all tasks complete');
  lines.push('');
  lines.push('## CRITICAL: Work Completion Requirements');
  lines.push('');
  lines.push('**You are NOT done until ALL of these are true:**');
  lines.push('');
  lines.push('1. **Tests pass** - Run the full test suite');
  lines.push('2. **All changes committed** - `git status` shows "nothing to commit"');
  lines.push('3. **Pushed to remote** - `git push`');
  lines.push('');
  lines.push('**Uncommitted changes = NOT COMPLETE.**');
  lines.push('');

  return lines.join('\n');
}

// ── Task Difficulty ──

export function estimateTaskDifficulty(task: PlanTask): ComplexityLevel {
  if (task.difficulty) return task.difficulty;

  const combined = `${task.name} ${task.description || ''}`.toLowerCase();

  const expertPatterns = ['architecture', 'security', 'performance optimization', 'distributed', 'auth system', 'redesign'];
  if (expertPatterns.some(p => combined.includes(p))) return 'expert';

  const complexPatterns = ['refactor', 'migration', 'overhaul', 'rewrite', 'integrate', 'multi-system'];
  if (complexPatterns.some(p => combined.includes(p))) return 'complex';

  const mediumPatterns = ['implement', 'feature', 'endpoint', 'component', 'service', 'integration', 'add tests'];
  if (mediumPatterns.some(p => combined.includes(p))) return 'medium';

  const trivialPatterns = ['typo', 'rename', 'comment', 'documentation', 'readme', 'formatting'];
  if (trivialPatterns.some(p => combined.includes(p))) return 'trivial';

  return 'simple';
}

// ── Beads Task Creation ──

export async function createBeadsTasks(
  issue: PlanIssue,
  tasks: PlanTask[],
  cwd?: string
): Promise<{ success: boolean; created: string[]; errors: string[] }> {
  const created: string[] = [];
  const errors: string[] = [];
  const taskIds = new Map<string, string>();
  const workDir = cwd || process.cwd();

  try {
    await execAsync('which bd', { encoding: 'utf-8' });
  } catch {
    return { success: false, created: [], errors: ['bd (beads) CLI not found in PATH'] };
  }

  for (const task of tasks) {
    const fullName = `${issue.identifier}: ${task.name}`;

    try {
      const difficulty = estimateTaskDifficulty(task);
      const escapedName = fullName.replace(/"/g, '\\"');
      let cmd = `bd create "${escapedName}" --type task -l "${issue.identifier},linear,difficulty:${difficulty}"`;

      if (task.dependsOn) {
        const depName = `${issue.identifier}: ${task.dependsOn}`;
        const depId = taskIds.get(depName);
        if (depId) {
          cmd += ` --deps "blocks:${depId}"`;
        }
      }

      if (task.description) {
        const escapedDesc = task.description.replace(/"/g, '\\"');
        cmd += ` -d "${escapedDesc}"`;
      }

      const { stdout: result } = await execAsync(cmd, { encoding: 'utf-8', cwd: workDir });
      const idMatch = result.match(/bd-[a-f0-9]+/i) || result.match(/([a-f0-9-]{8,})/i);
      if (idMatch) {
        taskIds.set(fullName, idMatch[0]);
      }

      created.push(fullName);
    } catch (error: any) {
      const errMsg = error.stderr?.toString() || error.message;
      errors.push(`Failed to create "${task.name}": ${errMsg.split('\n')[0]}`);
    }
  }

  if (created.length > 0) {
    try {
      await execAsync('bd flush', { encoding: 'utf-8', cwd: workDir });
    } catch {
      // Flush might fail if no changes, that's OK
    }
  }

  return { success: errors.length === 0, created, errors };
}

// ── File Writing ──

export function writePlanFiles(
  projectPath: string,
  stateContent: string,
  workspaceContent: string
): { statePath: string; workspacePath: string } {
  const planningDir = join(projectPath, '.planning');
  mkdirSync(planningDir, { recursive: true });

  const statePath = join(planningDir, 'STATE.md');
  const workspacePath = join(planningDir, 'WORKSPACE.md');
  writeFileSync(statePath, stateContent);
  writeFileSync(workspacePath, workspaceContent);

  return { statePath, workspacePath };
}

/**
 * Copy plan to PRD directory and optionally commit+push
 */
export async function copyToPRDDirectory(
  projectPath: string,
  issue: PlanIssue,
  content: string,
  options?: { commitAndPush?: boolean }
): Promise<{ prdPath: string | null; committed: boolean }> {
  const prdDir = join(projectPath, PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR, PROJECT_PRDS_ACTIVE_SUBDIR);

  try {
    mkdirSync(prdDir, { recursive: true });
    const filename = `${issue.identifier.toLowerCase()}-plan.md`;
    const prdPath = join(prdDir, filename);
    writeFileSync(prdPath, content);

    let committed = false;

    if (options?.commitAndPush) {
      try {
        const relativePrdPath = join(PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR, PROJECT_PRDS_ACTIVE_SUBDIR, filename);
        await execAsync(`git add ${relativePrdPath}`, { cwd: projectPath, encoding: 'utf-8' });

        try {
          await execAsync('git diff --cached --quiet', { cwd: projectPath, encoding: 'utf-8' });
          // No changes - already committed
        } catch {
          // Changes exist, commit them
          await execAsync(`git commit -m "docs: add ${issue.identifier} PRD to active"`, {
            cwd: projectPath,
            encoding: 'utf-8',
          });
          // Push in background (non-blocking)
          const pushChild = spawn('git', ['push'], { cwd: projectPath, detached: true, stdio: 'ignore' });
          pushChild.unref();
          committed = true;
        }
      } catch (gitErr: any) {
        console.warn(`[plan] Could not commit PRD (non-fatal): ${gitErr.message}`);
      }
    }

    return { prdPath, committed };
  } catch {
    return { prdPath: null, committed: false };
  }
}

// ── Full Plan Execution ──

/**
 * Execute the full plan creation pipeline.
 * Used by both CLI `pan work plan` and dashboard `POST /api/issues/:id/plan`.
 */
export async function executePlan(
  issue: PlanIssue,
  tasks: PlanTask[],
  decisions: DiscoveryDecision[],
  projectPath: string,
  options?: {
    commitAndPush?: boolean;
    prdFiles?: string[];
  }
): Promise<PlanResult> {
  const prdFiles = options?.prdFiles || [];

  // Generate content
  const stateContent = generateStateContent(issue, decisions, tasks);
  const workspaceContent = generateWorkspaceContent(issue, prdFiles, projectPath);

  // Write .planning/ files
  const { statePath, workspacePath } = writePlanFiles(projectPath, stateContent, workspaceContent);

  // Copy to PRD directory
  const { prdPath, committed } = await copyToPRDDirectory(
    projectPath,
    issue,
    stateContent,
    { commitAndPush: options?.commitAndPush ?? false }
  );

  // Create Beads tasks
  const beads = await createBeadsTasks(issue, tasks, projectPath);

  return {
    files: {
      state: statePath,
      workspace: workspacePath,
      prd: prdPath || undefined,
    },
    prdCommitted: committed,
    beads,
  };
}
