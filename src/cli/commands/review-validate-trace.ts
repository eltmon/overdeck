import { readFile } from 'node:fs/promises';
import { validateRequirementsTrace } from '../../lib/cloister/review-requirements-validator.js';

export interface ReviewValidateTraceOptions {
  /** no options currently */
}

export async function reviewValidateTraceCommand(
  file: string,
  _opts: ReviewValidateTraceOptions = {},
): Promise<void> {
  const content = await readFile(file, 'utf8');
  const result = validateRequirementsTrace(content);
  if (result.ok) {
    process.exit(0);
  }
  if (result.reason) {
    console.error(result.reason);
  }
  process.exit(1);
}
