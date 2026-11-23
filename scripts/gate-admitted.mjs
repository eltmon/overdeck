#!/usr/bin/env node
/**
 * Run a chain of tsc lanes under ONE machine-wide gate admission (PAN-5617).
 *
 * Usage: node scripts/gate-admitted.mjs <footprint-key> -- <command> [args…]
 *
 * `npm run typecheck` and `npm run lint:effect-diagnostics` run several tsc
 * lanes in a row, each through scripts/tsc-admitted.mjs. Admitted one lane at
 * a time, every lane rejoined the queue at the back (PAN-5617). This wrapper
 * takes one admission for the whole chain and runs <command> with
 * OVERDECK_GATE_ADMITTED=1, so each lane runs tsc directly inside the chain's
 * one slot. The chain's peak RSS is recorded under <footprint-key>
 * (`chain:<npm script>`); lanes run in series, so it is the largest lane's.
 *
 * Under CI, OVERDECK_GATE_ADMISSION=0 or OVERDECK_GATE_ADMITTED=1 it runs the
 * command directly and loads nothing but Node built-ins. Any admission timeout
 * (memory, queue, slots or CPU) exits 75 without running the command. A setup
 * failure (tsx cannot load, admission root unreadable) runs it with
 * OVERDECK_GATE_ADMISSION=0, so the lanes do not each fail the same way again.
 */
import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';

const USAGE = 'usage: node scripts/gate-admitted.mjs <footprint-key> -- <command> [args…]';
const [footprintKey, separator, command, ...args] = process.argv.slice(2);
if (!footprintKey || footprintKey === '--' || separator !== '--' || !command) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

function bypassAdmission(env) {
  return Boolean(env.CI) || env.OVERDECK_GATE_ADMISSION === '0' || env.OVERDECK_GATE_ADMITTED === '1';
}

/** Run the command unadmitted with `env` and exit with its code (or 128 + signal number). */
function runDirect(env) {
  const child = spawn(command, args, { stdio: 'inherit', env });
  const forward = (signal) => () => { child.kill(signal); };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, forward(signal));
  child.once('error', (error) => {
    process.stderr.write(`[gate-admission] could not start ${command}: ${error.message}\n`);
    process.exit(1);
  });
  child.once('exit', (code, signal) => {
    const signalNumber = signal ? osConstants.signals[signal] : undefined;
    process.exit(code ?? (signalNumber === undefined ? 1 : 128 + signalNumber));
  });
}

if (bypassAdmission(process.env)) {
  runDirect(process.env);
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
    process.exitCode = await run.runAdmittedCommand(
      { footprintKey, command, args, cwd: process.cwd() },
      { maxWaitMs: run.CHAIN_MAX_WAIT_MS, failClosedOnTimeout: true },
    );
  } else {
    runDirect({ ...process.env, OVERDECK_GATE_ADMISSION: '0' });
  }
}
