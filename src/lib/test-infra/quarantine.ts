import fs from 'node:fs';
import path from 'node:path';

/**
 * Parse the contents of a flaky-test quarantine file.
 *
 * Line format: `<relative-path>  # <issue-ref>`
 * Blank lines and lines starting with `#` are ignored.
 * The path is everything before the first `#`; trailing whitespace is trimmed.
 */
export function parseQuarantineList(contents: string): string[] {
  return contents
    .split('\n')
    .map((line) => line.split('#')[0].trim())
    .filter((line) => line.length > 0);
}

/**
 * Read and parse the project's quarantine file.
 *
 * Returns an empty array if the file is absent so that removing the
 * quarantine is always free and never breaks the build.
 */
export function readQuarantineList(projectRoot: string): string[] {
  const quarantinePath = path.resolve(projectRoot, 'scripts/flaky-quarantine.txt');
  if (!fs.existsSync(quarantinePath)) {
    return [];
  }
  return parseQuarantineList(fs.readFileSync(quarantinePath, 'utf8'));
}
