/**
 * Jev settings validation (PAN-4508). Pure leaf module — only type imports — so the
 * dashboard settings API and the settings UI can both validate a `jev:` edit (route,
 * model, timeout) and a background-AI toggle flip without pulling in config loading
 * or the background-AI gate.
 */
import type { JevFeature } from './config.js';

/** The canonical OpenCode Zen gateway base_url; distinguishes the "zen" route and the "custom" route. */
export const JEV_ZEN_BASE_URL = 'https://opencode.ai/zen';

/** The three Jev feature toggles that require jev.model before they can run requests. */
export const JEV_FEATURE_KEYS: readonly JevFeature[] = [
  'jevTurnEndAssessment',
  'jevAcceptanceCriteriaReview',
  'jevMemoryRelevance',
] as const;

const MAX_JEV_TIMEOUT_MS = 30_000;

export type JevRoute = 'zen' | 'direct' | 'custom';

export interface JevSettingsInput {
  route: JevRoute;
  model: string;
  timeoutMs: number;
}

/** Classifies a base_url for the settings UI's route picker. Absent means "direct". */
export function routeForBaseUrl(baseUrl: string | undefined): JevRoute {
  if (!baseUrl) return 'direct';
  const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return normalized === JEV_ZEN_BASE_URL ? 'zen' : 'custom';
}

/**
 * Validates a settings-form edit against the currently saved config. Collects every
 * applicable error rather than stopping at the first, so the form can show them all
 * at once.
 */
export function validateJevSettingsInput(
  input: unknown,
  current: { baseUrl?: string; features?: Partial<Record<JevFeature, boolean>> },
): { ok: true; value: JevSettingsInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const obj =
    input !== null && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};

  const rawRoute = obj.route;
  const route: JevRoute | undefined =
    rawRoute === 'zen' || rawRoute === 'direct' || rawRoute === 'custom' ? rawRoute : undefined;
  if (route === undefined) {
    errors.push('route must be zen, direct, or custom');
  } else if (route === 'custom' && routeForBaseUrl(current.baseUrl) !== 'custom') {
    errors.push('route custom keeps an existing custom base_url; none is set');
  }

  const model = typeof obj.model === 'string' ? obj.model.trim() : '';
  if (!model && JEV_FEATURE_KEYS.some((key) => current.features?.[key] === true)) {
    errors.push('jev.model is required while a Jev feature is on');
  }

  const timeoutMs = typeof obj.timeoutMs === 'number' ? obj.timeoutMs : NaN;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_JEV_TIMEOUT_MS) {
    errors.push(`jev.timeout_ms must be an integer between 1 and ${MAX_JEV_TIMEOUT_MS}`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { route: route as JevRoute, model, timeoutMs } };
}

export interface JevToggleProblem {
  key: JevFeature;
  level: 'error' | 'warning';
  message: string;
}

/**
 * Flags a Jev toggle flip that won't do anything (or can't yet) because jev.model is
 * blank. An error blocks turning a toggle on for the first time; a toggle that was
 * already on in the saved config only warns, since it was already a no-op.
 */
export function jevToggleProblems(
  next: Partial<Record<JevFeature, boolean>>,
  current: { model?: string; features?: Partial<Record<JevFeature, boolean>> } | undefined,
): JevToggleProblem[] {
  const currentModel = current?.model?.trim() ?? '';
  if (currentModel) return [];

  const problems: JevToggleProblem[] = [];
  for (const key of JEV_FEATURE_KEYS) {
    if (next[key] !== true) continue;
    const alreadyOn = current?.features?.[key] === true;
    problems.push({
      key,
      level: alreadyOn ? 'warning' : 'error',
      message: alreadyOn
        ? `${key} is on but jev.model is not set; Jev makes no requests until a model is set`
        : `Set a Jev model in Settings → Background AI before turning on ${key}`,
    });
  }
  return problems;
}
