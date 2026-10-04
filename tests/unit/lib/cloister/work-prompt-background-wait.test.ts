import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const prompt = readFileSync(
  join(process.cwd(), 'src/lib/cloister/prompts/work.md'),
  'utf-8',
);

describe('work prompt background-wait rules (PAN-4514)', () => {
  it('carves out ending the turn as the correct way to wait on background work', () => {
    expect(prompt).toContain('ending your turn is the correct way to wait');
  });

  it('bans AskUserQuestion as a pause/status mechanism in the NEVER list', () => {
    expect(prompt).toContain('Call `AskUserQuestion` to pause');
  });
});
