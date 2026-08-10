import { describe, expect, it } from 'vitest';
import {
  execFailureStdout,
  parseCliproxyVersion,
} from '../../src/lib/cliproxy.js';

describe('CLIProxy version probe', () => {
  it('parses the CLIProxyAPI version banner', () => {
    expect(parseCliproxyVersion('CLIProxyAPI Version: 7.2.113, Commit: bc71c77f')).toBe('7.2.113');
    expect(parseCliproxyVersion('garbage')).toBeNull();
  });

  it('reads stdout attached to failed process executions', () => {
    expect(execFailureStdout({ stdout: 'CLIProxyAPI Version: 7.2.113' })).toBe('CLIProxyAPI Version: 7.2.113');
    expect(execFailureStdout({ stdout: Buffer.from('CLIProxyAPI Version: 7.2.113') })).toBe('CLIProxyAPI Version: 7.2.113');
    expect(execFailureStdout(new Error('no stdout'))).toBe('');
  });
});
