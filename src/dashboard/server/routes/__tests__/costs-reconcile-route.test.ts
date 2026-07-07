import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('POST /api/costs/reconcile route wiring', () => {
  it('runs the legacy Claude transcript reconciler alongside ohmypi and codex sweeps', () => {
    const source = readFileSync(join(__dirname, '../costs.ts'), 'utf-8');
    const start = source.indexOf("'/api/costs/reconcile'");
    const end = source.indexOf('// ─── Route: GET /api/costs/experiments', start);
    const route = source.slice(start, end);

    expect(route).toContain('Effect.runPromise(reconcile())');
    expect(route).toContain("runOverdeck('ohmypi')");
    expect(route).toContain("runOverdeck('codex')");
    expect(route).toContain('...result');
  });
});
