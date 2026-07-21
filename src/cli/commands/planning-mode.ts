import chalk from 'chalk';

export type PlanningMode = 'interactive' | 'auto' | 'skip';

const PLANNING_MODES: readonly PlanningMode[] = ['interactive', 'auto', 'skip'] as const;

function isPlanningMode(value: unknown): value is PlanningMode {
  return typeof value === 'string' && (PLANNING_MODES as readonly string[]).includes(value);
}

export interface ResolvePlanningModeInput {
  /** Explicit --plan <mode> value from the CLI. */
  planFlag?: string;
  /** Legacy --auto flag; treated as --plan skip with a deprecation warning. */
  legacyAuto?: boolean;
  /** Value from config.planning.default_mode (validated per D7 in this resolver). */
  configDefault?: string;
}

export interface ResolvePlanningModeResult {
  mode: PlanningMode;
  warnings: string[];
}

/**
 * Resolve the effective planning mode for `pan start`.
 *
 * Precedence (D3):
 *   1. Explicit --plan flag (validated).
 *   2. Legacy --auto flag → 'skip' plus deprecation warning.
 *   3. config.planning.default_mode (validated).
 *   4. Shipped default → 'auto'.
 *
 * Throws an Error naming the invalid source and the three valid values.
 */
export function resolvePlanningMode({
  planFlag,
  legacyAuto,
  configDefault,
}: ResolvePlanningModeInput): ResolvePlanningModeResult {
  const warnings: string[] = [];

  if (planFlag !== undefined) {
    if (!isPlanningMode(planFlag)) {
      throw new Error(
        `Invalid --plan value: ${planFlag}. Expected one of: ${PLANNING_MODES.join(', ')}.`,
      );
    }

    if (legacyAuto) {
      warnings.push(
        chalk.yellow(
          'Warning: --auto is deprecated. The --plan flag takes precedence; remove --auto.',
        ),
      );
    }

    return { mode: planFlag, warnings };
  }

  if (legacyAuto) {
    warnings.push(
      chalk.yellow('Warning: --auto is deprecated; use --plan skip instead.'),
    );
    return { mode: 'skip', warnings };
  }

  if (configDefault !== undefined) {
    if (!isPlanningMode(configDefault)) {
      throw new Error(
        `Invalid planning.default_mode config value: ${configDefault}. Expected one of: ${PLANNING_MODES.join(', ')}.`,
      );
    }
    return { mode: configDefault, warnings };
  }

  return { mode: 'auto', warnings };
}
