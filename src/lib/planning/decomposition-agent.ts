import { spawnAgent } from '../agents.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Decomposition Agent - Breaks down work into tasks
 *
 * Uses work type ID: 'decomposition-agent'
 *
 * This agent takes a planning document (PRD or STATE.md) and:
 * - Identifies discrete tasks
 * - Determines dependencies between tasks
 * - Estimates difficulty for each task
 * - Creates Beads tasks with proper dependency links
 */

export interface Task {
  name: string;
  description: string;
  dependsOn?: string[];
  difficulty?: 'trivial' | 'simple' | 'medium' | 'complex' | 'expert';
  estimatedHours?: number;
  labels?: string[];
}

export interface DecompositionResult {
  issueId: string;
  tasks: Task[];
  created: string[];
  errors: string[];
}

export interface DecompositionOptions {
  issueId: string;
  workspace: string;
  planningDocPath?: string; // Path to STATE.md or PRD.md
  createBeads?: boolean; // Whether to create actual Beads tasks (default: true)
}

/**
 * Decompose work based on planning document
 *
 * Reads STATE.md or PRD.md and generates tasks
 */
export async function decomposeWork(options: DecompositionOptions): Promise<DecompositionResult> {
  const { issueId, workspace, planningDocPath, createBeads = true } = options;

  // Find planning document
  const planningDir = join(workspace, '.planning');
  const docPath = planningDocPath ||
    (existsSync(join(planningDir, 'PRD.md')) ? join(planningDir, 'PRD.md') : join(planningDir, 'STATE.md'));

  if (!existsSync(docPath)) {
    throw new Error(`Planning document not found at ${docPath}`);
  }

  // Read planning document
  const planningDoc = readFileSync(docPath, 'utf-8');

  // Parse tasks from planning doc (look for task lists)
  const tasks = parseTasksFromDocument(planningDoc, issueId);

  // Create Beads tasks if requested
  let created: string[] = [];
  let errors: string[] = [];

  if (createBeads && tasks.length > 0) {
    const beadsResult = await createBeadsTasks(issueId, tasks);
    created = beadsResult.created;
    errors = beadsResult.errors;
  }

  return {
    issueId,
    tasks,
    created,
    errors,
  };
}

/**
 * Parse tasks from planning document
 *
 * Looks for:
 * - Markdown task lists: - [ ] Task name
 * - Numbered lists: 1. Task name
 * - Section headers that describe tasks
 */
function parseTasksFromDocument(content: string, issueId: string): Task[] {
  const tasks: Task[] = [];
  const lines = content.split('\n');

  let currentSection = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track current section (for context)
    if (line.startsWith('#')) {
      currentSection = line.replace(/^#+\s*/, '').trim();
      continue;
    }

    // Parse task list items: - [ ] Task name
    const taskMatch = line.match(/^[-*]\s*\[\s*\]\s*(.+)$/);
    if (taskMatch) {
      const taskName = taskMatch[1].trim();

      // Look for dependency hints: (after: X) or (depends on: X)
      const depMatch = taskName.match(/\((?:after|depends on):\s*([^)]+)\)/i);
      const cleanName = depMatch ? taskName.replace(depMatch[0], '').trim() : taskName;

      tasks.push({
        name: cleanName,
        description: `${currentSection ? `${currentSection}: ` : ''}${cleanName}`,
        dependsOn: depMatch ? [depMatch[1].trim()] : undefined,
        difficulty: estimateTaskDifficulty(cleanName),
      });
      continue;
    }

    // Parse numbered lists: 1. Task name
    const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      const taskName = numberedMatch[1].trim();
      const depMatch = taskName.match(/\((?:after|depends on):\s*([^)]+)\)/i);
      const cleanName = depMatch ? taskName.replace(depMatch[0], '').trim() : taskName;

      tasks.push({
        name: cleanName,
        description: `${currentSection ? `${currentSection}: ` : ''}${cleanName}`,
        dependsOn: depMatch ? [depMatch[1].trim()] : undefined,
        difficulty: estimateTaskDifficulty(cleanName),
      });
    }
  }

  return tasks;
}

/**
 * Estimate task difficulty based on name
 */
function estimateTaskDifficulty(taskName: string): 'trivial' | 'simple' | 'medium' | 'complex' | 'expert' {
  const name = taskName.toLowerCase();

  // Trivial: docs, config, typos
  if (
    name.includes('update readme') ||
    name.includes('fix typo') ||
    name.includes('add comment')
  ) {
    return 'trivial';
  }

  // Expert: architecture, security, distributed
  if (
    name.includes('design architecture') ||
    name.includes('security') ||
    name.includes('authentication') ||
    name.includes('distributed')
  ) {
    return 'expert';
  }

  // Complex: refactor, migration, multi-system
  if (
    name.includes('refactor') ||
    name.includes('migrate') ||
    name.includes('redesign') ||
    name.includes('integrate')
  ) {
    return 'complex';
  }

  // Medium: implement, add feature, endpoint
  if (
    name.includes('implement') ||
    name.includes('add') ||
    name.includes('create') ||
    name.includes('endpoint')
  ) {
    return 'medium';
  }

  // Default: simple
  return 'simple';
}

