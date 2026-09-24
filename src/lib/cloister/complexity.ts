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
 * Parse difficulty label from beads labels
 *
 * Extracts the difficulty level from labels in the format "difficulty:LEVEL"
 * (e.g., "difficulty:medium", "difficulty:expert")
 *
 * @param labels - Array of label strings
 * @returns Complexity level or null if no difficulty label found
 */
export function parseDifficultyLabel(labels: string[]): ComplexityLevel | null {
  const difficultyLabel = labels.find(label => label.startsWith('difficulty:'));
  if (!difficultyLabel) {
    return null;
  }

  const level = difficultyLabel.split(':')[1] as ComplexityLevel;
  const validLevels: ComplexityLevel[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];

  if (validLevels.includes(level)) {
    return level;
  }

  return null;
}
