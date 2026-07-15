import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { DOD_ROWS } from '../../../../src/lib/lifecycle/dod.js';

describe('Definition-of-Done documentation', () => {
  it('enumerates every canonical DoD row exactly once', () => {
    const document = readFileSync(join(process.cwd(), 'docs/DEFINITION-OF-DONE.md'), 'utf8');
    const tableRows = document
      .split('\n')
      .map(line => line.match(/^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map(match => ({ num: Number(match[1]), id: match[2] }));

    expect(tableRows).toHaveLength(DOD_ROWS.length);
    for (const row of DOD_ROWS) {
      expect(tableRows).toContainEqual({ num: row.num, id: row.id });
    }
  });
});
