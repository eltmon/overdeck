/**
 * Diagnostic bundle directory and manifest writer (PAN-4643 FR-5, FR-6, FR-10).
 *
 * A bundle is a directory `<diagnosticsRoot>/<stamp>/` holding redacted
 * diagnostic files plus `MANIFEST.md`. `<stamp>` is UTC `YYYYMMDDTHHMMSSZ`.
 */

import { mkdir, chmod, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join } from 'path';
import { getOverdeckHome } from '../paths.js';
import { countRedactions, redactBundleText } from './redact.js';

export interface BundleEntry {
  path: string;
  content: string;
  kind: 'text' | 'config';
  description: string;
}

export interface CollectorFailure {
  source: string;
  reason: string;
}

export interface CollectorOutcome {
  entries: BundleEntry[];
  failures: CollectorFailure[];
}

export interface WrittenFile {
  path: string;
  bytes: number;
  redactions: number;
}

interface ManifestFileRow extends WrittenFile {
  description: string;
}

export function diagnosticsRoot(home: string = getOverdeckHome()): string {
  return join(home, 'diagnostics');
}

function formatStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export async function createBundleDir(root: string, now: Date): Promise<string> {
  await mkdir(root, { recursive: true });

  const stamp = formatStamp(now);
  let suffix = 1;
  let dir = join(root, stamp);

  for (;;) {
    try {
      await mkdir(dir);
      await chmod(dir, 0o700);
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
        suffix += 1;
        dir = join(root, `${stamp}-${suffix}`);
        continue;
      }
      throw error;
    }
  }
}

function validateEntryPath(path: string): void {
  if (isAbsolute(path)) {
    throw new Error(`diagnostics bundle entry path must be relative: ${path}`);
  }
  if (path.split('/').includes('..')) {
    throw new Error(`diagnostics bundle entry path must not contain a '..' segment: ${path}`);
  }
  if (path === 'MANIFEST.md') {
    throw new Error("diagnostics bundle entry path must not be 'MANIFEST.md' (reserved for the writer)");
  }
}

export function renderManifest(options: {
  now: Date;
  files: ManifestFileRow[];
  failures: CollectorFailure[];
}): string {
  const fileRows = options.files
    .map((file) => `| ${file.path} | ${file.bytes} | ${file.redactions} | ${file.description} |`)
    .join('\n');

  const failureLines = options.failures.length > 0
    ? options.failures.map((failure) => `- ${failure.source}: ${failure.reason}`).join('\n')
    : '- none';

  return [
    '# Overdeck diagnostic bundle',
    '',
    `Created: ${options.now.toISOString()}`,
    '',
    '## Files',
    '',
    '| File | Bytes | Redactions | Contents |',
    '| --- | --- | --- | --- |',
    fileRows,
    '',
    '## Collection failures',
    '',
    failureLines,
    '',
    '## What was redacted',
    '',
    '- Shape-matched API keys, tokens, JWTs, AWS access keys, database URLs, basic-auth URLs, and private keys',
    '- Sensitive NAME=value assignments and labelled secrets under names like token, password, or secret',
    '- Config values under secret-looking key names (`api_key`, `token`, `secret`, `password`, `credential`, `cookie`, ...)',
    '- The home directory path, shown as `~`',
    '',
    '## Still in this bundle',
    '',
    '- File paths, project names and keys, repository paths',
    '- Log text',
    '- Hostnames',
    '',
    'Review this bundle before sharing it.',
    '',
    '## Not included',
    '',
    '- `~/.overdeck.env`',
    '- `access-tokens.json`',
    '- `internal-token`',
    '- `credentials/`',
    '- Harness credential files',
    '- Agent transcripts',
    '- Failed `pan` commands — Overdeck does not record them',
    '',
  ].join('\n');
}

export async function writeDiagnosticBundle(options: {
  dir: string;
  entries: BundleEntry[];
  failures: CollectorFailure[];
  now: Date;
  home?: string;
}): Promise<{ manifestPath: string; files: WrittenFile[] }> {
  const rows: ManifestFileRow[] = [];

  for (const entry of options.entries) {
    validateEntryPath(entry.path);
    const redacted = redactBundleText(entry.content, { kind: entry.kind, home: options.home });
    const filePath = join(options.dir, entry.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, redacted, { mode: 0o600 });
    await chmod(filePath, 0o600);
    rows.push({
      path: entry.path,
      bytes: Buffer.byteLength(redacted, 'utf-8'),
      redactions: countRedactions(redacted),
      description: entry.description,
    });
  }

  const manifest = redactBundleText(
    renderManifest({ now: options.now, files: rows, failures: options.failures }),
    { kind: 'text', home: options.home },
  );
  const manifestPath = join(options.dir, 'MANIFEST.md');
  await writeFile(manifestPath, manifest, { mode: 0o600 });
  await chmod(manifestPath, 0o600);

  return {
    manifestPath,
    files: rows.map(({ description: _description, ...rest }) => rest),
  };
}
