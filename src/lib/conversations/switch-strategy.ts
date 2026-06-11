import { CLIPROXY_CODEX_CONTEXT_WINDOW } from '../model-capabilities.js';

export const SWITCH_MODEL_SAFETY_FACTOR = 0.8;
const EXTENDED_CONTEXT_WINDOW_FLOOR = 1_000_000;

export interface EffectiveTargetWindowInput {
  registryWindow: number;
  currentObservedCeiling: number;
  cliproxyRouted: boolean;
  providerRoutingChanged: boolean;
}

export interface SwitchStrategyInput {
  harnessChanged: boolean;
  providerRoutingChanged: boolean;
  contextTokens: number;
  effectiveTargetWindow: number;
}

export interface SwitchStrategy {
  tier: 1 | 2 | 3 | 4;
  compact: boolean;
  useModelCommand: boolean;
}

export function getEffectiveTargetWindow({
  registryWindow,
  currentObservedCeiling,
  cliproxyRouted,
  providerRoutingChanged,
}: EffectiveTargetWindowInput): number {
  if (cliproxyRouted) return CLIPROXY_CODEX_CONTEXT_WINDOW;

  if (!providerRoutingChanged && currentObservedCeiling > registryWindow) {
    return Math.max(EXTENDED_CONTEXT_WINDOW_FLOOR, registryWindow);
  }

  return registryWindow;
}

export function decideSwitchStrategy({
  harnessChanged,
  providerRoutingChanged,
  contextTokens,
  effectiveTargetWindow,
}: SwitchStrategyInput): SwitchStrategy {
  if (harnessChanged) {
    return { tier: 4, compact: false, useModelCommand: false };
  }

  if (contextTokens > effectiveTargetWindow * SWITCH_MODEL_SAFETY_FACTOR) {
    return { tier: 3, compact: true, useModelCommand: false };
  }

  if (!providerRoutingChanged) {
    return { tier: 1, compact: false, useModelCommand: true };
  }

  return { tier: 2, compact: false, useModelCommand: false };
}
