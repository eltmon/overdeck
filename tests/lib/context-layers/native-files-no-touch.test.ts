import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'src');
const EXPLICIT_MIGRATION = 'lib/context-layers/detach.ts';
const BANNED_NAMES = String.raw`(?:CLAUDE\.md|AGENTS\.md|GEMINI\.md|CONVENTIONS\.md|\.cursorrules|\.windsurfrules|\.clinerules|\.instructions\.md)`;
const MUTATION_NEAR_NATIVE_NAME = new RegExp(
  String.raw`\b(?:writeFile|writeFileSync|copyFile|copyFileSync|rename|renameSync|unlink|unlinkSync|rm|rmSync)\s*\([\s\S]{0,240}?${BANNED_NAMES}`,
  'g',
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') return [];
      return sourceFiles(path);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('native harness instruction ownership', () => {
  it('has no production writer for native instruction files outside the explicit detach migration', () => {
    const violations = sourceFiles(ROOT).flatMap((file) => {
      const rel = relative(ROOT, file);
      if (rel === EXPLICIT_MIGRATION || rel.includes('/__tests__/')) return [];
      const matches = [...readFileSync(file, 'utf-8').matchAll(MUTATION_NEAR_NATIVE_NAME)];
      return matches.map((match) => `${rel}: ${match[0].replace(/\s+/g, ' ')}`);
    });
    expect(violations).toEqual([]);
  });
});
