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
  category: 'issue-agent' | 'specialist' | 'subagent' | 'convoy' | 'pre-work' | 'cli';
  /** Optional phase within the category (e.g., for issue-agent phases) */
  phase?: string;
  /** Human-readable description */
  description: string;
}

/**
 * Complete registry of all 23 work types with metadata
 */
export const WORK_TYPES = {
  // Issue agent phases (6)
  'issue-agent:exploration': {
    phase: 'exploration',
    category: 'issue-agent',
    description: 'Exploring codebase and understanding requirements',
  },
  'issue-agent:planning': {
    phase: 'planning',
    category: 'issue-agent',
    description: 'Planning implementation approach and architecture',
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

  // Specialist agents (3)
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

  // Convoy members (4)
  'convoy:security-reviewer': {
    category: 'convoy',
    description: 'Security-focused code reviewer in convoy',
  },
  'convoy:performance-reviewer': {
    category: 'convoy',
    description: 'Performance-focused code reviewer in convoy',
  },
  'convoy:correctness-reviewer': {
    category: 'convoy',
    description: 'Correctness-focused code reviewer in convoy',
  },
  'convoy:synthesis-agent': {
    category: 'convoy',
    description: 'Synthesizes findings from convoy reviewers',
  },

  // Pre-work agents (4)
  'prd-agent': {
    category: 'pre-work',
    description: 'Generates Product Requirement Documents',
  },
  'decomposition-agent': {
    category: 'pre-work',
    description: 'Breaks down work into tasks',
  },
  'triage-agent': {
    category: 'pre-work',
    description: 'Prioritizes and triages issues',
  },
  'planning-agent': {
    category: 'pre-work',
    description: 'Explores and plans implementation approach',
  },

  // CLI contexts (2)
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
