#!/usr/bin/env node
import { spawn } from 'node:child_process';

const tasks = [
  'build:docs-index',
  'build:scripts',
  'build:dashboard:frontend',
  'build:dashboard:server:bundle',
];

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
