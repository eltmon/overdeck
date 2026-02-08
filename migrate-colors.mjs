#!/usr/bin/env node
/**
 * Migrate hard-coded Tailwind gray/white colors to semantic tokens
 * See STATE.md for full migration map
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Migration map from STATE.md
const REPLACEMENTS = [
  // Backgrounds - order matters! More specific first
  { from: /bg-gray-800\/50/g, to: 'bg-surface-raised/50' },
  { from: /bg-gray-900/g, to: 'bg-surface' },
  { from: /bg-gray-800/g, to: 'bg-surface-raised' },
  { from: /bg-gray-700/g, to: 'bg-surface-overlay' },
  { from: /bg-gray-600/g, to: 'bg-surface-emphasis' },

  // Text colors - order matters!
  { from: /text-white/g, to: 'text-content' },
  { from: /text-gray-200/g, to: 'text-content' },
  { from: /text-gray-300/g, to: 'text-content-body' },
  { from: /text-gray-400/g, to: 'text-content-subtle' },
  { from: /text-gray-500/g, to: 'text-content-muted' },

  // Borders - order matters!
  { from: /border-gray-800/g, to: 'border-divider' },
  { from: /border-gray-700/g, to: 'border-divider' },
  { from: /border-gray-600/g, to: 'border-divider-strong' },

  // Hover states - order matters!
  { from: /hover:bg-gray-700/g, to: 'hover:bg-surface-overlay' },
  { from: /hover:bg-gray-600/g, to: 'hover:bg-surface-emphasis' },
  { from: /hover:text-white/g, to: 'hover:text-content' },
  { from: /hover:text-gray-300/g, to: 'hover:text-content-body' },

  // Border-left specific (for cards)
  { from: /border-l-gray-600/g, to: 'border-l-divider-strong' },
  { from: /border-l-gray-700/g, to: 'border-l-divider' },
  { from: /border-l-gray-800/g, to: 'border-l-divider' },

  // Focus states
  { from: /focus:ring-offset-gray-900/g, to: 'focus:ring-offset-surface' },
];

// Recursively find all .tsx files in a directory
function findTsxFiles(dir, files = []) {
  const items = readdirSync(dir);
  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      findTsxFiles(fullPath, files);
    } else if (item.endsWith('.tsx') && !fullPath.includes('TerminalView.tsx')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function migrateFile(filePath) {
  let content = readFileSync(filePath, 'utf-8');
  let changesMade = 0;

  // Apply all replacements
  for (const { from, to } of REPLACEMENTS) {
    const before = content;
    content = content.replace(from, to);
    if (content !== before) {
      changesMade++;
    }
  }

  if (changesMade > 0) {
    writeFileSync(filePath, content, 'utf-8');
    console.log(`✓ ${filePath} (${changesMade} patterns replaced)`);
    return true;
  }

  return false;
}

async function main() {
  console.log('🎨 Migrating components to semantic color tokens...\n');

  const baseDir = '/home/eltmon/projects/panopticon/workspaces/feature-pan-129/src/dashboard/frontend/src';
  const componentFiles = findTsxFiles(join(baseDir, 'components'));
  const pageFiles = findTsxFiles(join(baseDir, 'pages'));
  const files = [...componentFiles, ...pageFiles];

  let migratedCount = 0;

  for (const file of files) {
    const wasMigrated = await migrateFile(file);
    if (wasMigrated) migratedCount++;
  }

  console.log(`\n✅ Migration complete: ${migratedCount}/${files.length} files updated`);
}

main().catch(console.error);
