/**
 * Planning Module - Pre-work agents for requirement gathering and planning
 *
 * This module provides agents and utilities for work that happens BEFORE
 * implementation begins:
 *
 * - PRD Agent: Q&A-driven Product Requirement Document generation
 * - Triage Agent: Issue prioritization and classification
 * - Planning Agent: Architecture and approach planning (HOW to build)
 * - Decomposition Agent: Task breakdown (WHAT tasks to create)
 *
 * These agents use work type IDs from the work type registry for proper
 * model routing according to presets and user configuration.
 */

// PRD Agent
export {
  generatePRD,
  spawnPRDAgent,
  type PRDSection,
  type PRDDocument,
  type PRDGenerationOptions,
} from './prd-agent.js';

// Triage Agent
export {
  analyzeIssue,
  spawnTriageAgent,
  triageMultiple,
  sortByPriority,
  type TriageResult,
  type TriageOptions,
} from './triage-agent.js';

// Planning Agent (Architecture focus)
export {
  generatePlanningDocument,
  createPlanningDocument,
  spawnPlanningAgent,
  validatePlanningDocument,
  type PlanningOptions,
  type ArchitectureDecision,
  type PlanningDocument,
} from './planning-agent.js';

// Decomposition Agent (Task breakdown)
export {
  decomposeWork,
  spawnDecompositionAgent,
  validateTaskDependencies,
  type Task,
  type DecompositionResult,
  type DecompositionOptions,
} from './decomposition-agent.js';

/**
 * Complete pre-work workflow
 *
 * This is the recommended sequence for complex issues:
 *
 * 1. **Triage**: Analyze priority, complexity, dependencies
 *    - If P0/P1: Skip to implementation
 *    - If unclear requirements: Go to PRD
 *    - If clear requirements: Go to Planning
 *
 * 2. **PRD** (if needed): Generate Product Requirements Document
 *    - Q&A-driven requirement gathering
 *    - Outputs: .planning/PRD.md
 *
 * 3. **Planning**: Architecture and approach
 *    - HOW should we build this?
 *    - What are the key design decisions?
 *    - Outputs: .planning/STATE.md
 *
 * 4. **Decomposition**: Task breakdown
 *    - WHAT are the discrete tasks?
 *    - What are the dependencies?
 *    - Outputs: Beads tasks
 *
 * 5. **Implementation**: Execute tasks
 *    - Use `pan work issue <id>` to spawn work agent
 *    - Agent uses `bd ready` to get next task
 */

/**
 * Workflow integration function
 *
 * Determines which pre-work agents to run based on triage results
 */
export async function runPreWorkflow(options: {
  issueId: string;
  workspace: string;
  title: string;
  description?: string;
  skipTriage?: boolean;
  skipPRD?: boolean;
  skipPlanning?: boolean;
  skipDecomposition?: boolean;
}): Promise<{
  triage?: any;
  prd?: string;
  planning?: string;
  decomposition?: any;
}> {
  const results: any = {};

  // Step 1: Triage
  if (!options.skipTriage) {
    const { analyzeIssue } = await import('./triage-agent.js');
    const triageResult = analyzeIssue({
      issueId: options.issueId,
      title: options.title,
      description: options.description,
    });
    results.triage = triageResult;

    // Check if we can skip planning for simple issues
    if (triageResult.complexity === 'trivial' || triageResult.complexity === 'simple') {
      console.log(`Issue ${options.issueId} is ${triageResult.complexity} - skipping planning`);
      return results;
    }

    // Check if PRD is needed
    if (!triageResult.needsPRD) {
      options.skipPRD = true;
    }

    // Check if planning is needed
    if (!triageResult.needsPlanning) {
      options.skipPlanning = true;
      options.skipDecomposition = true;
    }
  }

  // Step 2: PRD (if needed)
  if (!options.skipPRD) {
    const { generatePRD } = await import('./prd-agent.js');
    const prdPath = await generatePRD({
      issueId: options.issueId,
      workspace: options.workspace,
      title: options.title,
      description: options.description,
    });
    results.prd = prdPath;
  }

  // Step 3: Planning (architecture)
  if (!options.skipPlanning) {
    const { createPlanningDocument } = await import('./planning-agent.js');
    const planningPath = createPlanningDocument({
      issueId: options.issueId,
      workspace: options.workspace,
      title: options.title,
      description: options.description,
      prdPath: results.prd,
    });
    results.planning = planningPath;
  }

  // Step 4: Decomposition (tasks)
  if (!options.skipDecomposition && results.planning) {
    const { decomposeWork } = await import('./decomposition-agent.js');
    const decompositionResult = await decomposeWork({
      issueId: options.issueId,
      workspace: options.workspace,
      planningDocPath: results.planning,
      createBeads: true,
    });
    results.decomposition = decompositionResult;
  }

  return results;
}
