import { describe, expect, it, vi } from 'vitest';

import {
  buildDoctorJsonReport,
  doctorExitCode,
  printDoctorTextReport,
  withStdoutReserved,
} from '../../../../src/cli/commands/doctor-report.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

const OK: CheckResult = { name: 'Git', status: 'ok', message: 'Installed' };
const WARN: CheckResult = { name: 'Docker', status: 'warn', message: 'Not installed', fix: 'Install docker' };
const ERROR: CheckResult = { name: 'Node', status: 'error', message: 'Missing', fix: 'Install node' };

describe('doctorExitCode', () => {
  it('returns 1 when any check is error', () => {
    expect(doctorExitCode([OK, ERROR], false)).toBe(1);
  });

  it('returns 1 when strict and any check is warn', () => {
    expect(doctorExitCode([OK, WARN], true)).toBe(1);
  });

  it('returns 0 when only warn and not strict', () => {
    expect(doctorExitCode([OK, WARN], false)).toBe(0);
  });

  it('returns 0 when all ok', () => {
    expect(doctorExitCode([OK], false)).toBe(0);
  });
});

describe('buildDoctorJsonReport', () => {
  it('maps a missing fix to null and reports correct summary/exitCode', () => {
    const now = new Date('2026-11-01T00:00:00.000Z');
    const report = buildDoctorJsonReport([OK, WARN, ERROR], {
      strict: false,
      patrolBudgets: [],
      now,
    });

    expect(report.schemaVersion).toBe(1);
    expect(report.generatedAt).toBe(now.toISOString());
    expect(report.strict).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.summary).toEqual({ ok: 1, warn: 1, error: 1 });
    expect(report.checks).toEqual([
      { name: 'Git', status: 'ok', message: 'Installed', fix: null },
      { name: 'Docker', status: 'warn', message: 'Not installed', fix: 'Install docker' },
      { name: 'Node', status: 'error', message: 'Missing', fix: 'Install node' },
    ]);
  });

  it('carries the patrol budget rows through unchanged', () => {
    const patrolBudgets = [{ patrol: 'example', actions: 2, budget: 20 as const, suspended: false }];
    const report = buildDoctorJsonReport([OK], { strict: false, patrolBudgets, now: new Date() });
    expect(report.patrolBudgets).toBe(patrolBudgets);
  });
});

describe('printDoctorTextReport', () => {
  it('returns the same exit code as doctorExitCode', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(printDoctorTextReport([OK, WARN, ERROR], { strict: false })).toBe(doctorExitCode([OK, WARN, ERROR], false));
      expect(printDoctorTextReport([OK], { strict: false })).toBe(doctorExitCode([OK], false));
      expect(printDoctorTextReport([OK, WARN], { strict: true })).toBe(doctorExitCode([OK, WARN], true));
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('withStdoutReserved', () => {
  it('routes console.log and console.info to stderr while fn runs, then restores them', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const originalLog = console.log;
    const originalInfo = console.info;

    const result = await withStdoutReserved(async () => {
      console.log('from log');
      console.info('from info');
      return 'done';
    });

    expect(result).toBe('done');
    expect(errorSpy).toHaveBeenCalledWith('from log');
    expect(errorSpy).toHaveBeenCalledWith('from info');
    expect(console.log).toBe(originalLog);
    expect(console.info).toBe(originalInfo);

    errorSpy.mockRestore();
  });

  it('restores console.log and console.info even when fn rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const originalLog = console.log;
    const originalInfo = console.info;

    await expect(
      withStdoutReserved(async () => {
        console.log('before throw');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(console.log).toBe(originalLog);
    expect(console.info).toBe(originalInfo);

    errorSpy.mockRestore();
  });
});
