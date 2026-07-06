export type ComplexityLevel = 'trivial' | 'simple' | 'medium' | 'complex' | 'expert';

const VALID_COMPLEXITY_LEVELS: readonly ComplexityLevel[] = ['trivial', 'simple', 'medium', 'complex', 'expert'];

export function parseDifficultyLabel(labels: string[]): ComplexityLevel | null {
  const difficultyLabel = labels.find((label) => label.startsWith('difficulty:'));
  if (!difficultyLabel) return null;

  const level = difficultyLabel.split(':')[1];
  return VALID_COMPLEXITY_LEVELS.includes(level as ComplexityLevel) ? (level as ComplexityLevel) : null;
}
