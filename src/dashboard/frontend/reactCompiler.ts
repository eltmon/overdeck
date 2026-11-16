/**
 * React Compiler options shared by every pipeline that compiles dashboard
 * frontend source (PAN-4561): vite.config.ts, vitest.config.ts,
 * apps/mobile/vite.config.ts and the skip-coverage scan
 * (scripts/reactCompilerCoverage.ts). One object, so the baseline the scan
 * checks matches what the build ships. panicThreshold 'none' keeps a
 * recoverable diagnostic from failing the build; the coverage test is the gate.
 */
import type { ReactCompilerOptions } from '@vitejs/plugin-react';

export const reactCompilerOptions = {
  target: '19',
  panicThreshold: 'none',
} as const satisfies ReactCompilerOptions;
