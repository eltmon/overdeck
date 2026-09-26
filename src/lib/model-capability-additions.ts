import type { ModelCapability } from './model-capability-types.js';
import { CLIPROXY_GPT56_CONTEXT_WINDOW } from './model-context-windows.js';

/** September 2026 additions; sources and context constraints: docs/MODEL-CONTEXT-AUDIT.md.
 * Skill scores inherit the previous family baseline until benchmarked. */
export const AUDITED_MODEL_ADDITIONS = {
  'muse-spark-1.3': { model: 'muse-spark-1.3', provider: 'meta', displayName: 'Muse Spark 1.3 Standard', costPer1MTokens: 2.75, contextWindow: 1048576, effortLevels: ['low', 'medium', 'high', 'xhigh'], skills: { 'code-generation': 0, 'code-review': 0, debugging: 0, planning: 0, documentation: 0, testing: 0, security: 0, performance: 0, synthesis: 0, speed: 0, 'context-length': 100 }, notes: 'Standard data terms. Capability scores are unranked pending evaluation.' },
  'muse-spark-1.3-contributor': { model: 'muse-spark-1.3-contributor', provider: 'meta', displayName: 'Muse Spark 1.3 Contributor (training data)', costPer1MTokens: 0.15, contextWindow: 1048576, effortLevels: ['low', 'medium', 'high', 'xhigh'], skills: { 'code-generation': 0, 'code-review': 0, debugging: 0, planning: 0, documentation: 0, testing: 0, security: 0, performance: 0, synthesis: 0, speed: 0, 'context-length': 100 }, notes: 'Discounted tier: prompts and completions may train Meta models. Capability scores are unranked pending evaluation.' },

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

  // GPT-6 Sol / Luna (2026-09-22). Codex 0.157.1 `codex debug models`: context_window 272000,
  // max_context_window 872000, supported_in_api true; Sol default effort low, Luna medium.
  // Pricing and 1.05M context / 128K output: developers.openai.com/api/docs/models/gpt-6-sol and /gpt-6-luna.
  // Skills inherit the gpt-5.6-sol / gpt-5.6-luna baselines.
  'gpt-6-sol': {
    model: 'gpt-6-sol',
    provider: 'openai',
    displayName: 'GPT-6 Sol',
    costPer1MTokens: 6, // $2.00 in / $10.00 out ($0.20 cached)
    contextWindow: CLIPROXY_GPT56_CONTEXT_WINDOW,
    maxOutputTokens: 128_000,
    minTier: 'plus',
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    skills: {
      'code-generation': 98,
      'code-review': 95,
      debugging: 97,
      planning: 96,
      documentation: 93,
      testing: 95,
      security: 92,
      performance: 93,
      synthesis: 95,
      speed: 65,
      'context-length': 95,
    },
    notes: 'OpenAI GPT-6 mid tier (September 2026), successor to gpt-5.6-sol at half its API price. Pinned to the 272K billing tier (CLIPROXY_GPT56_CONTEXT_WINDOW) — >272K input is billed 2x in / 1.5x out for the full request (PAN-3388). No [372k] variant: the 372K pin was measured on gpt-5.6-sol only. 1.05M marketing context.',
  },

  'gpt-6-luna': {
    model: 'gpt-6-luna',
    provider: 'openai',
    displayName: 'GPT-6 Luna',
    costPer1MTokens: 0.3, // $0.10 in / $0.50 out ($0.01 cached)
    contextWindow: CLIPROXY_GPT56_CONTEXT_WINDOW,
    maxOutputTokens: 128_000,
    minTier: 'plus',
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    skills: {
      'code-generation': 82,
      'code-review': 78,
      debugging: 76,
      planning: 72,
      documentation: 80,
      testing: 76,
      security: 68,
      performance: 72,
      synthesis: 75,
      speed: 90,
      'context-length': 90,
    },
    notes: 'OpenAI GPT-6 fast/cheap tier (September 2026), successor to gpt-5.6-luna. Pinned to the 272K billing tier (CLIPROXY_GPT56_CONTEXT_WINDOW) — >272K input is billed 2x in / 1.5x out for the full request (PAN-3388). No [372k] variant: the 372K pin was measured on gpt-5.6-sol only. 1.05M marketing context.',
  },

} satisfies Record<string, ModelCapability>;
