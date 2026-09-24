import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('chooseDispatchTier', () => {




  it('does not contain issue-id special cases', () => {
    // Doc comments cite the feature's issue id as provenance (repo
    // convention); the hazard is CODE branching on a specific issue.
    // Strip comments so only executable text is matched.
    const raw = readFileSync(join(process.cwd(), 'src/lib/agents/dispatch-tier.ts'), 'utf8');
    const source = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    expect(source).not.toMatch(/PAN-\d+/);
    expect(source).not.toMatch(/issueId|issue_id|issueLabel/);
  });
});
