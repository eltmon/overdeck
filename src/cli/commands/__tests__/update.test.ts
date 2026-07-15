import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('pan update no-loss audit', () => {
  const source = readFileSync(new URL('../update.ts', import.meta.url), 'utf8');
  it.each([
    ['base command', 'manager.install'],
    ['--check', 'options.check'],
    ['--force exact reinstall', 'force: options.force'],
    ['canonical manager delegation', 'new UpdateManager'],
  ])('preserves %s', (_name, marker) => expect(source).toContain(marker));
  it('does not duplicate synchronous process execution', () => expect(source).not.toMatch(/execSync|spawnSync/));
});
