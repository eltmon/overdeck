import type { ModelCapability } from './model-capability-types.js';

/** September 2026 additions; sources and context constraints: docs/MODEL-CONTEXT-AUDIT.md.
 * Skill scores inherit the previous family baseline until benchmarked. */
export const AUDITED_MODEL_ADDITIONS = {
  'claude-fable-5-1': {
    model: 'claude-fable-5-1',
    provider: 'anthropic',
    displayName: 'Claude Fable 5.1',
    // Equal input/output blend; exact cache rates live in cost.ts.
    costPer1MTokens: 30,
    contextWindow: 1000000,
    skills: {
      'code-generation': 99,
      'code-review': 99,
      debugging: 99,
      planning: 99,
      documentation: 97,
      testing: 96,
      security: 99,
      performance: 95,
      synthesis: 99,
      speed: 42,
      'context-length': 95,
    },
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    notes: 'Fable 5.1 requires Claude Code 2.1.255 or newer. Native 1M context; always-adaptive thinking, High default. API input $10/M, output $50/M, cache read $0.25/M.',
  },

  'gemini-3.8-flash': {
    model: 'gemini-3.8-flash',
    provider: 'google',
    displayName: 'Gemini 3.8 Flash',
    costPer1MTokens: 5.25, // $1.50 in / $9 out
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    skills: {
      'code-generation': 80,
      'code-review': 75,
      debugging: 72,
      planning: 68,
      documentation: 76,
      testing: 72,
      security: 60,
      performance: 70,
      synthesis: 75,
      speed: 96, // Very fast
      'context-length': 100,
    },
    notes: 'Stable Google model. 1,048,576 input tokens and 65,536 maximum output tokens; verified September 2026.',
  },

  'gemini-3.5-flash-lite': {
    model: 'gemini-3.5-flash-lite',
    provider: 'google',
    displayName: 'Gemini 3.5 Flash Lite',
    costPer1MTokens: 1.4, // $0.30 in / $2.50 out
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    skills: {
      'code-generation': 72,
      'code-review': 68,
      debugging: 65,
      planning: 60,
      documentation: 70,
      testing: 65,
      security: 52,
      performance: 62,
      synthesis: 68,
      speed: 98, // Most cost-efficient
      'context-length': 100,
    },
    notes: 'Stable Google model. 1,048,576 input tokens and 65,536 maximum output tokens; verified September 2026.',
  },

  'glm-5.3': {
    model: 'glm-5.3',
    provider: 'zai',
    displayName: 'GLM-5.3',
    // $1.4 in / $4.4 out → avg $2.9 (docs.z.ai/guides/overview/pricing). PAN-1956.
    costPer1MTokens: 2.9,
    // Provider context and maximum output are separate limits.
    contextWindow: 1000000,
    // GLM-5.3 accepts Low, High, and Max.
    effortLevels: ['low', 'high', 'max'],
    // Text-only: Z.AI's spec table lists Input/Output Modalities as "Text", and
    // vision lives in a separate model line (GLM-5V-Turbo, GLM-4.6V, GLM-OCR) —
    // same text-only profile as the GLM-5.1 predecessor (PAN-1685 audit).
    supportsImages: false,
    skills: {
      'code-generation': 85,
      'code-review': 83,
      debugging: 83,
      planning: 81,
      documentation: 80,
      testing: 80,
      security: 77,
      performance: 77,
      synthesis: 82,
      speed: 84,
      'context-length': 75,
    },
    notes: 'Verified September 2026: 1M context, 128K maximum output. Availability and pricing depend on provider region and account.',
  },

  'qwen3.7-plus': {
    model: 'qwen3.7-plus',
    provider: 'dashscope',
    displayName: 'Qwen3.7 Plus',
    costPer1MTokens: 1,
    contextWindow: 1000000,
    skills: {
      'code-generation': 97,
      'code-review': 95,
      debugging: 95,
      planning: 96,
      documentation: 93,
      testing: 93,
      security: 91,
      performance: 91,
      synthesis: 96,
      speed: 68,
      'context-length': 99,
    },
    notes: 'Verified September 2026: 1M context, 128K maximum output. Availability and pricing depend on provider region and account.',
  },

  'qwen3.8-flash': {
    model: 'qwen3.8-flash',
    provider: 'dashscope',
    displayName: 'Qwen3.8 Flash',
    costPer1MTokens: 0,
    contextWindow: 1000000,
    skills: {
      'code-generation': 97,
      'code-review': 95,
      debugging: 95,
      planning: 96,
      documentation: 93,
      testing: 93,
      security: 91,
      performance: 91,
      synthesis: 96,
      speed: 68,
      'context-length': 99,
    },
    notes: 'Verified September 2026: 1M context, 128K maximum output. Availability and pricing depend on provider region and account.',
  },

} satisfies Record<string, ModelCapability>;
