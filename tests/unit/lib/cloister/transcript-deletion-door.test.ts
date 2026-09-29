import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  removeTranscriptFile,
  removeTranscriptTree,
} from '../../../../src/lib/cloister/transcript-deletion-door.js';

const DOOR_SOURCE = join(__dirname, '..', '..', '..', '..', 'src', 'lib', 'cloister', 'transcript-deletion-door.ts');

describe('transcript deletion door', () => {
  it('ac2: imports only node:fs/promises', () => {
    const source = readFileSync(DOOR_SOURCE, 'utf8');
    const imports = [...source.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((match) => match[1]);
    expect(imports).toEqual(['node:fs/promises']);
    expect(source).not.toMatch(/\brequire\(/);
  });

  it('ac3: removeTranscriptFile deletes the file and tolerates a missing one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-deletion-door-'));
    try {
      const file = join(root, 'session.jsonl');
      writeFileSync(file, '{"type":"user"}\n');
      await removeTranscriptFile(file);
      expect(existsSync(file)).toBe(false);
      await expect(removeTranscriptFile(file)).resolves.toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('removeTranscriptTree deletes a directory tree and tolerates a missing one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-deletion-door-'));
    try {
      const tree = join(root, 'agent');
      mkdirSync(join(tree, 'nested'), { recursive: true });
      writeFileSync(join(tree, 'nested', 'rollout.jsonl'), '{}\n');
      await removeTranscriptTree(tree);
      expect(existsSync(tree)).toBe(false);
      await expect(removeTranscriptTree(tree)).resolves.toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
