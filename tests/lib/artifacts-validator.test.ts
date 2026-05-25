import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_ARTIFACT_SIZE_BYTES,
  hashArtifactContent,
  validateArtifactHtml,
  validateArtifactHtmlContent,
} from '../../src/lib/artifacts/validator.js';

function html(body: string): string {
  return `<!doctype html><html><head><title>Artifact</title></head><body>${body}</body></html>`;
}

describe('artifact HTML validation', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pan-artifact-validator-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts self-contained HTML with data and HTTPS assets', () => {
    const result = validateArtifactHtmlContent(html([
      '<img src="https://example.test/chart.png" alt="Chart">',
      '<img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" alt="Icon">',
      '<style>.card{background-image:url(data:image/png;base64,AAAA)}</style>',
    ].join('')));

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.hash).toBe(hashArtifactContent(html([
      '<img src="https://example.test/chart.png" alt="Chart">',
      '<img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" alt="Icon">',
      '<style>.card{background-image:url(data:image/png;base64,AAAA)}</style>',
    ].join(''))));
  });

  it('rejects non-HTML files and directories', async () => {
    const textFile = join(dir, 'artifact.txt');
    const nestedDir = join(dir, 'artifact.html');
    writeFileSync(textFile, html('ok'), 'utf-8');
    mkdirSync(nestedDir);

    const textResult = await validateArtifactHtml(textFile);
    const dirResult = await validateArtifactHtml(nestedDir);

    expect(textResult.ok).toBe(false);
    expect(textResult.errors.map((finding) => finding.code)).toContain('invalid_file_type');
    expect(dirResult.ok).toBe(false);
    expect(dirResult.errors.map((finding) => finding.code)).toContain('not_a_file');
  });

  it('enforces the one megabyte size boundary', async () => {
    const boundaryFile = join(dir, 'boundary.html');
    const oversizedFile = join(dir, 'oversized.html');
    writeFileSync(boundaryFile, Buffer.alloc(MAX_ARTIFACT_SIZE_BYTES, 'a'));
    writeFileSync(oversizedFile, Buffer.alloc(MAX_ARTIFACT_SIZE_BYTES + 1, 'a'));

    const boundaryResult = await validateArtifactHtml(boundaryFile);
    const oversizedResult = await validateArtifactHtml(oversizedFile);

    expect(boundaryResult.ok).toBe(true);
    expect(boundaryResult.size).toBe(MAX_ARTIFACT_SIZE_BYTES);
    expect(oversizedResult.ok).toBe(false);
    expect(oversizedResult.errors.map((finding) => finding.code)).toContain('size_limit_exceeded');
  });

  it.each([
    ['relative img src', '<img src="./chart.png" alt="Chart">'],
    ['parent script src', '<script src="../app.js"></script>'],
    ['root-local image src', '<img src="/local/chart.png" alt="Chart">'],
    ['file URL', '<img src="file:///tmp/chart.png" alt="Chart">'],
    ['non-HTTPS stylesheet', '<link rel="stylesheet" href="http://example.test/app.css">'],
    ['relative srcset entry', '<img srcset="https://example.test/a.png 1x, ./b.png 2x" alt="Chart">'],
    ['root-local CSS URL', '<style>.card{background:url(/local/chart.png)}</style>'],
  ])('rejects forbidden asset references: %s', (_name, body) => {
    const result = validateArtifactHtmlContent(html(body));

    expect(result.ok).toBe(false);
    expect(result.errors.map((finding) => finding.code)).toContain('forbidden_asset_url');
  });

  it.each([
    ['AWS access key', `AKIA${'A'.repeat(16)}`],
    ['GitHub PAT', `ghp_${'A'.repeat(36)}`],
    ['GitHub OAuth token', `gho_${'A'.repeat(36)}`],
    ['GitHub fine-grained PAT', `github_pat_${'A'.repeat(82)}`],
    ['Anthropic API key', `sk-ant-api03-${'A'.repeat(86)}`],
    ['OpenAI API key', `sk-${'A'.repeat(20)}`],
    ['Slack token', 'xoxb-1234567890'],
    ['private key', '-----BEGIN OPENSSH PRIVATE KEY-----'],
    ['env secret', 'api_key="12345678"'],
  ])('rejects %s secrets', (_name, secret) => {
    const result = validateArtifactHtmlContent(html(`<pre>${secret}</pre>`));

    expect(result.ok).toBe(false);
    expect(result.errors.map((finding) => finding.code)).toContain('secret_detected');
  });

  it.each([
    ['AWS access key near miss', `AKIA${'A'.repeat(15)}`],
    ['GitHub PAT near miss', `ghp_${'A'.repeat(35)}`],
    ['GitHub OAuth token near miss', `gho_${'A'.repeat(35)}`],
    ['GitHub fine-grained PAT near miss', `github_pat_${'A'.repeat(81)}`],
    ['Anthropic API key near miss', `sk-ant-api03-${'A'.repeat(85)}`],
    ['OpenAI API key near miss', `sk-${'A'.repeat(19)}`],
    ['Slack token near miss', 'xoxb-123456789'],
    ['public key marker', '-----BEGIN PUBLIC KEY-----'],
    ['short env assignment', 'api_key="1234567"'],
  ])('allows benign %s content', (_name, value) => {
    const result = validateArtifactHtmlContent(html(`<pre>${value}</pre>`));

    expect(result.ok).toBe(true);
    expect(result.errors.map((finding) => finding.code)).not.toContain('secret_detected');
  });

  it('downgrades per-line allowed secret matches to warnings', () => {
    const result = validateArtifactHtmlContent(html([
      '<!-- artifact-allow-secret -->',
      `<pre>ghp_${'A'.repeat(36)}</pre>`,
    ].join('')));

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((finding) => finding.code)).toContain('secret_allowed');
  });

  it('reports strict-mode findings without failing validation', () => {
    const result = validateArtifactHtmlContent(html([
      '<button onclick="alert(1)">Open</button>',
      '<img src="https://example.test/chart.png">',
      '<pre>abcdefghijklmnopqrstuvwxyzABCDEF</pre>',
    ].join('')), { strict: true });

    expect(result.ok).toBe(true);
    expect(result.warnings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      'inline_event_handler',
      'missing_image_alt',
      'high_entropy_string',
    ]));
    expect(result.warnings.every((finding) => finding.strict === true)).toBe(true);
  });

  it('does not report strict-mode findings in non-strict mode', () => {
    const result = validateArtifactHtmlContent(html([
      '<button onclick="alert(1)">Open</button>',
      '<img src="https://example.test/chart.png">',
      '<pre>abcdefghijklmnopqrstuvwxyzABCDEF</pre>',
    ].join('')));

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('allows inline event handlers in strict mode when a CSP meta tag is present', () => {
    const result = validateArtifactHtmlContent([
      '<!doctype html><html><head>',
      '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">',
      '</head><body><button onclick="alert(1)">Open</button></body></html>',
    ].join(''), { strict: true });

    expect(result.ok).toBe(true);
    expect(result.warnings.map((finding) => finding.code)).not.toContain('inline_event_handler');
  });
});
