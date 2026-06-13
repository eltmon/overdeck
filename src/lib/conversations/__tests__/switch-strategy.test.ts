import { describe, expect, it } from 'vitest';
import { CLIPROXY_CODEX_CONTEXT_WINDOW } from '../../model-capabilities.js';
import {
  decideSwitchStrategy,
  getEffectiveTargetWindow,
  SWITCH_MODEL_SAFETY_FACTOR,
} from '../switch-strategy.js';

describe('getEffectiveTargetWindow', () => {
  it('uses the conservative CLIProxy Codex window for proxied targets', () => {
    expect(
      getEffectiveTargetWindow({
        registryWindow: 1_050_000,
        currentObservedCeiling: 2_000_000,
        cliproxyRouted: true,
        providerRoutingChanged: false,
      }),
    ).toBe(CLIPROXY_CODEX_CONTEXT_WINDOW);
  });

  it('lifts same-routing targets to the extended-context floor when the observed ceiling exceeds the registry window', () => {
    expect(
      getEffectiveTargetWindow({
        registryWindow: 200_000,
        currentObservedCeiling: 206_000,
        cliproxyRouted: false,
        providerRoutingChanged: false,
      }),
    ).toBe(1_000_000);
  });

  it('keeps the registry window when the observed ceiling fits the registry window', () => {
    expect(
      getEffectiveTargetWindow({
        registryWindow: 200_000,
        currentObservedCeiling: 200_000,
        cliproxyRouted: false,
        providerRoutingChanged: false,
      }),
    ).toBe(200_000);
  });

  it('does not lift cross-provider targets from the source session ceiling', () => {
    expect(
      getEffectiveTargetWindow({
        registryWindow: 200_000,
        currentObservedCeiling: 1_000_000,
        cliproxyRouted: false,
        providerRoutingChanged: true,
      }),
    ).toBe(200_000);
  });
});

describe('decideSwitchStrategy', () => {
  it('uses tier 4 for harness changes before any window or routing checks', () => {
    expect(
      decideSwitchStrategy({
        harnessChanged: true,
        providerRoutingChanged: false,
        contextTokens: 900_000,
        effectiveTargetWindow: 200_000,
      }),
    ).toEqual({ tier: 4, compact: false, useModelCommand: false });
  });

  it('uses tier 1 for same-routing switches that fit the safety window', () => {
    expect(
      decideSwitchStrategy({
        harnessChanged: false,
        providerRoutingChanged: false,
        contextTokens: 800_000,
        effectiveTargetWindow: 1_000_000,
      }),
    ).toEqual({ tier: 1, compact: false, useModelCommand: true });
  });

  it('uses tier 2 for cross-routing switches that fit the safety window', () => {
    expect(
      decideSwitchStrategy({
        harnessChanged: false,
        providerRoutingChanged: true,
        contextTokens: 800_000,
        effectiveTargetWindow: 1_000_000,
      }),
    ).toEqual({ tier: 2, compact: false, useModelCommand: false });
  });

  it('uses tier 3 when a same-routing switch exceeds the safety window', () => {
    expect(
      decideSwitchStrategy({
        harnessChanged: false,
        providerRoutingChanged: false,
        contextTokens: 800_001,
        effectiveTargetWindow: 1_000_000,
      }),
    ).toEqual({ tier: 3, compact: true, useModelCommand: false });
  });

  it('uses tier 3 when a cross-routing switch exceeds the safety window', () => {
    expect(
      decideSwitchStrategy({
        harnessChanged: false,
        providerRoutingChanged: true,
        contextTokens: 800_001,
        effectiveTargetWindow: 1_000_000,
      }),
    ).toEqual({ tier: 3, compact: true, useModelCommand: false });
  });

  it('keeps the observed 206k-token same-routing incident lossless at the decision layer', () => {
    const effectiveTargetWindow = getEffectiveTargetWindow({
      registryWindow: 200_000,
      currentObservedCeiling: 206_000,
      cliproxyRouted: false,
      providerRoutingChanged: false,
    });

    expect(SWITCH_MODEL_SAFETY_FACTOR).toBe(0.8);
    expect(effectiveTargetWindow).toBe(1_000_000);
    expect(
      decideSwitchStrategy({
        harnessChanged: false,
        providerRoutingChanged: false,
        contextTokens: 206_000,
        effectiveTargetWindow,
      }),
    ).toEqual({ tier: 1, compact: false, useModelCommand: true });
  });
});
