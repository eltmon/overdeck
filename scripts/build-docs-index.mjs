#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(import.meta.dirname, '..');
const libraryEntry = join(projectRoot, 'dist', 'index.js');

if (!existsSync(libraryEntry)) {
  console.log('dist/index.js is missing; running npm run build:cli before build:docs-index');
  const buildCli = spawnSync('npm', ['run', 'build:cli'], { cwd: projectRoot, stdio: 'inherit' });
  if (buildCli.status !== 0) {
    process.exit(buildCli.status ?? 1);
  }
}

if (!existsSync(libraryEntry)) {
  console.error('dist/index.js is missing after npm run build:cli');
  process.exit(1);
}

const { buildDocsIndex, DEFAULT_DOCS_INDEX_PATH, DEFAULT_DOCS_INDEX_MAX_BYTES } = await import(pathToFileURL(libraryEntry).href);

try {
  const result = await buildDocsIndex({
    outputPath: DEFAULT_DOCS_INDEX_PATH,
    rootDir: projectRoot,
    maxIndexBytes: DEFAULT_DOCS_INDEX_MAX_BYTES,
  });
  console.log(`Built docs index at ${result.outputPath} (${result.chunkCount} chunks, ${result.sizeBytes} bytes)`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
