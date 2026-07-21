/**
 * Prompt invariant tests for load-bearing safety rails.
 *
 * The flywheel soul-degradation incident showed that prompt files are load-bearing
 * safety surfaces with zero mechanical protection. These tests pin the semantic
 * anchors of the rails that prevent autonomous agents from running untrusted issues,
 * neutering auto-pickup, or diverging from canonical review signaling.
 *
 * A deliberate prompt change must update this test in the same PR and include a
 * `Prompt-Change:` trailer in the commit message.
 *
 * Issue: PAN-2229
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function readPrompt(filename: string): string {
  return fs.readFileSync(path.join(repoRoot, filename), 'utf-8');
}

const flywheel = readPrompt('roles/flywheel.md');
const brief = readPrompt('docs/flywheel-brief.md');
const review = readPrompt('roles/review.md');

const RAIL_MESSAGE =
  'This anchor is a load-bearing safety rail (PAN-2229, flywheel soul-degradation incident). ' +
  'A deliberate prompt change must update this test in the same PR and include a Prompt-Change: trailer.';

describe('prompt invariants', () => {
  it('flywheel author/assignee gate lists both allowlisted identities and calls the gate security-critical', () => {
    // Capture the section that starts with the author/assignee gate header so we
    // can assert the allowlist, author.login reference, and security-critical label
    // coexist in the same load-bearing section.
    const sectionMatch = flywheel.match(/Author\/assignee gate[\s\S]{0,1200}/i);
    expect(
      sectionMatch,
      `Expected roles/flywheel.md to contain an "Author/assignee gate" section. ${RAIL_MESSAGE}`,
    ).not.toBeNull();

    const section = sectionMatch![0];
    expect(
      section,
      `Expected the author/assignee gate section to reference author.login. ${RAIL_MESSAGE}`,
    ).toMatch(/author\.login/i);
    expect(
      section,
      `Expected the author/assignee gate section to be labeled security-critical. ${RAIL_MESSAGE}`,
    ).toMatch(/security-critical/i);
    expect(
      section,
      `Expected the author/assignee gate section to allowlist "eltmon". ${RAIL_MESSAGE}`,
    ).toMatch(/eltmon/);
    expect(
      section,
      `Expected the author/assignee gate section to allowlist "panopticon-agent[bot]". ${RAIL_MESSAGE}`,
    ).toMatch(/panopticon-agent\[bot\]/);
  });

  it('flywheel treats vetoed as absolute', () => {
    expect(
      flywheel,
      `Expected roles/flywheel.md to contain the absolute veto rail. ${RAIL_MESSAGE}`,
    ).toMatch(/`vetoed` is absolute/);
  });

  it('flywheel saturation cap never spawns past maxAgents', () => {
    expect(
      flywheel,
      `Expected roles/flywheel.md to contain the saturation cap rail. ${RAIL_MESSAGE}`,
    ).toMatch(/Never spawn past `maxAgents`/);
  });

  it('brief documents auto_pickup_backlog default OFF with released and blanket release branches', () => {
    expect(
      brief,
      `Expected docs/flywheel-brief.md to document auto_pickup_backlog with default OFF. ${RAIL_MESSAGE}`,
    ).toMatch(/auto_pickup_backlog[\s\S]{0,200}default OFF/i);
    expect(
      brief,
      `Expected docs/flywheel-brief.md to document the OFF branch (operator individually released). ${RAIL_MESSAGE}`,
    ).toMatch(/OFF[\s\S]{0,400}released/i);
    expect(
      brief,
      `Expected docs/flywheel-brief.md to document the ON branch (blanket release). ${RAIL_MESSAGE}`,
    ).toMatch(/ON[\s\S]{0,400}blanket release/i);
  });

  it('brief documents require_uat_before_merge default ON', () => {
    expect(
      brief,
      `Expected docs/flywheel-brief.md to document require_uat_before_merge with default ON. ${RAIL_MESSAGE}`,
    ).toMatch(/require_uat_before_merge[\s\S]{0,200}default ON/i);
  });

  it('review synthesis uses the canonical verdict header template', () => {
    expect(
      review,
      `Expected roles/review.md to contain the canonical verdict header template. ${RAIL_MESSAGE}`,
    ).toMatch(/## Verdict: APPROVED \/ CHANGES REQUESTED/);
  });

  it('review blocked signal uses the canonical blocked command', () => {
    expect(
      review,
      `Expected roles/review.md to contain the canonical blocked signal command. ${RAIL_MESSAGE}`,
    ).toMatch(/pan admin specialists done review[\s\S]{0,200}--status blocked/);
  });
});
