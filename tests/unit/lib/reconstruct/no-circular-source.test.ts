import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RECONSTRUCT_DIR = join(__dirname, '../../../../src/lib/reconstruct');

const FORBIDDEN = [
  'readFrom(',
  'getAllReviewStatusesFromDb',
  'getReviewStatusesFromDb',
  'collectInFlightIssueIds',
  'projection_cache',
  'projectionCache.load',
];

describe('PAN-1920 reconstruction sources', () => {
  const files = readdirSync(RECONSTRUCT_DIR).filter((f) => f.endsWith('.ts'));

  it('does not read from SQLite cache tables or legacy cache enumerators', () => {
    for (const file of files) {
      const src = readFileSync(join(RECONSTRUCT_DIR, file), 'utf-8');
      for (const sym of FORBIDDEN) {
        expect(src, `${file} must not reference cache source ${sym}`).not.toContain(sym);
      }
    }
  });

  it('does not import the dashboard event store', () => {
    for (const file of files) {
      const src = readFileSync(join(RECONSTRUCT_DIR, file), 'utf-8');
      expect(src, `${file} must not statically import event-store`).not.toMatch(
        /from\s+['"].*event-store.*['"]/,
      );
    }
  });
});
