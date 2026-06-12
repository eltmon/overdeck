#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(import.meta.dirname, '..');
const libraryEntry = join(projectRoot, 'dist', 'index.js');

if (process.env.SKIP_DOCS_INDEX === '1') {
  console.log('Skipping docs index build because SKIP_DOCS_INDEX=1');
  process.exit(0);
}

if (!existsSync(libraryEntry)) {
  console.error('dist/index.js is missing; run npm run build:cli before build:docs-index');
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
