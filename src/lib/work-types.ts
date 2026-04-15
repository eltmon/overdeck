/**
 * Work Type Registry
 *
 * Central registry of all work type IDs used for model routing.
 * Each work type represents a specific context where AI agents operate,
 * allowing fine-grained control over which models handle which tasks.
 */

/**
 * Metadata for each work type
 */
export interface WorkTypeMetadata {
  /** Broad category this work type belongs to */
  category: 'issue-agent' | 'specialist' | 'subagent' | 'review' | 'pre-work' | 'workflow' | 'cli';
  /** Optional phase within the category (e.g., for issue-agent phases) */
  phase?: string;
  /** Human-readable description */
  description: string;
}

/**
 * Complete registry of all routable work types with metadata.
 *
 * These IDs are the canonical source for model routing and settings overrides.
 */
export const WORK_TYPES = {
  // Issue agent phases (6)
  'issue-agent:exploration': {
    phase: 'exploration',
    category: 'issue-agent',
    description: 'Exploring codebase and understanding requirements',
  },
  'issue-agent:implementation': {
    phase: 'implementation',
    category: 'issue-agent',
    description: 'Writing code to implement features or fixes',
  },
  'issue-agent:testing': {
    phase: 'testing',
    category: 'issue-agent',
    description: 'Running tests and verifying functionality',
  },
  'issue-agent:documentation': {
    phase: 'documentation',
    category: 'issue-agent',
    description: 'Writing documentation and updating docs',
  },
  'issue-agent:review-response': {
    phase: 'review-response',
    category: 'issue-agent',
    description: 'Responding to code review feedback',
  },

  // Specialist agents (5)
  'specialist-review-agent': {
    category: 'specialist',
    description: 'Comprehensive code review specialist',
  },
  'specialist-test-agent': {
    category: 'specialist',
    description: 'Test generation and verification specialist',
  },
  'specialist-merge-agent': {
    category: 'specialist',
    description: 'Merge request finalization specialist',
  },
  'specialist-inspect-agent': {
    category: 'specialist',
    description: 'Per-bead inspection specialist',
  },
  'specialist-uat-agent': {
    category: 'specialist',
    description: 'Browser-based user acceptance testing specialist',
  },

  // Subagents (4)
  'subagent:explore': {
    category: 'subagent',
    description: 'Fast codebase exploration subagent',
  },
  'subagent:plan': {
    category: 'subagent',
    description: 'Implementation planning subagent',
  },
  'subagent:bash': {
    category: 'subagent',
    description: 'Command execution specialist subagent',
  },
  'subagent:general-purpose': {
    category: 'subagent',
    description: 'General-purpose task subagent',
  },

  // Review agents (5)
  'review:security': {
    category: 'review',
    description: 'Security-focused code reviewer',
  },
  'review:performance': {
    category: 'review',
    description: 'Performance-focused code reviewer',
  },
  'review:correctness': {
    category: 'review',
    description: 'Correctness-focused code reviewer',
  },
  'review:requirements': {
    category: 'review',
    description: 'Verifies code changes satisfy the original issue requirements and vBRIEF acceptance criteria',
  },
  'review:synthesis': {
    category: 'review',
    description: 'Synthesizes findings from parallel reviewers',
  },

  // Pre-work agents
  'planning-agent': {
    category: 'pre-work',
    description: 'Interactive planning and discovery agent',
  },

  // Workflow jobs
  'status-review': {
    category: 'workflow',
    description: 'Executive-facing planning status review generation',
  },

  // CLI contexts
  'cli:interactive': {
    category: 'cli',
    description: 'Interactive CLI session',
  },
  'cli:quick-command': {
    category: 'cli',
    description: 'Quick one-off CLI commands',
  },
} as const;

/**
 * Type-safe work type IDs
 */
export type WorkTypeId = keyof typeof WORK_TYPES;

/**
 * Valid work type categories
 */
export type WorkTypeCategory = WorkTypeMetadata['category'];

/**
 * Get all work type IDs
 */
export function getAllWorkTypes(): WorkTypeId[] {
  return Object.keys(WORK_TYPES) as WorkTypeId[];
}

/**
 * Get all work types in a specific category
 */
export function getWorkTypesByCategory(category: WorkTypeCategory): WorkTypeId[] {
  return getAllWorkTypes().filter((id) => WORK_TYPES[id].category === category);
}

/**
 * Check if a string is a valid work type ID
 */
export function isValidWorkType(id: string): id is WorkTypeId {
  return id in WORK_TYPES;
}

/**
 * Get metadata for a work type
 */
export function getWorkTypeMetadata(id: WorkTypeId): WorkTypeMetadata {
  return WORK_TYPES[id];
}

/**
 * Get human-readable name for a work type
 */
export function getWorkTypeName(id: WorkTypeId): string {
  const metadata = WORK_TYPES[id];
  if ('phase' in metadata && metadata.phase) {
    return `${metadata.category} (${metadata.phase})`;
  }
  return id;
}

/**
 * Validate work type ID and throw if invalid
 */
export function validateWorkType(id: string): asserts id is WorkTypeId {
  if (!isValidWorkType(id)) {
    throw new Error(
      `Invalid work type ID: ${id}. Valid types: ${getAllWorkTypes().join(', ')}`
    );
  }
}
