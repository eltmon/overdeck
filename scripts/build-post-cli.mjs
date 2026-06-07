#!/usr/bin/env node
import { spawn } from 'node:child_process';

// PAN-1659: build:docs-index is a heavy, repo-wide artifact (downloads the
// gte-small embedding model, ~250-550% CPU per run, and 429s under HF rate
// limiting). It indexes the docs — unrelated to whether an individual issue's
// code is correct — yet ran on every `npm run build`, including per-issue CI.
// Three concurrent per-issue builds once spiked the host to load 132/24 cores
// and caused false verification failures. It is OPT-OUT: still built by default
// (so publish/release via prepublishOnly + build-for-publish.mjs keep shipping a
// fresh index), but skippable via SKIP_DOCS_INDEX=1 in per-issue CI/verification.
const tasks = [
  'build:scripts',
  'build:dashboard:frontend',
  'build:dashboard:server:bundle',
];
if (process.env.SKIP_DOCS_INDEX !== '1') {
  tasks.unshift('build:docs-index');
} else {
  console.log('[build-post-cli] SKIP_DOCS_INDEX=1 — skipping build:docs-index (PAN-1659)');
}

const children = new Map();
let shuttingDown = false;

function runTask(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', script], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    children.set(script, child);

    child.on('error', (error) => {
      children.delete(script);
      reject(error);
    });

    child.on('exit', (code, signal) => {
      children.delete(script);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${script} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`));
    });
  });
}

function stopChildren() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children.values()) child.kill('SIGTERM');
}

process.on('SIGINT', () => {
  stopChildren();
  process.exit(130);
});
process.on('SIGTERM', () => {
  stopChildren();
  process.exit(143);
});

try {
  await Promise.all(tasks.map(runTask));
} catch (error) {
  stopChildren();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
