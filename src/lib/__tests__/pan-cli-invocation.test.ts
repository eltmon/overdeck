import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { panCliInvocation } from '../pan-cli-invocation.js';

describe('panCliInvocation', () => {
  it('launches the bundled CLI with the running Node executable', () => {
    expect(panCliInvocation(['sync'], {
      nodePath: '/opt/node/bin/node',
      root: '/opt/overdeck',
    })).toEqual({
      command: '/opt/node/bin/node',
      args: [join('/opt/overdeck', 'dist', 'cli', 'index.js'), 'sync'],
    });
  });

  it('does not depend on a pan executable being present on PATH', () => {
    const previousPath = process.env.PATH;
    process.env.PATH = '';
    try {
      expect(panCliInvocation(['context', 'sync'], {
        nodePath: '/opt/node/bin/node',
        root: '/opt/overdeck',
      })).toEqual({
        command: '/opt/node/bin/node',
        args: [join('/opt/overdeck', 'dist', 'cli', 'index.js'), 'context', 'sync'],
      });
    } finally {
      process.env.PATH = previousPath;
    }
  });
});
