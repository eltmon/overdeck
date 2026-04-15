/**
 * Tests for synthesis core module (PAN-709, bead ncg)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runSynthesis } from '../synthesis.js';

// ============================================================================
// Fixtures
// ============================================================================

const RETRO_NOOP = `---
issue: PAN-001
agent: retro-agent
run: event
cycle_count: 0
friction_score: 1
surprise: false
proposed_changes:
  - type: no_op | reason: Routine merge, no surprises
---

# Retro: PAN-001

Routine merge, no surprises: straightforward feature addition.
`;

const makeRetroSurprise = (
  issueId: string,
  frictionScore: number,
  skillName: string,
  audience: string,
  purpose: string,
) => `---
issue: ${issueId}
agent: retro-agent
run: event
cycle_count: 0
friction_score: ${frictionScore}
surprise: true
proposed_changes:
  - type: add_skill | name: ${skillName} | audience: ${audience} | purpose: ${purpose}
---

# Retro: ${issueId}

## What surprised me
Missing skill for ${skillName}.

## Proposed changes
Add skill to cover ${purpose}.
`;

// ============================================================================
// Setup
// ============================================================================

let retrosDir: string;

beforeEach(async () => {
  retrosDir = join(tmpdir(), `synthesis-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fsPromises.mkdir(retrosDir, { recursive: true });
});

afterEach(async () => {
  await fsPromises.rm(retrosDir, { recursive: true, force: true });
});

async function writeRetro(filename: string, content: string): Promise<void> {
  await fsPromises.writeFile(join(retrosDir, filename), content, 'utf-8');
}

// ============================================================================
// Tests — per AC in bead ncg
// ============================================================================

describe('runSynthesis', () => {
  it('returns empty result for empty retros dir', async () => {
    const result = await runSynthesis(retrosDir);
    expect(result.proposals).toHaveLength(0);
    expect(result.watchlist).toHaveLength(0);
    expect(result.processedRetros).toHaveLength(0);
    expect(result.filterRatio).toBe(0);
  });

  it('1 surprise retro → watchlist only (below threshold)', async () => {
    await writeRetro('pan-001-1000.md', makeRetroSurprise('PAN-001', 5, 'pan-foo', 'operator', 'help with foo'));
    const result = await runSynthesis(retrosDir);
    expect(result.proposals).toHaveLength(0);
    expect(result.watchlist).toHaveLength(1);
    expect(result.watchlist[0].retroCount).toBe(1);
    expect(result.watchlist[0].signature.targetSkill).toBe('pan-foo');
  });

  it('2 retros with same signature → still watchlist (below threshold)', async () => {
    await writeRetro('pan-001-1000.md', makeRetroSurprise('PAN-001', 4, 'pan-bar', 'operator', 'missing bar docs'));
    await writeRetro('pan-002-2000.md', makeRetroSurprise('PAN-002', 6, 'pan-bar', 'operator', 'missing bar docs'));
    const result = await runSynthesis(retrosDir);
    expect(result.proposals).toHaveLength(0);
    expect(result.watchlist).toHaveLength(1);
    expect(result.watchlist[0].retroCount).toBe(2);
    expect(result.watchlist[0].signature.targetSkill).toBe('pan-bar');
  });

  it('3 retros with same signature → promoted to proposal', async () => {
    await writeRetro('pan-001-1.md', makeRetroSurprise('PAN-001', 3, 'pan-baz', 'both', 'no baz skill'));
    await writeRetro('pan-002-2.md', makeRetroSurprise('PAN-002', 5, 'pan-baz', 'both', 'no baz skill'));
    await writeRetro('pan-003-3.md', makeRetroSurprise('PAN-003', 7, 'pan-baz', 'both', 'no baz skill'));
    const result = await runSynthesis(retrosDir);
    expect(result.proposals).toHaveLength(1);
    expect(result.watchlist).toHaveLength(0);
    const p = result.proposals[0];
    expect(p.retroCount).toBe(3);
    expect(p.signature.targetSkill).toBe('pan-baz');
    expect(p.medianFrictionScore).toBe(5);
  });

  it('3 retros with different signatures → 3 separate watchlist entries, no proposal', async () => {
    await writeRetro('pan-001-1.md', makeRetroSurprise('PAN-001', 5, 'pan-alpha', 'operator', 'alpha purpose'));
    await writeRetro('pan-002-2.md', makeRetroSurprise('PAN-002', 5, 'pan-beta', 'agent', 'beta purpose'));
    await writeRetro('pan-003-3.md', makeRetroSurprise('PAN-003', 5, 'pan-gamma', 'both', 'gamma purpose'));
    const result = await runSynthesis(retrosDir);
    expect(result.proposals).toHaveLength(0);
    expect(result.watchlist).toHaveLength(3);
  });

  it('no-op retros are not counted toward proposals or watchlist', async () => {
    // 2 surprise + 3 no-op = still only watchlist entry (below threshold)
    await writeRetro('pan-001-1.md', makeRetroSurprise('PAN-001', 5, 'pan-qux', 'operator', 'missing qux'));
    await writeRetro('pan-002-2.md', makeRetroSurprise('PAN-002', 7, 'pan-qux', 'operator', 'missing qux'));
    await writeRetro('pan-003-3.md', RETRO_NOOP);
    await writeRetro('pan-004-4.md', RETRO_NOOP.replace('PAN-001', 'PAN-004'));
    await writeRetro('pan-005-5.md', RETRO_NOOP.replace('PAN-001', 'PAN-005'));
    const result = await runSynthesis(retrosDir);
    expect(result.proposals).toHaveLength(0);
    expect(result.watchlist).toHaveLength(1);
    expect(result.processedRetros).toHaveLength(5);
    // filterRatio: 2 surprise out of 5 total
    expect(result.filterRatio).toBeCloseTo(2 / 5);
  });

  it('archive/ directory is excluded from processing', async () => {
    const archiveDir = join(retrosDir, 'archive');
    await fsPromises.mkdir(archiveDir, { recursive: true });
    // Put 3 matching retros in archive — should be ignored
    await fsPromises.writeFile(join(archiveDir, 'pan-001-1.md'), makeRetroSurprise('PAN-001', 5, 'pan-skip', 'agent', 'archived'));
    await fsPromises.writeFile(join(archiveDir, 'pan-002-2.md'), makeRetroSurprise('PAN-002', 5, 'pan-skip', 'agent', 'archived'));
    await fsPromises.writeFile(join(archiveDir, 'pan-003-3.md'), makeRetroSurprise('PAN-003', 5, 'pan-skip', 'agent', 'archived'));
    // One non-archived surprise with same signature
    await writeRetro('pan-004-4.md', makeRetroSurprise('PAN-004', 5, 'pan-skip', 'agent', 'archived'));
    const result = await runSynthesis(retrosDir);
    // Only 1 non-archived retro → watchlist, not proposal
    expect(result.proposals).toHaveLength(0);
    expect(result.watchlist).toHaveLength(1);
    expect(result.processedRetros).toHaveLength(1);
  });

  it('proposals are sorted by median friction score descending', async () => {
    // Group A: friction 2,2,2 → median 2
    await writeRetro('pa-1.md', makeRetroSurprise('PAN-A1', 2, 'pan-low', 'operator', 'low friction'));
    await writeRetro('pa-2.md', makeRetroSurprise('PAN-A2', 2, 'pan-low', 'operator', 'low friction'));
    await writeRetro('pa-3.md', makeRetroSurprise('PAN-A3', 2, 'pan-low', 'operator', 'low friction'));
    // Group B: friction 8,8,8 → median 8
    await writeRetro('pb-1.md', makeRetroSurprise('PAN-B1', 8, 'pan-high', 'operator', 'high friction'));
    await writeRetro('pb-2.md', makeRetroSurprise('PAN-B2', 8, 'pan-high', 'operator', 'high friction'));
    await writeRetro('pb-3.md', makeRetroSurprise('PAN-B3', 8, 'pan-high', 'operator', 'high friction'));
    const result = await runSynthesis(retrosDir);
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals[0].signature.targetSkill).toBe('pan-high');
    expect(result.proposals[1].signature.targetSkill).toBe('pan-low');
  });
});
