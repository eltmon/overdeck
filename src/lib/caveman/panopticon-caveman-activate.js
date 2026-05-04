#!/usr/bin/env node
// Panopticon wrapper around caveman-activate.js
//
// Runs caveman-activate.js to inject the standard caveman rules, then appends
// Panopticon-specific overrides that take precedence over the default caveman rules.
// These overrides are non-negotiable: crash recovery and specialist feedback depend on them.
//
// Install location: ~/.panopticon/hooks/caveman/panopticon-caveman-activate.js
// Referenced from workspace .claude/settings.json SessionStart hook.

const { execSync } = require('child_process');
const { join } = require('path');

const activateScript = join(__dirname, 'caveman-activate.js');

// Run upstream caveman-activate.js and capture output.
// If mode is 'off', it exits early with 'OK' — we pass that through unchanged.
let baseOutput = '';
try {
  baseOutput = execSync(`node "${activateScript}"`, {
    encoding: 'utf8',
    env: process.env,
  });
} catch (err) {
  // If caveman-activate exits non-zero, pass its stdout through anyway.
  baseOutput = (err.stdout || '') + (err.stderr || '');
}

// If caveman is off, just pass through the base output.
if (baseOutput.trim() === 'OK') {
  process.stdout.write(baseOutput);
  process.exit(0);
}

// Append Panopticon-specific override block.
// These rules are injected after the caveman rules so they win on any conflict.
const panopticonOverrides = `

## Panopticon Overrides (non-negotiable)

continue.vbrief.json updates: ALWAYS use full prose for narrative fields (decisions[].rationale, hazards[].mitigation, approach, sessionHistory[].note). Crash recovery and specialist context depend on complete information in these fields.

.planning/feedback/ files: ALWAYS write at full prose. The work agent that reads this file needs complete context to understand what to fix.

Code, commits, tool arguments: always normal (already in your rules — reinforced here).`;

process.stdout.write(baseOutput + panopticonOverrides);
