import { describe, it, expect, vi } from 'vitest';

// PAN-3172: when the PTY supervisor dies before binding its socket, the spawn
// path only saw the socket timeout. Four conversations across four models died
// identically and the recorded spawn_error said nothing about the real cause —
// an ERR_MODULE_NOT_FOUND for @lydell/node-pty sitting in the tmux pane — which
// sent the operator hunting the memory governor instead.

vi.setConfig({ testTimeout: 15_000 });

const { extractSupervisorFailure } = await import('../conversation-runtime.js');

const MODULE_NOT_FOUND_PANE = [
  'node:internal/modules/esm/resolve:275',
  '  throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base), null);',
  '        ^',
  '',
  "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@lydell/node-pty' imported from "
  + '/home/u/.overdeck/deployments/dashboard/.pan-reload-generation-b/dist/pty-supervisor.js',
  '    at packageResolve (node:internal/modules/esm/resolve:275:9)',
].join('\n');

describe('extractSupervisorFailure', () => {
  it('surfaces the module resolution error from the pane', () => {
    const failure = extractSupervisorFailure(MODULE_NOT_FOUND_PANE);

    expect(failure).toContain('ERR_MODULE_NOT_FOUND');
    expect(failure).toContain('@lydell/node-pty');
  });

  it('returns null when no line looks like an error', () => {
    const failure = extractSupervisorFailure('starting\n\nwaiting for pty\n');

    expect(failure).toBeNull();
  });

  it('returns null for an empty pane so the timeout message stands alone', () => {
    expect(extractSupervisorFailure('')).toBeNull();
    expect(extractSupervisorFailure('   \n\n  ')).toBeNull();
  });

  it('caps the extracted detail so a noisy pane cannot flood spawn_error', () => {
    const noisy = Array.from({ length: 20 }, (_, i) => `Error: line ${i} ${'x'.repeat(200)}`).join('\n');

    expect(extractSupervisorFailure(noisy)!.length).toBeLessThanOrEqual(500);
  });
});
