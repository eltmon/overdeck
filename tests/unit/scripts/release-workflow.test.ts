import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('release workflow npm publishes', () => {
  it('does not rerun package lifecycle builds after explicit CI builds', async () => {
    const workflow = await readFile(join(process.cwd(), '.github', 'workflows', 'release.yml'), 'utf8');
    const publishCommands = workflow.split('\n').filter((line) => line.trim().startsWith('npm publish '));

    expect(publishCommands).toHaveLength(6);
    for (const command of publishCommands) {
      expect(command).toContain('--ignore-scripts');
    }
  });
});
