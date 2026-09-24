/**
 * PAN-3859 — no-loss audit for the dead-code deletions.
 *
 * Each `it(...)` is the deletion gate for one work item: it proves the deleted
 * state is now unreachable through the runtime module surface (dynamic import
 * rejections and export-presence assertions), per the additive-refactor
 * no-loss rule. Source-text assertions are deliberately avoided — the repo's
 * source-introspection lint forbids `readFileSync`-based source assertions in
 * tests.
 */
import { describe, expect, it } from 'vitest';

describe('PAN-3859 dead-code no-loss audit', () => {
  it('W1: the triage-agent module and the planning/index barrel are unimportable', async () => {
    // The rule-based triage surface (analyzeIssue/triageMultiple/sortByPriority)
    // had zero callers — the flywheel reads issue bodies directly and the
    // planner assigns per-item difficulty. planning/index.ts re-exported only
    // triage-agent and itself had zero importers.
    await expect(import('../../../../src/lib/planning/triage-agent.js')).rejects.toThrow();
    await expect(import('../../../../src/lib/planning/index.js')).rejects.toThrow();
  });

  it('W2: the /api/issues/:id/analyze helper is gone from issue-reads', async () => {
    // The route called analyzeIssue, an inline substring matcher that required
    // LinearClient and 404'd for every PAN issue (the tracker is GitHub). The
    // route registration itself stays locked by the PAN-2148 route-surface
    // audit (tests/unit/dashboard/routes/issues-no-loss.test.ts, now 34).
    const mod = await import('../../../../src/lib/overdeck/issue-reads.js');
    expect('analyzeIssue' in mod).toBe(false);
    expect(typeof mod.getIssueTasks).toBe('function');
    expect(typeof mod.getIssuePrd).toBe('function');
  });

  it('W3: the legacy ModelRouter module is unimportable', async () => {
    // ModelRouter/routeTask/getGlobalRouter/getSpecialistModel/getDefaultModel
    // had zero non-test callers; the parity-lock test the deletion was waiting
    // on existed only to guard the legacy mapping and was deleted with it.
    await expect(import('../../../../src/lib/cloister/router.js')).rejects.toThrow();
  });



  it('W5: settings.models.complexity is gone from defaults and validation', async () => {
    // The complexity model map fed only the deleted generateRouterConfig.
    // Types are erased at runtime, so assert on the resolved settings object:
    // defaults carry no complexity key. (Settings validation had no production
    // caller and was deleted in PAN-3958 CH-8.)
    const { getDefaultSettings } = await import('../../../../src/lib/settings.js');
    const defaults = getDefaultSettings();
    expect('complexity' in defaults.models).toBe(false);
  });
});
