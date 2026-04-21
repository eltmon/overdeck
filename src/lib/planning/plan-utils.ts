/**
 * Shared Planning Utilities
 *
 * Extracted from CLI plan command so both CLI and dashboard
 * use the same logic. This is the single source of truth for:
 * - PRD file discovery
 * - Complexity analysis
 * - STATE.md generation
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
    prd?: string;
  };
  prdCommitted: boolean;
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

// ── File Writing ──

export function writePlanFiles(
  projectPath: string,
  stateContent: string
): { statePath: string } {
  const planningDir = join(projectPath, '.planning');
  mkdirSync(planningDir, { recursive: true });

  const statePath = join(planningDir, 'STATE.md');
  writeFileSync(statePath, stateContent);

  return { statePath };
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
 * Used by dashboard `POST /api/issues/:id/plan` and `pan plan-finalize`.
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
  // Generate STATE.md content
  const stateContent = generateStateContent(issue, decisions, tasks);

  // Write .planning/STATE.md
  const { statePath } = writePlanFiles(projectPath, stateContent);

  // Copy to PRD directory
  const { prdPath, committed } = await copyToPRDDirectory(
    projectPath,
    issue,
    stateContent,
    { commitAndPush: options?.commitAndPush ?? false }
  );

  return {
    files: {
      state: statePath,
      prd: prdPath || undefined,
    },
    prdCommitted: committed,
  };
}
