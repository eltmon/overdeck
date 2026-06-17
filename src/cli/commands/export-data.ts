import chalk from 'chalk';
import { exportData, writeExportBundle } from '../../lib/database/export-data.js';

export interface ExportDataCommandOptions {
  json?: boolean;
  includeCostLedger?: boolean;
  bundleJsonl?: boolean;
}

/**
 * User-facing "Export my data" command.
 *
 * Produces a portable bundle of non-derivable data (conversations + favorites)
 * and, on request, a decoupled cost-ledger JSONL artifact. The core bundle can
 * be imported without the cost ledger.
 */
export async function exportDataCommand(options: ExportDataCommandOptions = {}): Promise<void> {
  const result = exportData({
    includeCostLedger: options.includeCostLedger ?? true,
    bundleJsonl: options.bundleJsonl ?? false,
  });

  const { corePath, costLedgerPath } = writeExportBundle(result);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          corePath,
          costLedgerPath,
          conversations: result.coreBundle.conversations.length,
          favorites: result.coreBundle.favorites.length,
          costLedgerRows: result.costLedger.length,
          bundledJsonlFiles: result.bundledJsonlPaths.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(chalk.bold('Export complete\n'));
  console.log(`  ${chalk.dim('Core bundle:')}      ${corePath}`);
  console.log(
    `  ${chalk.dim('Cost ledger:')}      ${costLedgerPath ?? chalk.dim('(not written — no rows or disabled)')}`,
  );
  console.log(`  ${chalk.dim('Conversations:')}    ${result.coreBundle.conversations.length}`);
  console.log(`  ${chalk.dim('Favorites:')}        ${result.coreBundle.favorites.length}`);
  console.log(`  ${chalk.dim('Cost ledger rows:')} ${result.costLedger.length}`);
  if (result.bundledJsonlPaths.length > 0) {
    console.log(`  ${chalk.dim('JSONL files:')}      ${result.bundledJsonlPaths.length}`);
  }
  console.log();
}