/**
 * Create Beads tasks from task list
 */
async function createBeadsTasks(
  issueId: string,
  tasks: Task[]
): Promise<{ created: string[]; errors: string[] }> {
  const created: string[] = [];
  const errors: string[] = [];
  const taskIds: Map<string, string> = new Map();

  // Check if bd is available
  try {
    await execAsync('which bd', { encoding: 'utf-8' });
  } catch {
    return { created: [], errors: ['bd (beads) CLI not found in PATH'] };
  }

  for (const task of tasks) {
    const fullName = `${issueId}: ${task.name}`;

    try {
      // Build bd create command
      const escapedName = fullName.replace(/"/g, '\\"');
      const difficulty = task.difficulty || 'simple';
      let cmd = `bd create "${escapedName}" --type task -l "${issueId},linear,difficulty:${difficulty}"`;

      // Add dependencies
      if (task.dependsOn && task.dependsOn.length > 0) {
        for (const depName of task.dependsOn) {
          const fullDepName = `${issueId}: ${depName}`;
          const depId = taskIds.get(fullDepName);
          if (depId) {
            cmd += ` --deps "blocks:${depId}"`;
          }
        }
      }

      // Add description
      if (task.description) {
        const escapedDesc = task.description.replace(/"/g, '\\"');
        cmd += ` -d "${escapedDesc}"`;
      }

      const { stdout: result } = await execAsync(cmd, { encoding: 'utf-8' });

      // Extract ID from output
      const idMatch = result.match(/panopticon-[a-z0-9]+/i) || result.match(/([a-f0-9-]{8,})/i);
      if (idMatch) {
        taskIds.set(fullName, idMatch[0]);
      }

      created.push(fullName);
    } catch (error: any) {
      const errMsg = error.stderr?.toString() || error.message;
      errors.push(`Failed to create "${task.name}": ${errMsg.split('\n')[0]}`);
    }
  }

  // Sync beads to git
  if (created.length > 0) {
    try {
      await execAsync('bd sync', { encoding: 'utf-8' });
    } catch {
      // Sync might fail, that's OK
    }
  }

  return { created, errors };
}

/**
 * Spawn decomposition agent for AI-powered task breakdown
 *
 * Use this when:
 * - Planning document is complex
 * - Tasks aren't clearly defined
 * - Dependencies are unclear
 */
export async function spawnDecompositionAgent(
  issueId: string,
  workspace: string,
  planningDocPath?: string,
  prompt?: string
) {
  const agentPrompt = prompt || `
You are a decomposition agent. Your job is to break down work into discrete tasks.

1. Read the planning document (STATE.md or PRD.md in .planning/ directory)

2. Identify all discrete tasks needed to complete the work

3. For each task, determine:
   - Clear, actionable name
   - Detailed description
   - Dependencies on other tasks
   - Estimated difficulty (trivial, simple, medium, complex, expert)

4. Create Beads tasks using the 'bd create' command

5. Ensure proper dependency links:
   - Use '--deps "blocks:task-id"' for dependencies
   - Tasks should be in logical execution order

6. Update STATE.md with the task list

7. Provide a summary of tasks created

Guidelines:
- Tasks should be small enough to complete in one session (2-4 hours)
- Each task should have a clear completion criteria
- Dependencies should form a DAG (no cycles)
- Group related tasks but keep them independent where possible
`.trim();

  return spawnAgent({
    issueId,
    workspace,
    workType: 'decomposition-agent',
    prompt: agentPrompt,
  });
}

/**
 * Validate task dependencies (check for cycles)
 */
export function validateTaskDependencies(tasks: Task[]): { valid: boolean; cycles: string[][] } {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(taskName: string, path: string[] = []): boolean {
    if (recursionStack.has(taskName)) {
      // Found cycle
      const cycleStart = path.indexOf(taskName);
      cycles.push([...path.slice(cycleStart), taskName]);
      return true;
    }

    if (visited.has(taskName)) {
      return false;
    }

    visited.add(taskName);
    recursionStack.add(taskName);
    path.push(taskName);

    const task = tasks.find(t => t.name === taskName);
    if (task && task.dependsOn) {
      for (const dep of task.dependsOn) {
        if (hasCycle(dep, [...path])) {
          return true;
        }
      }
    }

    recursionStack.delete(taskName);
    return false;
  }

  for (const task of tasks) {
    if (!visited.has(task.name)) {
      hasCycle(task.name);
    }
  }

  return { valid: cycles.length === 0, cycles };
}
