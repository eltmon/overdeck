/**
 * Complexity Detection Module
 *
 * Detects task complexity from multiple signals to enable intelligent
 * model selection for cost optimization.
 */

/**
 * Task complexity levels
 *
 * Maps to model selection:
 * - trivial/simple: haiku
 * - medium/complex: sonnet
 * - expert: opus
 */
export type ComplexityLevel = 'trivial' | 'simple' | 'medium' | 'complex' | 'expert';

/**
 * Beads task metadata for complexity detection
 */
export interface BeadsTask {
  id: string;
  title: string;
  description?: string;
  labels?: string[];
  complexity?: ComplexityLevel;
  estimate?: number; // time estimate in minutes
}

/**
 * Workspace metadata for complexity detection
 */
export interface WorkspaceMetadata {
  fileCount?: number;
  changedFiles?: string[];
  gitDiff?: string;
}

/**
 * Complexity detection result
 */
export interface ComplexityDetectionResult {
  level: ComplexityLevel;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
  reason: string;
}

/**
 * Keyword patterns for complexity detection
 */
const COMPLEXITY_KEYWORDS = {
  trivial: ['typo', 'rename', 'comment', 'documentation', 'readme', 'formatting'],
  simple: ['add comment', 'update docs', 'fix typo', 'small fix', 'minor'],
  medium: ['feature', 'endpoint', 'component', 'service', 'integration'],
  complex: ['refactor', 'migration', 'redesign', 'overhaul', 'rewrite'],
  expert: ['architecture', 'security', 'performance optimization', 'distributed'],
};

/**
 * Label/tag patterns for complexity detection
 */
const COMPLEXITY_LABELS = {
  trivial: ['trivial', 'docs', 'documentation'],
  simple: ['simple', 'tests', 'test', 'chore'],
  medium: ['feature', 'enhancement', 'bug'],
  complex: ['refactor', 'migration'],
  expert: ['architecture', 'security', 'performance'],
};

/**
 * File count thresholds for complexity detection
 */
const FILE_COUNT_THRESHOLDS = {
  simple: 3,
  medium: 10,
  complex: 20,
};

/**
 * Detect complexity from a beads task
 *
 * Priority order:
 * 1. Explicit complexity field (highest priority)
 * 2. Label/tag matching
 * 3. Keyword matching in title/description
 * 4. Workspace file count
 * 5. Time estimate
 *
 * @param task - Beads task metadata
 * @param workspace - Optional workspace metadata
 * @returns Complexity detection result
 */
export function detectComplexity(
  task: BeadsTask,
  workspace?: WorkspaceMetadata
): ComplexityDetectionResult {
  const signals: string[] = [];

  // 1. Check explicit complexity field (highest priority)
  if (task.complexity) {
    signals.push(`explicit complexity field: ${task.complexity}`);
    return {
      level: task.complexity,
      confidence: 'high',
      signals,
      reason: `Task explicitly marked as ${task.complexity}`,
    };
  }

  // 2. Check labels/tags
  const labelComplexity = detectComplexityFromLabels(task.labels || []);
  if (labelComplexity) {
    signals.push(`label match: ${labelComplexity.matchedLabels.join(', ')}`);
    return {
      level: labelComplexity.level,
      confidence: 'high',
      signals,
      reason: `Labels indicate ${labelComplexity.level} complexity: ${labelComplexity.matchedLabels.join(', ')}`,
    };
  }

  // 3. Check keywords in title and description
  const keywordComplexity = detectComplexityFromKeywords(task.title, task.description);
  if (keywordComplexity) {
    signals.push(`keyword match: ${keywordComplexity.matchedKeywords.join(', ')}`);

    // If we have workspace metadata, validate against file count
    if (workspace?.fileCount !== undefined) {
      const fileComplexity = detectComplexityFromFileCount(workspace.fileCount);
      if (fileComplexity) {
        signals.push(`file count: ${workspace.fileCount} files → ${fileComplexity.level}`);

        // Use the higher complexity between keyword and file count
        const finalLevel = getHigherComplexity(keywordComplexity.level, fileComplexity.level);
        return {
          level: finalLevel,
          confidence: 'high',
          signals,
          reason: `Keywords suggest ${keywordComplexity.level}, ${workspace.fileCount} files suggest ${fileComplexity.level}`,
        };
      }
    }

    return {
      level: keywordComplexity.level,
      confidence: 'medium',
      signals,
      reason: `Keywords indicate ${keywordComplexity.level} complexity: ${keywordComplexity.matchedKeywords.join(', ')}`,
    };
  }

  // 4. Check workspace file count
  if (workspace?.fileCount !== undefined) {
    const fileComplexity = detectComplexityFromFileCount(workspace.fileCount);
    if (fileComplexity) {
      signals.push(`file count: ${workspace.fileCount} files`);
      return {
        level: fileComplexity.level,
        confidence: 'medium',
        signals,
        reason: `Task affects ${workspace.fileCount} files`,
      };
    }
  }

  // 5. Check time estimate
  if (task.estimate !== undefined) {
    const estimateComplexity = detectComplexityFromEstimate(task.estimate);
    signals.push(`time estimate: ${task.estimate} minutes`);
    return {
      level: estimateComplexity.level,
      confidence: 'low',
      signals,
      reason: `Estimated time: ${task.estimate} minutes`,
    };
  }

  // Default to simple if no signals detected
  signals.push('no strong signals detected');
  return {
    level: 'simple',
    confidence: 'low',
    signals,
    reason: 'No complexity signals detected, defaulting to simple',
  };
}

