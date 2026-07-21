/**
 * `pan docs` — Overdeck documentation RAG retriever (PAN-1203).
 *
 * Subcommands:
 *   query     Query the docs index for relevant snippets
 *   reindex   Regenerate the docs index from current docs/, skills/, etc.
 *   disable   Disable docs RAG injection (session/project/global scope)
 *   enable    Re-enable docs RAG injection
 */

import { Command } from 'commander';
import { existsSync } from 'fs';
import {
  queryDocsIndex,
  formatDocsQueryMarkdown,
  formatDocsQueryJson,
  type DocsQueryResult,
} from '../../lib/docs/query.js';
import { setDocsDisabled, type DocsDisableScope } from '../../lib/docs/state.js';
import {
  buildDocsIndex,
  DEFAULT_DOCS_INDEX_MAX_BYTES,
  type BuildDocsIndexOptions,
  type BuildDocsIndexResult,
} from '../../lib/docs/index-builder.js';
import { getDocsIndexPath, packageRoot, type DocsPathOverrides } from '../../lib/paths.js';

export interface DocsQueryOptions {
  top?: string;
  format?: 'markdown' | 'json' | 'text';
  indexPath?: string;
  kind?: 'docs' | 'skill' | 'rule' | 'claude-md' | 'prd';
}

export interface DocsReindexOptions {
  docsDir?: DocsPathOverrides['docsDir'];
  indexPath?: DocsPathOverrides['indexPath'];
  rootDir?: BuildDocsIndexOptions['rootDir'];
  syncSourcesRoot?: BuildDocsIndexOptions['syncSourcesRoot'];
  config?: BuildDocsIndexOptions['config'];
  embeddingFn?: BuildDocsIndexOptions['embeddingFn'];
  maxIndexBytes?: BuildDocsIndexOptions['maxIndexBytes'];
}

export async function runDocsReindex(options: DocsReindexOptions = {}): Promise<BuildDocsIndexResult> {
  const result = await buildDocsIndex({
    outputPath: getDocsIndexPath({ docsDir: options.docsDir, indexPath: options.indexPath }),
    rootDir: options.rootDir ?? packageRoot,
    syncSourcesRoot: options.syncSourcesRoot,
    config: options.config,
    embeddingFn: options.embeddingFn,
    maxIndexBytes: options.maxIndexBytes ?? DEFAULT_DOCS_INDEX_MAX_BYTES,
  });

  console.log(`Docs index rebuilt at ${result.outputPath}`);
  console.log(`Chunks: ${result.chunkCount}`);
  console.log(`Size: ${result.sizeBytes} bytes`);
  return result;
}

export interface CreateDocsCommandOptions {
  reindex?: DocsReindexOptions;
}

export function createDocsCommand(commandOptions: CreateDocsCommandOptions = {}): Command {
  const docs = new Command('docs').description('Overdeck documentation RAG (PAN-1203)');

  docs
    .command('query <text>')
    .description('Query the docs index for relevant snippets')
    .option('--top <n>', 'Maximum number of snippets to return', '5')
    .option('--format <fmt>', 'Output format: markdown | json | text', 'markdown')
    .option('--index-path <path>', 'Override the docs index path')
    .option('--kind <kind>', 'Filter by doc kind (docs|skill|rule|claude-md|prd)')
    .action(async (text: string, options: DocsQueryOptions) => {
      const top = Number.parseInt(options.top ?? '5', 10);
      if (!Number.isFinite(top) || top <= 0) {
        console.error(`Invalid --top value: ${options.top}`);
        process.exit(1);
      }
      const indexPath = options.indexPath ?? getDocsIndexPath();
      if (!existsSync(indexPath)) {
        console.error(`No docs index found at ${indexPath}. Run 'pan docs reindex' to build it.`);
      }
      const result = queryDocsIndex({
        query: text,
        top,
        indexPath,
        kind: options.kind,
      });
      printDocsQueryResult(result, options.format ?? 'markdown');
    });

  docs
    .command('reindex')
    .description('Regenerate the docs index from current docs/, skills/, etc.')
    .action(async () => {
      await runDocsReindex(commandOptions.reindex);
    });

  docs
    .command('disable')
    .description('Disable docs RAG injection')
    .option('--scope <scope>', 'Scope: session | project | global', 'session')
    .option('--reason <text>', 'Reason recorded in disable state')
    .action(async (options: { scope?: string; reason?: string }) => {
      const scope = (options.scope ?? 'session') as DocsDisableScope;
      if (!['session', 'project', 'global'].includes(scope)) {
        console.error(`Invalid scope: ${scope}`);
        process.exit(1);
      }
      await setDocsDisabled({ scope, disabled: true, reason: options.reason });
      console.log(`Docs RAG disabled (scope: ${scope})`);
    });

  docs
    .command('enable')
    .description('Re-enable docs RAG injection')
    .option('--scope <scope>', 'Scope: session | project | global', 'session')
    .action(async (options: { scope?: string }) => {
      const scope = (options.scope ?? 'session') as DocsDisableScope;
      if (!['session', 'project', 'global'].includes(scope)) {
        console.error(`Invalid scope: ${scope}`);
        process.exit(1);
      }
      await setDocsDisabled({ scope, disabled: false });
      console.log(`Docs RAG enabled (scope: ${scope})`);
    });

  return docs;
}

function printDocsQueryResult(result: DocsQueryResult, format: string): void {
  if (format === 'json') {
    console.log(formatDocsQueryJson(result));
    return;
  }
  if (format === 'markdown') {
    console.log(formatDocsQueryMarkdown(result));
    return;
  }
  // text fallback
  if (result.results.length === 0) {
    console.log(`No results for "${result.query}".`);
    return;
  }
  for (const item of result.results) {
    console.log(`--- ${item.docPath} (${item.docKind})`);
    console.log(item.content);
    console.log('');
  }
}
