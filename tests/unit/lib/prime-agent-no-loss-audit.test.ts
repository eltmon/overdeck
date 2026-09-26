/**
 * Harness-surface no-loss audit (PAN-3668 WI-22, FR-19, NFR-5).
 *
 * Every harness in KNOWN_HARNESSES must reach every harness-facing surface: a real
 * behavior (not the Claude fallback), a policy decision, a binary, a context marker,
 * the contract schemas, normalization, the conversation harness allowlist, config
 * validation, a transcript adapter and a Cloister runtime. Hand-copied lists that no
 * type forces are checked by source literal: removing 'prime-agent' from any one of
 * them fails this test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/harness-resolve.js', () => ({
  resolveHarness: vi.fn(async (input: { explicit?: string }) => input.explicit ?? 'claude-code'),
}));

import {
  ArtifactAgentHarness,
  CONTEXT_PREVIEW_HARNESSES,
  FlywheelHarness,
  KNOWN_HARNESSES,
  TELEMETRY_PROPERTY_DOMAINS,
} from '@overdeck/contracts';
import { mergeConfigs } from '../../../src/lib/config-yaml.js';
import { HARNESS_MARKERS } from '../../../src/lib/context-layers/harness.js';
import { getTranscriptAdapter } from '../../../src/lib/conversations/transcript-adapter.js';
import { harnessBinaryName } from '../../../src/lib/harness-binary.js';
import { POLICY_RUNTIME_NAMES } from '../../../src/lib/harness-policy.js';
import { resolveAllowedHarness } from '../../../src/lib/overdeck/conversation-runtime.js';
import { normalizeHarness } from '../../../src/lib/overdeck/conversations.js';
import { getHarnessBehavior } from '../../../src/lib/runtimes/behavior.js';
import { getRuntime } from '../../../src/lib/runtimes/index.js';
import type { RuntimeName } from '../../../src/lib/runtimes/types.js';

const ROOT = join(import.meta.dirname, '../../..');

/** A model each harness may run, for the model-gated resolvers. */
const MODEL_FOR: Record<RuntimeName, string> = {
  'claude-code': 'claude-sonnet-4-6',
  ohmypi: 'gpt-5.4',
  codex: 'gpt-5.5',
  acp: 'k3',
  'kimi-code': 'k3',
  opencode: 'opencode/big-pickle',
  muse: 'muse-spark-1.3',
  'prime-agent': 'gpt-5.4',
};

/** Unforced hand-copied harness lists (PRD "Unforced hand-copied lists" and the host sites). */
const PRIME_AGENT_LITERAL_FILES = [
  'src/lib/agents/tier-table.ts',
  'src/lib/launcher-generator.ts',
  'src/lib/config-yaml/schema.ts',
  'src/lib/config-yaml/merge.ts',
  'src/lib/config-yaml/roles.ts',
  'src/lib/settings-api.ts',
  'src/lib/conversations/harness-discovery.ts',
  'src/lib/session-history.ts',
  'src/lib/telemetry/pipeline.ts',
  'src/lib/artifacts/lifecycle.ts',
  'src/lib/overdeck/planning-sessions.ts',
  'src/lib/overdeck/conversations.ts',
  'src/lib/overdeck/conversation-archive.ts',
  'src/lib/overdeck/conversation-runtime.ts',
  'src/lib/overdeck/conversation-reads.ts',
  'src/lib/planning/spawn-planning-session.ts',
  'src/dashboard/server/routes/agents/spawn.ts',
  'src/dashboard/server/routes/agents/spawn-helpers.ts',
  'src/dashboard/server/routes/agents/lifecycle-restart.ts',
  'src/dashboard/server/routes/context.ts',
  'src/dashboard/server/routes/costs.ts',
  'src/dashboard/server/ws-rpc.ts',
  'src/dashboard/server/services/shared-transcript-parser.ts',
  'src/dashboard/server/services/dashboard-db-task.ts',
  'src/dashboard/server/services/dashboard-db-worker.ts',
  'src/lib/conversations/transcript-adapter.ts',
  'src/lib/agents/transcript-turn.ts',
  'src/lib/agents/recovery.ts',
  'src/lib/agents/termination.ts',
  'src/lib/context-layers/launch-sources.ts',
  'src/lib/runtimes/index.ts',
  'src/lib/runtimes/runtime-pane-launch.ts',
  'src/lib/overdeck/cost.ts',
  'src/lib/cloister/pi-cost-reconciler.ts',
  'src/lib/system-prerequisites.ts',
  'src/cli/commands/start.ts',
  'src/cli/commands/strike.ts',
  'src/cli/commands/worker.ts',
  'src/cli/commands/artifacts.ts',
  'src/cli/commands/context-layers.ts',
] as const;

/** The CLI --harness help strings name the value in prose, not as a quoted literal. */
const CLI_HELP_FILE = 'src/cli/index.ts';

const harnesses = [...KNOWN_HARNESSES] as RuntimeName[];

describe('harness no-loss audit (PAN-3668 WI-22)', () => {
  it('covers prime-agent', () => {
    expect(harnesses).toContain('prime-agent');
  });

  it.each(harnesses)('%s has its own behavior, policy entry, binary and context marker', (harness) => {
    const behavior = getHarnessBehavior(harness);
    if (harness !== 'claude-code') expect(behavior.displayName).not.toBe(getHarnessBehavior('claude-code').displayName);
    expect(POLICY_RUNTIME_NAMES).toContain(harness);
    expect(harnessBinaryName(harness)).toEqual(expect.any(String));
    expect(HARNESS_MARKERS[harness]).toEqual(expect.any(String));
  });

  it.each(harnesses)('%s decodes in the contract schemas', (harness) => {
    expect(CONTEXT_PREVIEW_HARNESSES).toContain(harness);
    expect(TELEMETRY_PROPERTY_DOMAINS.harness).toContain(harness);
    expect(Schema.decodeUnknownSync(FlywheelHarness)(harness)).toBe(harness);
    expect(Schema.decodeUnknownSync(ArtifactAgentHarness)(harness)).toBe(harness);
  });

  it.each(harnesses)('%s survives normalization, the conversation allowlist and config validation', async (harness) => {
    expect(normalizeHarness(harness)).toBe(harness);
    await expect(resolveAllowedHarness(harness, MODEL_FOR[harness])).resolves.toBe(harness);
    expect(() => mergeConfigs({ models: { providers: { openai: { enabled: true, harness } } } })).not.toThrow();
  });

  it.each(harnesses)('%s has a transcript adapter and a Cloister runtime', (harness) => {
    if (harness !== 'claude-code') expect(getTranscriptAdapter(harness).name).not.toBe('claude-code');
    expect(getRuntime(harness)).toBeDefined();
  });

  it.each(PRIME_AGENT_LITERAL_FILES)('%s names prime-agent', (file) => {
    expect(readFileSync(join(ROOT, file), 'utf8')).toContain("'prime-agent'");
  });

  it('lists prime-agent in every CLI --harness help string', () => {
    const source = readFileSync(join(ROOT, CLI_HELP_FILE), 'utf8');
    const helpStrings = source.match(/Coding-agent harness: [^']*/g) ?? [];
    expect(helpStrings.length).toBeGreaterThan(0);
    for (const help of helpStrings) expect(help).toContain('| prime-agent');
  });
});
