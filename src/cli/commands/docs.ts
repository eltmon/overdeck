/**
 * `pan docs` — Panopticon documentation RAG retriever (PAN-1203).
 *
 * Subcommands:
 *   query     Query the docs index for relevant snippets
 *   reindex   Regenerate the docs index from current docs/, skills/, etc.
 *   disable   Disable docs RAG injection (session/project/global scope)
 *   enable    Re-enable docs RAG injection
 */

import { Command } from 'commander';
import {
  queryDocsIndex,
  formatDocsQueryMarkdown,
  formatDocsQueryJson,
  type DocsQueryResult,
} from '../../lib/docs/query.js';
import { setDocsDisabled, type DocsDisableScope } from '../../lib/docs/state.js';

export interface DocsQueryOptions {
  top?: string;
  format?: 'markdown' | 'json' | 'text';
  indexPath?: string;
  kind?: 'docs' | 'skill' | 'rule' | 'claude-md' | 'prd';
}

export function createDocsCommand(): Command {
  const docs = new Command('docs').description('Panopticon documentation RAG (PAN-1203)');

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
      const result = queryDocsIndex({
        query: text,
        top,
        indexPath: options.indexPath,
        kind: options.kind,
      });
      printDocsQueryResult(result, options.format ?? 'markdown');
    });

  docs
    .command('reindex')
    .description('Regenerate the docs index from current docs/, skills/, etc.')
    .action(async () => {
      const { spawn } = await import('child_process');
      const child = spawn('node', ['scripts/build-docs-index.mjs'], {
        stdio: 'inherit',
        env: process.env,
      });
      child.on('exit', (code) => process.exit(code ?? 1));
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
    console.log(item.displayContent);
    console.log('');
  }
}
