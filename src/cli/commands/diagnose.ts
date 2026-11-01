/**
 * `pan diagnose` — collect a redacted diagnostic bundle and, with operator
 * consent, start Claude Code or Codex to fix the problem (PAN-4643 FR-4,
 * FR-15, FR-16, D6-D9, D14, NFR-1, NFR-2).
 *
 * All printing for this feature happens here, through the injectable `out`/
 * `err`, never inside `src/lib/diagnostics/**` (NFR-2).
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { exitCli } from '../exit.js';
import {
  createBundleDir,
  diagnosticsRoot,
  writeDiagnosticBundle,
  type BundleEntry,
  type CollectorFailure,
} from '../../lib/diagnostics/bundle.js';
import { collectDoctor } from '../../lib/diagnostics/collect-doctor.js';
import { collectFiles } from '../../lib/diagnostics/collect-files.js';
import { collectSystem } from '../../lib/diagnostics/collect-system.js';
import {
  buildHarnessLaunch,
  checkHarnessEligibility,
  listHarnessEligibility,
  type DiagnoseHarness,
  type HarnessEligibility,
} from '../../lib/diagnostics/harness.js';
import { buildDiagnosePrompt } from '../../lib/diagnostics/prompt.js';
import { getOverdeckHome } from '../../lib/paths.js';

export interface DiagnoseOptions {
  harness?: DiagnoseHarness;
  describe?: string;
  bundleOnly?: boolean;
  /** commander sets `issue: false` for --no-issue; default (no flag) is true. */
  issue?: boolean;
  yes?: boolean;
}

export interface DiagnoseDeps {
  out: (line: string) => void;
  err: (line: string) => void;
  readLine: (prompt: string) => Promise<string>;
  isTTY: boolean;
  exit: (code: number) => Promise<never>;
  collectSystem: typeof collectSystem;
  collectFiles: typeof collectFiles;
  collectDoctor: typeof collectDoctor;
  listHarnessEligibility: typeof listHarnessEligibility;
  checkHarnessEligibility: typeof checkHarnessEligibility;
  spawnForeground: (command: string, args: string[], cwd: string) => Promise<number | null>;
  onSignals: () => void;
  offSignals: () => void;
  now: () => Date;
  overdeckHome: string;
  home: string;
}

const SIGNAL_NOOP = (): void => {};

function defaultOnSignals(): void {
  process.on('SIGINT', SIGNAL_NOOP);
  process.on('SIGQUIT', SIGNAL_NOOP);
}

function defaultOffSignals(): void {
  process.off('SIGINT', SIGNAL_NOOP);
  process.off('SIGQUIT', SIGNAL_NOOP);
}

function defaultSpawnForeground(command: string, args: string[], cwd: string): Promise<number | null> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', cwd });
    child.on('error', reject);
    child.on('exit', (code) => resolvePromise(code));
  });
}

export const defaultDiagnoseDeps: DiagnoseDeps = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  readLine: (prompt) => new Promise((resolvePromise) => {
    const rl = createInterface({ input: process.stdin, output: process.stdin.isTTY ? process.stdout : undefined });
    rl.question(prompt, (answer) => {
      rl.close();
      resolvePromise(answer);
    });
  }),
  isTTY: Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY),
  exit: (code) => exitCli(code),
  collectSystem,
  collectFiles,
  collectDoctor,
  listHarnessEligibility,
  checkHarnessEligibility,
  spawnForeground: defaultSpawnForeground,
  onSignals: defaultOnSignals,
  offSignals: defaultOffSignals,
  now: () => new Date(),
  overdeckHome: getOverdeckHome(),
  home: homedir(),
};

function ineligibleMessage(eligibility: HarnessEligibility): string {
  return `${eligibility.label} is not available: ${eligibility.reason}. Fix: ${eligibility.fix}`;
}

interface HarnessChoice {
  harness: DiagnoseHarness;
  label: string;
}

