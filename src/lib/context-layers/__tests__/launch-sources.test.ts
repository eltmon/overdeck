import { describe, expect, it } from 'vitest';

import { claudeSystemPromptFiles } from '../launch-sources.js';

describe('claudeSystemPromptFiles', () => {
  // Host-materialized harnesses receive context through their own per-agent
  // artifact (acp-context.md), never Claude system-prompt files.
  it.each(['acp', 'opencode', 'grok'] as const)('returns no Claude system-prompt files for %s', async (harness) => {
    await expect(claudeSystemPromptFiles('/workspace', harness)).resolves.toEqual([]);
  });
});