/**
 * Detect complexity from task labels
 */
function detectComplexityFromLabels(
  labels: string[]
): { level: ComplexityLevel; matchedLabels: string[] } | null {
  const normalizedLabels = labels.map(l => l.toLowerCase());

  // Check in order from most complex to least complex
  for (const level of ['expert', 'complex', 'medium', 'simple', 'trivial'] as const) {
    const patterns = COMPLEXITY_LABELS[level];
    const matchedLabels = normalizedLabels.filter(label =>
      patterns.some(pattern => label.includes(pattern))
    );

    if (matchedLabels.length > 0) {
      return { level, matchedLabels };
    }
  }

  return null;
}

/**
 * Detect complexity from keywords in title/description
 */
function detectComplexityFromKeywords(
  title: string,
  description?: string
): { level: ComplexityLevel; matchedKeywords: string[] } | null {
  const text = `${title} ${description || ''}`.toLowerCase();

  // Check in order from most complex to least complex
  for (const level of ['expert', 'complex', 'medium', 'simple', 'trivial'] as const) {
    const patterns = COMPLEXITY_KEYWORDS[level];
    const matchedKeywords = patterns.filter(pattern => text.includes(pattern.toLowerCase()));

    if (matchedKeywords.length > 0) {
      return { level, matchedKeywords };
    }
  }

  return null;
}

/**
 * Detect complexity from file count
 */
function detectComplexityFromFileCount(
  fileCount: number
): { level: ComplexityLevel } | null {
  if (fileCount > FILE_COUNT_THRESHOLDS.complex) {
    return { level: 'complex' };
  } else if (fileCount > FILE_COUNT_THRESHOLDS.medium) {
    return { level: 'medium' };
  } else if (fileCount > FILE_COUNT_THRESHOLDS.simple) {
    return { level: 'simple' };
  }

  return null;
}

/**
 * Detect complexity from time estimate (in minutes)
 */
function detectComplexityFromEstimate(
  estimateMinutes: number
): { level: ComplexityLevel } {
  if (estimateMinutes > 480) { // > 8 hours
    return { level: 'expert' };
  } else if (estimateMinutes > 240) { // > 4 hours
    return { level: 'complex' };
  } else if (estimateMinutes > 120) { // > 2 hours
    return { level: 'medium' };
  } else if (estimateMinutes > 30) { // > 30 minutes
    return { level: 'simple' };
  } else {
    return { level: 'trivial' };
  }
}

/**
 * Get the higher complexity level between two levels
 */
function getHigherComplexity(
  level1: ComplexityLevel,
  level2: ComplexityLevel
): ComplexityLevel {
  const order: ComplexityLevel[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];
  const index1 = order.indexOf(level1);
  const index2 = order.indexOf(level2);
  return order[Math.max(index1, index2)];
}

/**
 * Map complexity level to recommended model
 *
 * @param level - Complexity level
 * @returns Recommended model name
 */
export function complexityToModel(level: ComplexityLevel): string {
  switch (level) {
    case 'trivial':
    case 'simple':
      return 'haiku';
    case 'medium':
    case 'complex':
      return 'sonnet';
    case 'expert':
      return 'opus';
  }
}
