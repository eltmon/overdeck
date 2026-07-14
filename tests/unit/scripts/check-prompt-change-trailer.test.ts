import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const scriptPath = 'scripts/check-prompt-change-trailer.sh';

describe('check-prompt-change-trailer.sh', () => {
  it('passes its self-test', () => {
    expect(() => execSync(`bash ${scriptPath} --self-test`, { stdio: 'pipe' })).not.toThrow();
  });
});
