import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// PAN-3917: the schema assertion is gone with the panopticon database it read.
// What is left is the source guard: nothing in the read path may re-introduce
// the cache.
describe('projection_cache deletion is locked (PAN-1847)', () => {
  it('dashboard server source files contain no projection_cache re-introduction patterns', () => {
    const root = join(process.cwd(), 'src/dashboard/server');
    const files = [
      join(root, 'read-model.ts'),
      join(root, 'event-store.ts'),
      join(root, 'services/agent-state-service.ts'),
    ];

    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      expect(src, `${file} must not reference initProjectionCache`).not.toContain('initProjectionCache');
      expect(src, `${file} must not call .save(buildSnapshot)`).not.toContain('.save(buildSnapshot');
      expect(src, `${file} must not import services/projection-cache`).not.toContain(
        'services/projection-cache',
      );
    }
  });
});
