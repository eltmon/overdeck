#!/usr/bin/env node
/**
 * Run one `tsc` process under machine-wide gate admission (PAN-5248).
 *
 * Usage: node scripts/tsc-admitted.mjs <tsc args…>
 *
 * Every `tsc` lane of `npm run typecheck` and the lint ratchet scripts goes
 * through this wrapper, so overlapping typechecks queue for CPU and memory
 * instead of exhausting the host. It runs `node_modules/.bin/tsc` from the
 * current directory with inherited stdio and exits with tsc's exit code.
 * Its own messages go to stderr, prefixed `[gate-admission]`.
 *
 * Under CI, OVERDECK_GATE_ADMISSION=0 or OVERDECK_GATE_ADMITTED=1 it runs tsc
 * directly and loads nothing but Node built-ins. Otherwise it loads the
 * admission runner through tsx. A memory timeout exits 75 without running tsc;
 * any other admission failure runs tsc unadmitted.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const tscBin = join(process.cwd(), 'node_modules', '.bin', 'tsc');

try {
  accessSync(tscBin, fsConstants.X_OK);
} catch {
  process.stderr.write("✖ missing node_modules/.bin/tsc — run 'bun install' first (never falling back to the npm registry).\n");
  process.exit(1);
}

function bypassAdmission(env) {
  return Boolean(env.CI) || env.OVERDECK_GATE_ADMISSION === '0' || env.OVERDECK_GATE_ADMITTED === '1';
}

/** Run tsc unadmitted and exit with its code (or 128 + signal number). */
function runDirect() {
  const child = spawn(tscBin, args, { stdio: 'inherit' });
  const forward = (signal) => () => { child.kill(signal); };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, forward(signal));
  child.once('error', (error) => {
    process.stderr.write(`[gate-admission] could not start ${tscBin}: ${error.message}\n`);
    process.exit(1);
  });
  child.once('exit', (code, signal) => {
    const signalNumber = signal ? osConstants.signals[signal] : undefined;
    process.exit(code ?? (signalNumber === undefined ? 1 : 128 + signalNumber));
  });
}

if (bypassAdmission(process.env)) {
  runDirect();
} else {
  let run;
  try {
    const { register } = await import('tsx/esm/api');
    register();
    run = await import(new URL('../src/lib/cloister/gate-admission-run.ts', import.meta.url).href);
  } catch (error) {
    process.stderr.write(`[gate-admission] proceeding without admission: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  if (run) {
    process.exitCode = await run.runAdmittedCommand({
      footprintKey: run.tscFootprintKey(args),
      command: tscBin,
      args,
      cwd: process.cwd(),
    });
  } else {
    runDirect();
  }
}
