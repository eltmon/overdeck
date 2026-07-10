import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * PAN-2229 — deterministic prompt-invariant suite.
 *
 * `roles/flywheel.md`, `docs/flywheel-brief.md`, and `roles/review.md` are
 * load-bearing safety surfaces. The soul-degradation incident (27–44
 * well-intentioned commits stripped rail text from roles/flywheel.md and
 * docs/flywheel-brief.md without any test catching the regression) is the
 * reason this file exists: it pins the load-bearing rails so a deliberate
 * prompt change cannot land without an explicit, visible failure here.
 *
 * Each assertion below is its own `it()` so a regression points at the
 * exact rail that broke. If you intentionally change a rail, update this
 * test in the same PR and add a `Prompt-Change:` trailer — never land a
 * silent change to a prompt surface.
 *
 * Pure-sync file reads. No timers, no network, no model calls. Safe for
 * the default `npm test` path.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FLYWHEEL_ROLE = resolve(REPO_ROOT, 'roles/flywheel.md');
const FLYWHEEL_BRIEF = resolve(REPO_ROOT, 'docs/flywheel-brief.md');
const REVIEW_ROLE = resolve(REPO_ROOT, 'roles/review.md');

const flywheelRole = readFileSync(FLYWHEEL_ROLE, 'utf8');
const flywheelBrief = readFileSync(FLYWHEEL_BRIEF, 'utf8');
const reviewRole = readFileSync(REVIEW_ROLE, 'utf8');

/** Strip code-fence backticks so a regex doesn't fight against literal `code`. */
function flatten(content: string): string {
  return content.replace(/`/g, '');
}

function loadFailureMessage(rail: string): string {
  return (
    `Load-bearing prompt rail missing or reworded: ${rail}. ` +
    'This is a PAN-2229 protection rail — see PAN-2229 and the soul-degradation ' +
    'incident. A deliberate prompt change must update this test in the same PR ' +
    'and add a Prompt-Change: trailer; never land a silent change to a prompt ' +
    'surface.'
  );
}

describe('roles/flywheel.md — author/assignee allowlist', () => {
  it('names BOTH allowlisted identities (eltmon, panopticon-agent[bot]) within the same section as author.login and calls the gate security-critical', () => {
    // Locate the allowlist paragraph by its anchor ("security-critical").
    const sectionMatch = flywheelRole.match(
      /author\.login[\s\S]{0,400}?(eltmon|panopticon-agent\[bot\])[\s\S]{0,400}?(eltmon|panopticon-agent\[bot\])[\s\S]{0,400}/,
    );
    expect(sectionMatch, loadFailureMessage('author/assignee allowlist (security-critical)')).not.toBeNull();

    const flat = flatten(flywheelRole);
    expect(
      flat.includes('security-critical'),
      loadFailureMessage('author/assignee gate is not labeled security-critical'),
    ).toBe(true);
  });
});

describe('roles/flywheel.md — vetoed rail', () => {
  it('contains the verbatim clause "`vetoed` is absolute"', () => {
    expect(
      flywheelRole.includes('`vetoed` is absolute'),
      loadFailureMessage('`vetoed` is absolute'),
    ).toBe(true);
  });
});

describe('roles/flywheel.md — saturation cap', () => {
  it('contains the verbatim clause "Never spawn past `maxAgents`"', () => {
    expect(
      flywheelRole.includes('Never spawn past `maxAgents`'),
      loadFailureMessage('Never spawn past `maxAgents`'),
    ).toBe(true);
  });
});

describe('docs/flywheel-brief.md — auto_pickup_backlog rail', () => {
  it('documents auto_pickup_backlog as default OFF and renders both OFF (operator individually released) and ON (blanket release) branches', () => {
    const flat = flatten(flywheelBrief);
    expect(
      flat.includes('auto_pickup_backlog (default OFF)'),
      loadFailureMessage('auto_pickup_backlog default OFF'),
    ).toBe(true);
    expect(
      /OFF[\s\S]{0,400}individually[\s\S]{0,200}released/i.test(flywheelBrief),
      loadFailureMessage('auto_pickup_backlog OFF branch (operator individually released)'),
    ).toBe(true);
    expect(
      /ON[\s\S]{0,400}blanket[\s\S]{0,200}release/i.test(flywheelBrief),
      loadFailureMessage('auto_pickup_backlog ON branch (blanket release)'),
    ).toBe(true);
  });
});

describe('docs/flywheel-brief.md — require_uat_before_merge rail', () => {
  it('documents require_uat_before_merge as default ON', () => {
    expect(
      flywheelBrief.includes('require_uat_before_merge') &&
        /require_uat_before_merge[\s\S]{0,80}\(default ON\)/.test(flywheelBrief),
      loadFailureMessage('require_uat_before_merge default ON'),
    ).toBe(true);
  });
});

describe('roles/review.md — verdict header template', () => {
  it('contains the canonical verdict header "## Verdict: APPROVED / CHANGES REQUESTED"', () => {
    expect(
      reviewRole.includes('## Verdict: APPROVED / CHANGES REQUESTED'),
      loadFailureMessage('review verdict header template'),
    ).toBe(true);
  });
});

describe('roles/review.md — blocked signal command', () => {
  it('contains the blocked signal command "pan admin specialists done review <issueId> --status blocked"', () => {
    const cmd = 'pan admin specialists done review <issueId> --status blocked';
    expect(
      reviewRole.includes(cmd),
      loadFailureMessage('review blocked signal command'),
    ).toBe(true);
  });
});