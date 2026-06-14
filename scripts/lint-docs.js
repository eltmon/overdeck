#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOCS_DIR = join(process.cwd(), 'docs');
const files = readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md'));
let errors = 0;

for (const file of files) {
  const content = readFileSync(join(DOCS_DIR, file), 'utf-8');
  if (!content.trim()) {
    console.error(`docs/${file}: empty file`);
    errors++;
  }
  if (!content.endsWith('\n')) {
    console.error(`docs/${file}: file must end with a newline`);
    errors++;
  }
}

if (errors > 0) {
  process.exit(1);
}

console.log(`docs lint passed (${files.length} files)`);
