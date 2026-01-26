import { spawnAgent } from '../agents.js';

/**
 * Triage Agent - Issue prioritization and classification
 *
 * Uses work type ID: 'triage-agent'
 *
 * This agent analyzes issues to determine:
 * - Priority (P0-P4)
 * - Complexity (trivial, simple, medium, complex, expert)
 * - Required skills/specialists
 * - Estimated effort
 * - Dependencies
 */

export interface TriageResult {
  issueId: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  complexity: 'trivial' | 'simple' | 'medium' | 'complex' | 'expert';
  estimatedHours: number;
  requiredSkills: string[];
  dependencies: string[];
  needsPRD: boolean;
  needsPlanning: boolean;
  recommendation: string;
}

export interface TriageOptions {
  issueId: string;
  title: string;
  description?: string;
  labels?: string[];
  currentPriority?: number; // Linear priority (0-4)
}

/**
 * Perform automated triage analysis
 *
 * This is a rule-based triage system that can run without spawning an agent.
 * For complex triage decisions, use spawnTriageAgent() instead.
 */
export function analyzeIssue(options: TriageOptions): TriageResult {
  const { issueId, title, description = '', labels = [], currentPriority } = options;

  const combined = `${title} ${description}`.toLowerCase();

  // Determine priority
  let priority: TriageResult['priority'] = 'P3'; // Default

  // P0: Production outage, security vulnerability
  if (
    combined.includes('production') && combined.includes('down') ||
    combined.includes('security vulnerability') ||
    combined.includes('data loss')
  ) {
    priority = 'P0';
  }
  // P1: Critical bug affecting users
  else if (
    combined.includes('critical') ||
    combined.includes('blocker') ||
    combined.includes('cannot') && (combined.includes('login') || combined.includes('deploy'))
  ) {
    priority = 'P1';
  }
  // P2: Important feature or significant bug
  else if (
    combined.includes('important') ||
    combined.includes('high priority') ||
    labels.some(l => l.includes('high'))
  ) {
    priority = 'P2';
  }
  // P4: Nice to have, low impact
  else if (
    combined.includes('nice to have') ||
    combined.includes('enhancement') ||
    combined.includes('polish')
  ) {
    priority = 'P4';
  }
  // Use Linear priority if provided
  else if (currentPriority !== undefined) {
    priority = `P${Math.min(currentPriority, 4)}` as TriageResult['priority'];
  }

  // Determine complexity
  let complexity: TriageResult['complexity'] = 'simple';
  let estimatedHours = 2;

  // Trivial: typo, docs, config change
  if (
    combined.includes('typo') ||
    combined.includes('documentation only') ||
    combined.includes('update readme')
  ) {
    complexity = 'trivial';
    estimatedHours = 0.5;
  }
  // Expert: Architecture, distributed systems, security
  else if (
    combined.includes('architecture') ||
    combined.includes('distributed') ||
    combined.includes('security model') ||
    combined.includes('authentication system')
  ) {
    complexity = 'expert';
    estimatedHours = 16;
  }
  // Complex: Multi-system, refactor, migration
  else if (
    combined.includes('refactor') ||
    combined.includes('migration') ||
    combined.includes('redesign') ||
    (combined.includes('frontend') && combined.includes('backend'))
  ) {
    complexity = 'complex';
    estimatedHours = 8;
  }
  // Medium: New feature, API endpoint, component
  else if (
    combined.includes('new feature') ||
    combined.includes('implement') ||
    combined.includes('endpoint') ||
    combined.includes('component')
  ) {
    complexity = 'medium';
    estimatedHours = 4;
  }

  // Determine required skills
  const requiredSkills: string[] = [];
  if (combined.includes('frontend') || combined.includes('ui') || combined.includes('react')) {
    requiredSkills.push('frontend');
  }
  if (combined.includes('backend') || combined.includes('api') || combined.includes('server')) {
    requiredSkills.push('backend');
  }
  if (combined.includes('database') || combined.includes('sql') || combined.includes('schema')) {
    requiredSkills.push('database');
  }
  if (combined.includes('devops') || combined.includes('deploy') || combined.includes('docker')) {
    requiredSkills.push('devops');
  }
  if (combined.includes('test') || combined.includes('e2e') || combined.includes('playwright')) {
    requiredSkills.push('testing');
  }

  // Check for dependencies
  const dependencies: string[] = [];
  // Pattern: "depends on #XXX" or "blocked by #XXX"
  const depMatches = combined.match(/(?:depends on|blocked by|requires)\s+#?([a-z]+-\d+)/gi);
  if (depMatches) {
    dependencies.push(...depMatches.map(m => m.split(/\s+/).pop() || '').filter(Boolean));
  }

  // Determine if PRD needed
  const needsPRD = complexity === 'complex' || complexity === 'expert' ||
    combined.includes('unclear') ||
    combined.includes('needs discussion') ||
    combined.includes('tbd');

  // Determine if planning needed
  const needsPlanning = complexity === 'complex' || complexity === 'expert' ||
    requiredSkills.length > 2;

  // Generate recommendation
  let recommendation = '';
  if (priority === 'P0' || priority === 'P1') {
    recommendation = 'High priority - start immediately with available resources';
  } else if (needsPRD) {
    recommendation = `Run 'pan prd ${issueId}' to clarify requirements before implementation`;
  } else if (needsPlanning) {
    recommendation = `Run 'pan work plan ${issueId}' to create execution plan`;
  } else {
    recommendation = `Ready to implement - run 'pan work issue ${issueId}'`;
  }

  return {
    issueId,
    priority,
    complexity,
    estimatedHours,
    requiredSkills,
    dependencies,
    needsPRD,
    needsPlanning,
    recommendation,
  };
}

/**
 * Spawn triage agent for complex triage decisions
 *
 * Use this when automated triage is insufficient or when you need
 * AI-powered analysis of requirements, dependencies, and risks.
 */
export async function spawnTriageAgent(issueId: string, workspace: string, prompt?: string) {
  const agentPrompt = prompt || `
You are a triage agent for software development issues. Your job is to:

1. Analyze the issue description and context
2. Determine:
   - Priority (P0-P4)
   - Complexity (trivial, simple, medium, complex, expert)
   - Estimated effort in hours
   - Required skills (frontend, backend, devops, testing, etc.)
   - Dependencies on other issues
   - Whether PRD is needed
   - Whether planning phase is needed

3. Provide a recommendation on next steps

4. Update the issue with labels and priority if needed

5. Create a triage report in .planning/TRIAGE.md

Be thorough but decisive. Use your judgment based on:
- Technical complexity
- Business impact
- User impact
- Risk factors
- Available information
`.trim();

  return spawnAgent({
    issueId,
    workspace,
    workType: 'triage-agent',
    prompt: agentPrompt,
  });
}

/**
 * Batch triage multiple issues
 *
 * Useful for processing a backlog of issues
 */
export function triageMultiple(issues: TriageOptions[]): TriageResult[] {
  return issues.map(analyzeIssue);
}

/**
 * Sort issues by triage results (priority + complexity)
 */
export function sortByPriority(results: TriageResult[]): TriageResult[] {
  const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
  const complexityOrder = { trivial: 0, simple: 1, medium: 2, complex: 3, expert: 4 };

  return results.sort((a, b) => {
    // First sort by priority
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;

    // Then by complexity (simpler first for same priority)
    return complexityOrder[a.complexity] - complexityOrder[b.complexity];
  });
}
