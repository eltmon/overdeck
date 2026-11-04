#!/usr/bin/env node
// PAN-4927 W-INT0 (FR-15): one Overdeck skill for every integration.
// Copies integrations/shared/SKILL.md to integrations/<platform>/skills/overdeck/SKILL.md.
// --check writes nothing and exits 1 when a copy differs or is missing.
// --root <dir> runs against another repository root (tests).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PLATFORMS = ['hermes', 'openclaw', 'grok-build', 'grok-bot'];
const SOURCE = 'integrations/shared/SKILL.md';
const copyPath = (platform) => `integrations/${platform}/skills/overdeck/SKILL.md`;

function parseArgs(argv) {
  let check = false;
  let root;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      check = true;
    } else if (arg === '--root') {
      i += 1;
      if (i >= argv.length) return null;
      root = argv[i];
    } else {
      return null;
    }
  }
  return { check, root };
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed) {
  console.error('usage: node integrations/shared/sync-skill.mjs [--check] [--root <dir>]');
  process.exitCode = 2;
} else {
  const root = parsed.root ?? fileURLToPath(new URL('../..', import.meta.url));

  let source;
  try {
    source = await readFile(join(root, SOURCE));
  } catch {
    console.error(`✗ missing ${SOURCE}`);
    process.exitCode = 1;
  }

  if (source !== undefined) {
    const copies = await Promise.all(
      PLATFORMS.map(async (platform) => {
        const path = copyPath(platform);
        try {
          const copy = await readFile(join(root, path));
          return { platform, path, copy };
        } catch (err) {
          if (err.code === 'ENOENT') return { platform, path, copy: null };
          throw err;
        }
      })
    );

    if (parsed.check) {
      let drift = false;
      for (const { path, copy } of copies) {
        if (copy === null) {
          console.error(`✗ ${path} is missing`);
          drift = true;
        } else if (!copy.equals(source)) {
          console.error(`✗ ${path} differs from ${SOURCE}`);
          drift = true;
        }
      }
      if (drift) {
        console.error('run: node integrations/shared/sync-skill.mjs');
        process.exitCode = 1;
      } else {
        console.log(`✓ 4 skill copies match ${SOURCE}`);
      }
    } else {
      let updated = 0;
      for (const { path, copy } of copies) {
        if (copy === null || !copy.equals(source)) {
          const fullPath = join(root, path);
          await mkdir(dirname(fullPath), { recursive: true });
          await writeFile(fullPath, source);
          console.log(`updated ${path}`);
          updated += 1;
        }
      }
      console.log(`skill copies: ${updated} updated, ${4 - updated} unchanged`);
    }
  }
}
