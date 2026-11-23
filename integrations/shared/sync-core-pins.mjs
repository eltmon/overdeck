#!/usr/bin/env node
// PAN-5486 W-1 (FR-1, NFR-2, NFR-3): every core version pin under integrations/ equals the
// root package.json version. A pin is the core package name, an "@" and a semver, or the
// OVERDECK_CORE_VERSION:-<semver>} shell default. Placeholders such as "@<version>" and
// "@<pin>" are never pins, so they are never changed.
// --check writes nothing and exits 1 when a pin differs or when no pin exists.
// --root <dir> runs against another repository root (tests).
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;
const VERSION_RE = new RegExp(`^${SEMVER}$`);
// Each replacer keeps every group but group 2, the version.
const PIN_PATTERNS = [
  { pattern: new RegExp(String.raw`(@overdeck\/core@)(${SEMVER})`, 'g'), replace: (v) => (_pin, prefix) => `${prefix}${v}` },
  { pattern: new RegExp(String.raw`(OVERDECK_CORE_VERSION:-)(${SEMVER})(\})`, 'g'), replace: (v) => (_pin, prefix, _found, suffix) => `${prefix}${v}${suffix}` },
];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.venv', 'venv', '__pycache__', '.pytest_cache', '.git']);
const SKIP_FILES = new Set(['package-lock.json']);

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

async function listFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) files.push(...(await listFiles(path)));
    } else if (entry.isFile() && !SKIP_FILES.has(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Returns each pin found in text and the text with every pin set to version. */
function scan(text, version) {
  const pins = [];
  for (const { pattern } of PIN_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      pins.push({ line: lineOf(text, match.index), found: match[2] });
    }
  }
  let next = text;
  for (const { pattern, replace } of PIN_PATTERNS) {
    next = next.replace(pattern, replace(version));
  }
  return { pins, next };
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed) {
  console.error('usage: node integrations/shared/sync-core-pins.mjs [--check] [--root <dir>]');
  process.exitCode = 2;
} else {
  const root = parsed.root ?? fileURLToPath(new URL('../..', import.meta.url));
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8'));

  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    console.error(`✗ package.json version "${version}" is not a semver`);
    process.exitCode = 1;
  } else {
    const results = [];
    for (const fullPath of (await listFiles(join(root, 'integrations'))).sort()) {
      const text = await readFile(fullPath, 'utf-8');
      const { pins, next } = scan(text, version);
      if (pins.length > 0) {
        results.push({ fullPath, path: relative(root, fullPath).split(sep).join('/'), pins, text, next });
      }
    }
    const total = results.reduce((sum, { pins }) => sum + pins.length, 0);

    if (parsed.check) {
      let drift = false;
      for (const { path, pins } of results) {
        for (const { line, found } of pins) {
          if (found !== version) {
            console.error(`✗ ${path}:${line} pins ${found}, expected ${version}`);
            drift = true;
          }
        }
      }
      if (drift) {
        console.error('run: node integrations/shared/sync-core-pins.mjs');
        process.exitCode = 1;
      } else if (total === 0) {
        console.error('✗ no core pins found under integrations/');
        process.exitCode = 1;
      } else {
        console.log(`✓ ${total} core pins match ${version}`);
      }
    } else {
      let updated = 0;
      for (const { fullPath, path, text, next } of results) {
        if (next !== text) {
          await writeFile(fullPath, next);
          console.log(`updated ${path}`);
          updated += 1;
        }
      }
      console.log(`core pins: ${total} at ${version}, ${updated} file(s) updated`);
    }
  }
}
