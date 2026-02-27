/**
 * Convoy Templates - Define multi-agent orchestration patterns
 *
 * Templates specify which subagents to spawn for parallel execution,
 * their dependencies, and execution order.
 */

export interface ConvoyAgent {
  /** Unique role identifier within the convoy */
  role: string;

  /** Subagent template name (references agents/*.md) */
  subagent: string;

  /** Whether this agent runs in parallel with others */
  parallel: boolean;

  /** Roles this agent depends on (must complete before this starts) */
  dependsOn?: string[];

  /** Additional parameters to pass to the agent */
  params?: Record<string, any>;
}

export interface ConvoyTemplate {
  /** Template identifier (used with --template flag) */
  name: string;

  /** Human-readable description */
  description: string;

  /** Agents to spawn for this convoy type */
  agents: ConvoyAgent[];

  /** Optional shared configuration */
  config?: {
    /** Directory for agents to write output */
    outputDir?: string;

    /** Maximum parallel agents (default: no limit) */
    maxParallel?: number;

    /** Timeout for each agent in milliseconds */
    timeout?: number;
  };
}

/**
 * Code Review Template
 *
 * Spawns 3 parallel review agents followed by a synthesis agent.
 * Each reviewer focuses on a specific aspect (correctness, security, performance).
 * The synthesis agent combines all findings into a unified report.
 */
export const CODE_REVIEW_TEMPLATE: ConvoyTemplate = {
  name: 'code-review',
  description: 'Parallel code review with automatic synthesis',
  agents: [
    {
      role: 'correctness',
      subagent: 'code-review-correctness',
      parallel: true,
    },
    {
      role: 'security',
      subagent: 'code-review-security',
      parallel: true,
    },
    {
      role: 'performance',
      subagent: 'code-review-performance',
      parallel: true,
    },
    {
      role: 'synthesis',
      subagent: 'code-review-synthesis',
      parallel: false,
      dependsOn: ['correctness', 'security', 'performance'],
    },
  ],
  config: {
    outputDir: '.claude/reviews',
    maxParallel: 3, // Limit parallel reviewers
    timeout: 600000, // 10 minutes per agent
  },
};

/**
 * Triage Template
 *
 * Triages multiple issues in parallel.
 * Each agent categorizes and estimates one issue.
 */
export const TRIAGE_TEMPLATE: ConvoyTemplate = {
  name: 'triage',
  description: 'Parallel issue triage and categorization',
  agents: [
    // Agents are dynamically added based on issues to triage
    // This is a placeholder template; actual agents created at runtime
  ],
  config: {
    outputDir: '.panopticon/triage',
    maxParallel: 5, // Limit concurrent triage agents
  },
};

/**
 * Health Monitor Template
 *
 * Single health monitoring agent that checks all running agents.
 */
export const HEALTH_MONITOR_TEMPLATE: ConvoyTemplate = {
  name: 'health-monitor',
  description: 'Monitor health of running agents',
  agents: [
    {
      role: 'monitor',
      subagent: 'health-monitor',
      parallel: false,
    },
  ],
  config: {
    outputDir: '.panopticon/health',
  },
};

/**
 * Registry of all available convoy templates
 */
export const CONVOY_TEMPLATES: Record<string, ConvoyTemplate> = {
  'code-review': CODE_REVIEW_TEMPLATE,
  'triage': TRIAGE_TEMPLATE,
  'health-monitor': HEALTH_MONITOR_TEMPLATE,
};

/**
 * Get a convoy template by name
 */
export function getConvoyTemplate(name: string): ConvoyTemplate | undefined {
  return CONVOY_TEMPLATES[name];
}

/**
 * List all available convoy templates
 */
export function listConvoyTemplates(): ConvoyTemplate[] {
  return Object.values(CONVOY_TEMPLATES);
}

/**
 * Validate a convoy template
 */
export function validateConvoyTemplate(template: ConvoyTemplate): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for required fields
  if (!template.name) {
    errors.push('Template must have a name');
  }

  if (!template.description) {
    errors.push('Template must have a description');
  }

  if (!template.agents || template.agents.length === 0) {
    errors.push('Template must have at least one agent');
  }

  // Validate agents
  const roles = new Set<string>();
  for (const agent of template.agents || []) {
    // Check for duplicate roles
    if (roles.has(agent.role)) {
      errors.push(`Duplicate role: ${agent.role}`);
    }
    roles.add(agent.role);

    // Validate dependencies
    if (agent.dependsOn) {
      for (const dep of agent.dependsOn) {
        if (!roles.has(dep) && dep !== agent.role) {
          // Note: This only catches forward dependencies
          // Circular dependency detection would require graph analysis
          errors.push(`Agent ${agent.role} depends on unknown role: ${dep}`);
        }
      }
    }

    // Validate subagent reference
    if (!agent.subagent) {
      errors.push(`Agent ${agent.role} must specify a subagent template`);
    }
  }

  // Detect circular dependencies (simple check)
  const graph = new Map<string, string[]>();
  for (const agent of template.agents || []) {
    graph.set(agent.role, agent.dependsOn || []);
  }

  function hasCycle(node: string, visited: Set<string>, recStack: Set<string>): boolean {
    visited.add(node);
    recStack.add(node);

    const deps = graph.get(node) || [];
    for (const dep of deps) {
      if (!visited.has(dep)) {
        if (hasCycle(dep, visited, recStack)) {
          return true;
        }
      } else if (recStack.has(dep)) {
        return true;
      }
    }

    recStack.delete(node);
    return false;
  }

  const visited = new Set<string>();
  for (const role of roles) {
    if (!visited.has(role)) {
      if (hasCycle(role, visited, new Set())) {
        errors.push('Template contains circular dependencies');
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get execution order for convoy agents
 * Returns agents grouped by execution phase (parallel groups)
 */
export function getExecutionOrder(template: ConvoyTemplate): ConvoyAgent[][] {
  const agents = [...template.agents];
  const phases: ConvoyAgent[][] = [];
  const completed = new Set<string>();

  while (agents.length > 0) {
    // Find agents whose dependencies are all completed
    const ready = agents.filter((agent) => {
      const deps = agent.dependsOn || [];
      return deps.every((dep) => completed.has(dep));
    });

    if (ready.length === 0) {
      // No agents are ready - likely circular dependency
      throw new Error('Cannot determine execution order: circular dependency or invalid template');
    }

    // Separate parallel and sequential agents
    const parallel = ready.filter((a) => a.parallel);
    const sequential = ready.filter((a) => !a.parallel);

    // Add parallel agents as one phase
    if (parallel.length > 0) {
      phases.push(parallel);
      parallel.forEach((a) => completed.add(a.role));
      agents.splice(agents.indexOf(parallel[0]), parallel.length);
    }

    // Add each sequential agent as its own phase
    for (const agent of sequential) {
      phases.push([agent]);
      completed.add(agent.role);
      agents.splice(agents.indexOf(agent), 1);
    }
  }

  return phases;
}
