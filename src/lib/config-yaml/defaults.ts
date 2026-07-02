import { join } from 'path';
import { homedir } from 'os';
import { defaultBackgroundAiFeatures } from '../background-ai/registry.js';
import { DEFAULT_TIERED_EXECUTION_CONFIG } from '../agents/tier-table.js';
import { cloneRoles, DEFAULT_ROLES, DEFAULT_WORKHORSES } from './roles.js';
import type { NormalizedConfig } from './schema.js';

export const DEFAULT_DOCS_TRIGGER_REGEXES = [
  'pan',
  'overdeck',
  'cloister',
  'deacon',
  'workspace',
  'specialist',
  'harness',
  'bd',
  'beads',
  'vbrief',
  'workhorse',
];

export const DEFAULT_CONFIG: NormalizedConfig = {
  tmux: {
    configMode: 'managed',
  },
  enabledProviders: new Set(['anthropic']), // Only Anthropic by default
  apiKeys: {},
  providerAuth: {},
  providerPlan: {},
  providerHarnesses: {},
  openrouterFavorites: [],
  workhorses: { ...DEFAULT_WORKHORSES },
  roles: cloneRoles(DEFAULT_ROLES),
  tieredExecution: {
    ...DEFAULT_TIERED_EXECUTION_CONFIG,
    tiers: { ...DEFAULT_TIERED_EXECUTION_CONFIG.tiers },
    supervisor: { ...DEFAULT_TIERED_EXECUTION_CONFIG.supervisor },
  },
  overrides: {},
  geminiThinkingLevel: 3,
  trackerKeys: {},
  conversations: {
    compactionModel: 'claude-haiku-4-5',
    manualCompactMode: 'claude-code',
    richCompaction: true,
    titleModel: 'claude-haiku-4-5',
    watchDirs: ['~/Projects'],
    scanMaxParallel: null,
    embeddings: false,
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    embeddingAutoOnDeep: true,
    enrichment: {
      quickModel: null,
      deepModel: null,
      maxParallel: 4,
      costConfirmThreshold: 1.00,
    },
  },
  docs: {
    enabled: true,
    promptInjectionEnabled: true,
    cliEnabled: true,
    trigger: {
      regexes: DEFAULT_DOCS_TRIGGER_REGEXES,
      caseSensitive: false,
    },
    corpus: {
      docs: true,
      skills: true,
      rules: true,
      claudeMd: true,
      prds: false,
      prdStatuses: ['active', 'planned'],
      maxChunkTokens: 500,
    },
    budget: {
      injectionRate: 1,
      turnWindow: 10,
      maxTokensPerInjection: 3000,
      maxChunksPerInjection: 5,
      bypassClassifierThreshold: 0.85,
    },
    embedding: {
      provider: 'local',
      model: 'gte-small',
      dimensions: 384,
    },
    classifier: {
      enabled: false,
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      threshold: 0.85,
      timeoutMs: 1500,
    },
  },
  conversationSearch: {
    enabled: false,
    provider: 'openai',
    model: 'text-embedding-3-small',
    apiKeyRef: undefined,
    dbPath: join(homedir(), '.overdeck', 'conversations', 'embeddings.db'),
  },
  memory: {
    extraction: {
      fallbackChain: [],
    },
    observationsEnabled: true,
    promptTimeInjectionEnabled: true,
    rollupPendingThreshold: 4,
    sidebarRefreshIntervalMs: 10_000,
    workerConcurrency: 4,
  },
  backgroundAi: {
    // PAN-1589: off by default — background AI stays gated until the user opts in.
    cheapMode: true,
    features: defaultBackgroundAiFeatures(),
  },
  compliance: {
    mode: 'advisory',
  },
  registry: {
    classification: {
      enabled: true,
      provider: 'cliproxy',
      model: 'gpt-4.1-nano',
      perDayCostCapUsd: 1,
    },
  },
  shadow: {
    enabled: false,
    trackers: {
      linear: false,
      github: false,
      gitlab: false,
      rally: false,
    },
  },
  caveman: {
    enabled: false,
    abTest: false,
    modes: {
      work: 'full',
      review: 'review',
      test: 'full',
      merge: 'full',
    },
  },
  rtk: {
    enabled: false,
  },
  tldr: {
    // Default ON: TLDR was historically active whenever a workspace `.venv`
    // existed. The toggle lets operators turn it off (e.g. to reclaim the disk
    // the per-workspace .venv consumes — PAN-1674).
    enabled: true,
  },
  tts: {
    enabled: false,
    lifecycle: true,
    voice: '',
    volume: 1,
    rate: 1,
    maxChars: 140,
    dropInfoWhenFull: true,
    daemonPort: 8787,
    daemonHost: '127.0.0.1',
    daemonAutoStart: false,
    voiceMap: {},
    mutedSources: [],
    utteranceTemplates: {},
    mutedIssues: [],
  },
  ttsSummarizer: {
    enabled: false,
    model: 'gpt-5.4-mini',
    batchWindowSeconds: 15,
  },
  resources: {
    memoryWarnGb: 4,
    memoryBlockGb: 2,
    agentWarnCount: 8,
    agentBlockCount: 10,
  },
  experimental: {
    experimentalFeatures: false,
    claudeCodeChannels: false,
    claudeCodeChannelsMcp: false,
    streamdownRenderer: false,
    showHarnessModelPermutations: false,
  },
  claude: {
    permissionMode: 'auto',
  },
  codex: {
    permissionMode: 'auto-review',
  },
};

/**
 * Path to global config file
 */
export const GLOBAL_CONFIG_PATH = join(homedir(), '.overdeck', 'config.yaml');
