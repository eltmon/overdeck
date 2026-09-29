// Prints the model-placement table from evals/results/*.jsonl.
// Run with: npx tsx evals/report.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_RESULTS_DIR, latestRecords, parseEvalRecords, renderPlacementTable, type EvalCaseRecord } from './lib/eval-results.js';

const files = existsSync(DEFAULT_RESULTS_DIR)
  ? readdirSync(DEFAULT_RESULTS_DIR)
      .filter((name) => name.endsWith('.jsonl'))
      .sort()
  : [];

if (files.length === 0) {
  console.error(`No result records in ${DEFAULT_RESULTS_DIR}. Run a suite first: OVERDECK_EVAL_MODEL=<id> npm run eval`);
  process.exit(1);
}

const records: EvalCaseRecord[] = [];
for (const name of files) {
  const file = path.join(DEFAULT_RESULTS_DIR, name);
  try {
    records.push(...parseEvalRecords(readFileSync(file, 'utf8')));
  } catch (err) {
    throw new Error(`${file}: ${(err as Error).message}`);
  }
}

process.stdout.write(renderPlacementTable(latestRecords(records)));
