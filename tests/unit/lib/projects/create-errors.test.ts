/**
 * Tests for the typed project-creation failure taxonomy (PAN-3836 WI-1.3).
 *
 * Two things are load-bearing here and both are security-shaped: a credential
 * echoed by git must never survive into a message, a detail, or a log; and a
 * category must never send the operator to fix something that was not involved
 * (telling an HTTPS user to run ssh-add is a wrong answer, not a vague one).
 */

import { describe, it, expect } from 'vitest';
import {
  classifyGitFailure,
  sanitizeDiagnostic,
  boundedDetail,
  sanitizeCreationFailure,
  setupIncompleteFailure,
  MAX_DETAIL_BYTES,
} from '../../../../src/lib/projects/create-errors';

describe('sanitizeDiagnostic', () => {
  it('strips userinfo from a credential-bearing URL', () => {
    const raw = "fatal: could not read from 'https://octo:ghp_SECRETTOKEN@github.com/acme/w.git'";
    const clean = sanitizeDiagnostic(raw);
    expect(clean).not.toContain('ghp_SECRETTOKEN');
    expect(clean).not.toContain('octo:');
    expect(clean).toContain('https://github.com/acme/w.git');
  });

  it('strips a bare username as well as a password', () => {
    // A username is not a secret, but it is still identity echoed into a log.
    expect(sanitizeDiagnostic('remote: https://deploy-bot@gitlab.com/g/r.git')).toContain(
      'https://gitlab.com/g/r.git',
    );
  });

  it('redacts an echoed authorization header', () => {
    const clean = sanitizeDiagnostic('Authorization: Bearer abc.def.ghi');
    expect(clean).not.toContain('abc.def.ghi');
    expect(clean).toContain('[redacted]');
  });

  it('removes ANSI escapes', () => {
    expect(sanitizeDiagnostic('[31mfatal: nope[0m')).toBe('fatal: nope');
  });

  it('collapses carriage-return progress repaints instead of treating them as errors', () => {
    const progress = 'Receiving objects:  10%\rReceiving objects:  50%\rReceiving objects: 100%';
    expect(sanitizeDiagnostic(progress).split('\n')).toHaveLength(3);
  });
});

describe('boundedDetail', () => {
  it('returns undefined for empty input', () => {
    expect(boundedDetail('')).toBeUndefined();
    expect(boundedDetail(null)).toBeUndefined();
    expect(boundedDetail(undefined)).toBeUndefined();
  });

  it('keeps short details verbatim', () => {
    expect(boundedDetail('fatal: nope')).toBe('fatal: nope');
  });

  it('keeps only the tail when output exceeds the cap, preserving the real error', () => {
    const noise = Array.from({ length: 5000 }, (_, i) => `Receiving objects: ${i}`).join('\n');
    const detail = boundedDetail(`${noise}\nfatal: the actual error`)!;
    expect(Buffer.byteLength(detail, 'utf8')).toBeLessThanOrEqual(MAX_DETAIL_BYTES + 8);
    expect(detail).toContain('fatal: the actual error');
    expect(detail.startsWith('…')).toBe(true);
  });
});

describe('classifyGitFailure', () => {
  it('classifies host-key verification before anything else SSH-shaped', () => {
    const failure = classifyGitFailure(
      'Host key verification failed.\nfatal: Could not read from remote repository.',
    );
    expect(failure.code).toBe('host-key-untrusted');
    expect(failure.message).toMatch(/has not trusted/i);
    expect(failure.retrySafe).toBe(true);
  });

  it('names the SSH agent only for a proven publickey failure', () => {
    const failure = classifyGitFailure(
      'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
    );
    expect(failure.code).toBe('authentication-required');
    expect(failure.message).toMatch(/ssh-add/);
  });

  it('never mentions ssh-add for an HTTPS credential failure', () => {
    const failure = classifyGitFailure(
      "fatal: Authentication failed for 'https://github.com/acme/private.git/'",
    );
    expect(failure.code).toBe('authentication-required');
    expect(failure.message).not.toMatch(/ssh-add/);
    expect(failure.message).toMatch(/Configure credentials/);
  });

  it('treats terminal-prompts-disabled as an authentication problem', () => {
    const failure = classifyGitFailure(
      'fatal: could not read Username for https://github.com: terminal prompts disabled',
    );
    expect(failure.code).toBe('authentication-required');
  });

  it('classifies DNS and connection failures as unreachable', () => {
    for (const stderr of [
      'fatal: unable to access: Could not resolve host: githb.com',
      'ssh: connect to host example.com port 22: Connection refused',
    ]) {
      expect(classifyGitFailure(stderr).code).toBe('remote-unreachable');
    }
  });

  it('calls a missing repository unreachable, not an auth failure, without SSH evidence', () => {
    const failure = classifyGitFailure("remote: Repository not found.\nfatal: repository 'https://github.com/a/b.git/' not found");
    expect(failure.code).toBe('remote-unreachable');
  });

  it('offers use-existing recovery for a non-empty destination', () => {
    const failure = classifyGitFailure(
      "fatal: destination path 'widget' already exists and is not an empty directory.",
      { targetPath: '/home/op/Projects/widget' },
    );
    expect(failure.code).toBe('destination-conflict');
    expect(failure.message).toContain('/home/op/Projects/widget');
    // Neither action deletes anything, so pressing Create again is not the fix.
    expect(failure.retrySafe).toBe(false);
    expect(failure.recovery).toEqual({ action: 'use-existing', path: '/home/op/Projects/widget' });
  });

  it('falls back to a generic internal error rather than guessing', () => {
    const failure = classifyGitFailure('fatal: something nobody has seen before');
    expect(failure.code).toBe('internal-error');
    expect(failure.message).toBe('Project setup failed on the server.');
  });

  it('redacts credentials in the detail it attaches', () => {
    const failure = classifyGitFailure(
      "fatal: Authentication failed for 'https://u:ghp_LEAKME@github.com/a/b.git'",
    );
    expect(JSON.stringify(failure)).not.toContain('ghp_LEAKME');
  });
});

describe('typed failure constructors', () => {
  it('setup-incomplete is never retry-safe and carries the repair action', () => {
    const failure = setupIncompleteFailure({ key: 'widget', path: '/home/op/Projects/widget' });
    expect(failure.code).toBe('setup-incomplete');
    // Retrying would hit the duplicate guard or clone a second copy.
    expect(failure.retrySafe).toBe(false);
    expect(failure.recovery).toEqual({
      action: 'finish-setup',
      key: 'widget',
      path: '/home/op/Projects/widget',
    });
    expect(failure.message).toContain('/home/op/Projects/widget');
  });



  it('sanitizeCreationFailure never leaks a stack', () => {
    const err = new Error('fatal: something nobody has seen before');
    const failure = sanitizeCreationFailure(err);
    expect(JSON.stringify(failure)).not.toContain('at Object');
    expect(failure.code).toBe('internal-error');
  });

  it('sanitizeCreationFailure still classifies a git error thrown as an Error', () => {
    const failure = sanitizeCreationFailure(new Error('Host key verification failed.'));
    expect(failure.code).toBe('host-key-untrusted');
  });

  it('sanitizeCreationFailure handles a non-Error throw', () => {
    expect(sanitizeCreationFailure({ weird: true }).code).toBe('internal-error');
    expect(sanitizeCreationFailure(undefined).code).toBe('internal-error');
  });
});
