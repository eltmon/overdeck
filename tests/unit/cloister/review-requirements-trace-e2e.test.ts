import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateLauncherScriptSync, type LauncherConfig } from '../../../src/lib/launcher-generator.js';
import { validateRequirementsTrace } from '../../../src/lib/cloister/review-requirements-validator.js';

const FIXTURE_DIR = resolve(process.cwd(), 'tests/fixtures/review-requirements');

describe('requirements trace launcher e2e', () => {
  let tempHome: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'pan-trace-e2e-'));
    prevHome = process.env.PANOPTICON_HOME;
    process.env.PANOPTICON_HOME = tempHome;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.PANOPTICON_HOME;
    else process.env.PANOPTICON_HOME = prevHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  function buildFixtureDirs(root: string) {
    const binDir = join(root, 'bin');
    const agentDir = join(root, 'agent-pan-1-review-requirements');
    const promptFile = join(agentDir, 'initial-prompt.md');
    const outputFile = join(agentDir, 'review-requirements.md');
    const signalMarker = join(agentDir, 'reviewer-signaled');
    const pidFile = join(agentDir, 'reviewer-launcher.pid');
    const tellLog = join(agentDir, 'tell.log');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    return { binDir, promptFile, outputFile, signalMarker, pidFile, tellLog };
  }

  function writeClaudeStub(paths: ReturnType<typeof buildFixtureDirs>, fixture: string) {
    const claudeStub = `#!/bin/bash\n# Ignore all args; copy the requested fixture to the expected output path.\ncp "${FIXTURE_DIR}/${fixture}.md" "${paths.outputFile}"\nexit 0\n`;
    writeFileSync(join(paths.binDir, 'claude'), claudeStub, { mode: 0o755 });
  }

  function writePanStub(paths: ReturnType<typeof buildFixtureDirs>, mode: 'full' | 'fallback') {
    // A tsx script stub. It must support `pan tell <target> <message>` and,
    // in full mode, `pan review validate-trace <file>` plus the --help probe.
    const shebang = '#!/usr/bin/env tsx';
    const panStub = `${shebang}
const fs = require('node:fs');
const args = process.argv.slice(2);

if (args[0] === 'tell') {
  const message = args.slice(2).join(' ');
  fs.appendFileSync('${paths.tellLog}', message + '\\n');
  process.exit(0);
}

if (args[0] === 'review' && args[1] === 'validate-trace') {
  if (args[2] === '--help') {
    process.exit(${mode === 'full' ? 0 : 1});
  }
  ${mode === 'full' ? `
  const content = fs.readFileSync(args[2], 'utf8');
  const { validateRequirementsTrace } = require('${process.cwd()}/src/lib/cloister/review-requirements-validator.ts');
  const result = validateRequirementsTrace(content);
  if (result.ok) {
    process.exit(0);
  }
  process.stderr.write(result.reason);
  process.exit(1);
  ` : 'process.stderr.write("unknown command"); process.exit(1);'}
}

process.exit(0);
`;
    writeFileSync(join(paths.binDir, 'pan'), panStub, { mode: 0o755 });
  }

  function generateScript(outputFile: string, signalMarker: string, pidFile: string): string {
    return generateLauncherScriptSync({
      role: 'review',
      workingDir: process.cwd(),
      promptFile: '/dev/null',
      promptFileMode: 'stdin',
      setPipefail: true,
      trapHup: true,
      baseCommand: 'claude --print',
      sessionId: 'sess-req',
      reviewSignal: {
        synthesisAgentId: 'agent-pan-1-review',
        subRole: 'requirements',
        outputPath: outputFile,
        signalMarkerPath: signalMarker,
        launcherPidPath: pidFile,
        timeoutSeconds: 1800,
      },
    });
  }

  function testPath(paths: ReturnType<typeof buildFixtureDirs>): string {
    return `${paths.binDir}:${process.cwd()}/node_modules/.bin:/usr/bin:/bin`;
  }

  it('signals REVIEWER_FAILED with the validator reason for a missing-trace fixture', () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-trace-fail-'));
    const paths = buildFixtureDirs(root);
    writeClaudeStub(paths, 'missing-section');
    writePanStub(paths, 'full');
    writeFileSync(paths.promptFile, '# prompt\n');

    const expectedReason = validateRequirementsTrace(readFileSync(`${FIXTURE_DIR}/missing-section.md`, 'utf8')).reason;

    const script = generateScript(paths.outputFile, paths.signalMarker, paths.pidFile);
    runLauncherScript(script, root, testPath(paths));

    const tells = readTellLog(paths.tellLog);
    expect(tells).toHaveLength(1);
    expect(tells[0]).toBe(`REVIEWER_FAILED requirements ${expectedReason}`);
    expect(existsSync(paths.signalMarker)).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });

  it('signals REVIEWER_READY for a valid-trace fixture', () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-trace-pass-'));
    const paths = buildFixtureDirs(root);
    writeClaudeStub(paths, 'happy-path');
    writePanStub(paths, 'full');
    writeFileSync(paths.promptFile, '# prompt\n');

    const script = generateScript(paths.outputFile, paths.signalMarker, paths.pidFile);
    runLauncherScript(script, root, testPath(paths));

    const tells = readTellLog(paths.tellLog);
    expect(tells).toHaveLength(1);
    expect(tells[0]).toBe(`REVIEWER_READY requirements ${paths.outputFile}`);
    expect(existsSync(paths.signalMarker)).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });

  it('falls back to REVIEWER_READY with a warning when validate-trace is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-trace-fallback-'));
    const paths = buildFixtureDirs(root);
    writeClaudeStub(paths, 'missing-section');
    writePanStub(paths, 'fallback');
    writeFileSync(paths.promptFile, '# prompt\n');

    const script = generateScript(paths.outputFile, paths.signalMarker, paths.pidFile);
    const output = runLauncherScript(script, root, testPath(paths));

    const tells = readTellLog(paths.tellLog);
    expect(tells).toHaveLength(1);
    expect(tells[0]).toBe(`REVIEWER_READY requirements ${paths.outputFile}`);
    expect(output).toContain('substrate trace check skipped');
    expect(existsSync(paths.signalMarker)).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });

  it('falls back to REVIEWER_READY with a warning when pan is not on PATH at all', () => {
    const root = mkdtempSync(join(tmpdir(), 'pan-trace-nopan-'));
    const paths = buildFixtureDirs(root);
    writeClaudeStub(paths, 'missing-section');
    // Intentionally do NOT write a pan stub so `command -v pan` resolves false.
    writeFileSync(paths.promptFile, '# prompt\n');

    // Restrict PATH so no `pan` binary is found. `claude` is also removed from
    // PATH, so we point baseCommand at the absolute stub path. To observe the
    // REVIEWER_READY tell that the launcher attempts, install a
    // command_not_found_handle that records the invocation.
    const pathEnv = '/usr/bin:/bin';
    const notFoundLog = join(root, 'not-found.log');
    const bashEnv = join(root, 'bash_env.sh');
    writeFileSync(
      bashEnv,
      `command_not_found_handle() {
  echo "$*" >> ${notFoundLog}
  return 127
}
export -f command_not_found_handle
`,
      { mode: 0o644 },
    );

    const script = generateLauncherScriptSync({
      role: 'review',
      workingDir: process.cwd(),
      promptFile: '/dev/null',
      promptFileMode: 'stdin',
      setPipefail: true,
      trapHup: true,
      baseCommand: join(paths.binDir, 'claude'),
      sessionId: 'sess-req',
      reviewSignal: {
        synthesisAgentId: 'agent-pan-1-review',
        subRole: 'requirements',
        outputPath: paths.outputFile,
        signalMarkerPath: paths.signalMarker,
        launcherPidPath: paths.pidFile,
        timeoutSeconds: 1800,
      },
    });
    const scriptPath = join(root, 'launcher.sh');
    writeFileSync(scriptPath, script, { mode: 0o755 });
    const result = spawnSync('bash', [scriptPath], {
      env: { ...process.env, PATH: pathEnv, BASH_ENV: bashEnv },
      timeout: 5000,
    });
    const output = (result.stdout?.toString() ?? '') + (result.stderr?.toString() ?? '');

    const notFoundCalls = readTellLog(notFoundLog);
    expect(notFoundCalls).toHaveLength(1);
    expect(notFoundCalls[0]).toBe(
      `pan tell agent-pan-1-review REVIEWER_READY requirements ${paths.outputFile}`,
    );
    expect(output).toContain('substrate trace check skipped');
    expect(existsSync(paths.signalMarker)).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });
});

function runLauncherScript(script: string, root: string, pathEnv: string): string {
  const scriptPath = join(root, 'launcher.sh');
  writeFileSync(scriptPath, script, { mode: 0o755 });
  const result = spawnSync('bash', [scriptPath], {
    env: { ...process.env, PATH: pathEnv },
    timeout: 5000,
  });
  return (result.stdout?.toString() ?? '') + (result.stderr?.toString() ?? '');
}

function readTellLog(path: string): string[] {
  try {
    const content = require('node:fs').readFileSync(path, 'utf8');
    return content.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