/** D9: no `--harness` given, on a TTY. */
async function selectHarnessViaMenu(deps: DiagnoseDeps): Promise<HarnessChoice | null> {
  const eligibilities = await deps.listHarnessEligibility();
  const eligible = eligibilities.filter((entry) => entry.eligible);

  if (eligible.length === 0) {
    for (const entry of eligibilities) deps.err(ineligibleMessage(entry));
    deps.err('No harness is installed and signed in. Use --bundle-only to still collect the diagnostic bundle.');
    return null;
  }

  if (eligible.length === 1) {
    deps.out(`Using ${eligible[0].label} (the only installed and signed-in harness).`);
    return { harness: eligible[0].harness, label: eligible[0].label };
  }

  deps.out(eligible.map((entry, index) => `${index + 1}) ${entry.label}`).join('  '));
  const answer = (await deps.readLine('Choose a harness: ')).trim();
  const choice = Number(answer);
  if (!Number.isInteger(choice) || choice < 1 || choice > eligible.length) {
    deps.err('No harness selected.');
    return null;
  }
  return { harness: eligible[choice - 1].harness, label: eligible[choice - 1].label };
}

/** D14: --describe, else a TTY prompt, else the placeholder. */
async function resolveDescription(options: DiagnoseOptions, deps: DiagnoseDeps): Promise<string> {
  if (options.describe) return options.describe;
  if (deps.isTTY) {
    const answer = (await deps.readLine('Describe what went wrong (one line, Enter to skip): ')).trim();
    if (answer) return answer;
  }
  return '(no description given)';
}

export async function diagnoseCommand(options: DiagnoseOptions = {}, deps: DiagnoseDeps = defaultDiagnoseDeps): Promise<void> {
  const issueStep = options.issue !== false;
  let harness: HarnessChoice | null = null;

  if (!options.bundleOnly) {
    if (options.harness) {
      const eligibility = await deps.checkHarnessEligibility(options.harness);
      if (!eligibility.eligible) {
        deps.err(ineligibleMessage(eligibility));
        return deps.exit(1);
      }
      harness = { harness: options.harness, label: eligibility.label };
    } else if (deps.isTTY) {
      harness = await selectHarnessViaMenu(deps);
      if (harness === null) return deps.exit(1);
    }
  }

  const description = await resolveDescription(options, deps);

  deps.out('Collecting diagnostics…');
  const root = diagnosticsRoot(deps.overdeckHome);
  const now = deps.now();
  const dir = await createBundleDir(root, now);

  const [system, files, doctor] = await Promise.all([
    deps.collectSystem(),
    deps.collectFiles({ overdeckHome: deps.overdeckHome, logsDir: join(deps.overdeckHome, 'logs') }),
    deps.collectDoctor(),
  ]);

  const prompt = buildDiagnosePrompt({ bundleDir: dir, issueStep });

  const entries: BundleEntry[] = [
    { path: 'PROMPT.md', content: prompt, kind: 'text', description: 'The harness launch prompt' },
    { path: 'description.md', content: `${description}\n`, kind: 'text', description: "The operator's description of what went wrong" },
    ...system.entries,
    ...doctor.entries,
    ...files.entries,
  ];
  const failures: CollectorFailure[] = [...system.failures, ...files.failures, ...doctor.failures];

  const result = await writeDiagnosticBundle({ dir, entries, failures, now, home: deps.home });

  if (options.bundleOnly) {
    deps.out(dir);
    return deps.exit(0);
  }

  if (!deps.isTTY) {
    deps.out(dir);
    deps.err('pan diagnose needs an interactive terminal to start a harness. Use --bundle-only, or run it in a terminal.');
    return deps.exit(1);
  }

  deps.out(`Bundle: ${dir}`);
  for (const file of result.files) {
    deps.out(`  ${file.path} (${file.bytes} bytes, ${file.redactions} redactions)`);
  }

  if (!options.yes) {
    const answer = (await deps.readLine(`Start ${harness!.label} with this bundle? [y/N] `)).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      deps.out(`Bundle kept at ${dir}`);
      return deps.exit(0);
    }
  }

  const launch = buildHarnessLaunch(harness!.harness, prompt, deps.overdeckHome);
  deps.onSignals();
  try {
    const code = await deps.spawnForeground(launch.command, launch.args, launch.cwd);
    deps.out(`Bundle kept at ${dir}`);
    return deps.exit(code ?? 1);
  } catch (error) {
    deps.err(`Failed to start ${harness!.label}: ${error instanceof Error ? error.message : String(error)}`);
    deps.out(`Bundle kept at ${dir}`);
    return deps.exit(1);
  } finally {
    deps.offSignals();
  }
}
