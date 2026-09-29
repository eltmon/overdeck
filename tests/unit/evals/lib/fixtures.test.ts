import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertNoSecretPatterns, loadFixtureDir, readRepoText, SECRET_PATTERNS } from '../../../../evals/lib/fixtures.js';

// Fake credentials are built at runtime so no literal token shape is ever committed
// (GitHub push protection blocks the whole branch on one).
const fakeGithubToken = 'gh' + 'p_' + 'x'.repeat(36);
const fakeAnthropicKey = 'sk-' + 'ant-' + 'a'.repeat(24);
const fakeSlackToken = 'xo' + 'xb-' + '1'.repeat(12);
const fakeAwsKey = 'AK' + 'IA' + 'A'.repeat(16);
const fakePrivateKey = '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----';

describe('evals/lib/fixtures', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('assertNoSecretPatterns throws for a GitHub token, naming the label but not the token', () => {
    let message = '';
    try {
      assertNoSecretPatterns(`config: ${fakeGithubToken}`, 'review-recall/1234-x.json');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('review-recall/1234-x.json');
    expect(message).not.toContain(fakeGithubToken);
    expect(message).toMatch(/secret pattern #\d+/);
  });

  it.each([
    ['anthropic key', fakeAnthropicKey],
    ['slack token', fakeSlackToken],
    ['aws access key', fakeAwsKey],
    ['private key header', fakePrivateKey],
  ])('assertNoSecretPatterns rejects a %s', (_name, secret) => {
    expect(() => assertNoSecretPatterns(`before ${secret} after`, 'label')).toThrow(/credential-shaped/);
  });

  it('assertNoSecretPatterns accepts prose mentioning a token and sk without a credential shape', () => {
    expect(() =>
      assertNoSecretPatterns('Rotate the token; the sk prefix and the ghp word alone are fine. risk-free task-list', 'label'),
    ).not.toThrow();
    expect(SECRET_PATTERNS).toHaveLength(7);
  });

  it('loadFixtureDir returns *.json fixtures sorted by file name with parsed data', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'eval-fixtures-'));
    writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ id: 'b' }));
    writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ id: 'a' }));
    writeFileSync(path.join(dir, 'notes.md'), 'ignored');

    const fixtures = loadFixtureDir(dir);
    expect(fixtures.map((f) => path.basename(f.file))).toEqual(['a.json', 'b.json']);
    expect(fixtures.map((f) => f.data)).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('loadFixtureDir rejects a fixture containing a credential shape', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'eval-fixtures-'));
    writeFileSync(path.join(dir, 'leak.json'), JSON.stringify({ text: fakeGithubToken }));
    expect(() => loadFixtureDir(dir!)).toThrow(/leak\.json.*credential-shaped/);
  });

  it('readRepoText returns the text of roles/plan.md', () => {
    expect(readRepoText('roles/plan.md').length).toBeGreaterThan(0);
  });
});
