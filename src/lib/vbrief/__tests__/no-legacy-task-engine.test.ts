import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LIVE_TASK_SURFACES = [
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  'cli/core-commands.mdx',
  'cli/workspace-commands.mdx',
  'quickstart.mdx',
  'src/cli/commands/specialists/done.ts',
  'src/cli/commands/wipe.ts',
  'src/lib/backlog/pickup.ts',
  'src/lib/cloister/prompts/inspect-agent.md',
  'src/lib/cloister/prompts/planning.md',
  'src/lib/cloister/prompts/work.md',
  'src/lib/overdeck/planning-promotion.ts',
  'src/lib/vbrief/dag.ts',
  'src/lib/vbrief/io.ts',
  'src/lib/vbrief/types.ts',
  'sync-sources/rules/no-inspection-policy.md',
  'sync-sources/skills/pan-agent-activity/SKILL.md',
  'sync-sources/skills/pan-plan/SKILL.md',
  'sync-sources/skills/plan/SKILL.md',
  'sync-sources/skills/write-vbrief/SKILL.md',
] as const;

describe('PAN-2671 legacy task-engine audit', () => {
  it.each(LIVE_TASK_SURFACES)('%s uses canonical vBRIEF task terminology', (relativePath) => {
    const contents = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
    expect(contents).not.toMatch(/\b(?:beads?|bd)\b/i);
  });
});
