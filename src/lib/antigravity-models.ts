/** Overdeck Google model ids that `agy acp` serves, mapped to its `model` config value (PAN-5587 D8). */
import type { GoogleModel } from './settings.js';

export const ANTIGRAVITY_MODEL_IDS: Readonly<Partial<Record<GoogleModel, string>>> = {
  'gemini-4-argon': 'gemini-4-argon',
  'gemini-4-neon': 'gemini-4-neon',
  'gemini-4-carbon': 'gemini-4-carbon',
  'gemini-4-hydrogen': 'gemini-4-hydrogen',
  'gemini-3.8-flash': 'gemini-3.8-flash',
  'gemini-3.6-flash': 'gemini-3.6-flash',
  'gemini-3.1-pro-preview': 'gemini-3.1-pro',
};

export function isAntigravityModel(modelId: string): boolean {
  return Object.hasOwn(ANTIGRAVITY_MODEL_IDS, modelId);
}

export function antigravityModelIds(): string[] {
  return Object.keys(ANTIGRAVITY_MODEL_IDS);
}

export function translateAntigravityModelId(modelId: string): string {
  const value = (ANTIGRAVITY_MODEL_IDS as Record<string, string | undefined>)[modelId];
  if (!value) throw new Error(`Antigravity does not serve "${modelId}". Select one of: ${antigravityModelIds().join(', ')}.`);
  return value;
}
