import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function typescriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : typescriptFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('per-issue record write door', () => {
  it('rejects production imports of raw whole-record writers outside the door', () => {
    const root = resolve(import.meta.dirname, '../../../..');
    const files = typescriptFiles(resolve(root, 'src')).filter(file => /\b(writeIssueRecordSync|writeIssueRecordForWorkspaceSync|writeStatusOverridesSync)\b/.test(readFileSync(file, 'utf8'))).map(file => file.slice(root.length + 1));
    const allowed = new Set(['src/lib/pan-dir/record.ts', 'src/lib/pan-dir/record-update.ts']);
    const offenders = files.filter(file => !allowed.has(file)).map(file => `${file}: ${readFileSync(resolve(root, file), 'utf8').match(/writeIssueRecordSync|writeIssueRecordForWorkspaceSync|writeStatusOverridesSync/)?.[0]}`);
    expect(offenders).toEqual([]);
  });
});
