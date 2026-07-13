import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { ISSUE_VIEW_INVENTORY } from '../../../../src/dashboard/frontend/src/components/issue-view/inventory';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tests/unit/dashboard/frontend/ → repo root (four directories up).
const REPO_ROOT = path.resolve(__dirname, '../../../..');

/**
 * FR-0 surface-lock (PAN-2499): the complete no-loss checklist from
 * docs/design/mockups/three-issue-views-naming.html — every section the three
 * issue views render today, read straight from that mockup's "Complete
 * component inventory" (Console 14 + Cockpit 16 + Rail 13), PLUS
 * ReviewPolicyControl (PAN-1874).
 *
 * These names are hardcoded INDEPENDENTLY of inventory.ts on purpose: the whole
 * point of the gate is that removing a manifest entry — silently dropping a
 * surface on the eve of the Issue View unification — turns the build red. If
 * the mockup grows a section, add it here AND in the manifest in the same
 * change; the two lists must agree.
 */
const EXPECTED_CONSOLE_SECTIONS = [
  'DrawerActionBar',
  'PhaseTimeline',
  'DrawerTabs',
  'DrawerPickupSection / PickupGateControls',
  'DrawerWorkspaceSection',
  'DrawerActiveAgent',
  'DrawerPausedBanner',
  'DrawerVerificationGates',
  'DrawerReviewSpecialists',
  'DrawerBeadsList',
  'DrawerPlanPanel / VBriefViewer',
  'DrawerArtifactsPanel',
  'DrawerActivityRail / DrawerActivityPanel',
  'DrawerAgentSession',
] as const;

const EXPECTED_COCKPIT_SECTIONS = [
  'Header bar',
  'StatusNarrative',
  'Pipeline Band',
  'AgentsLane',
  'StackDrawer',
  'Detail Tabs',
  'CrewStage',
  'HappenedFeed',
  'PlanMapCard',
  'IssueBlockerSpotlight',
  'Code tab',
  'PRD / Timeline / Discussion tabs',
  'Costs / Artifacts / Ship tabs',
  'Conversation / Files / Terminal tabs',
  'BeadsRail / BeadsTab',
  'Awareness rail',
] as const;

const EXPECTED_RAIL_SECTIONS = [
  'Filter bar',
  'Feature (issue) row',
  'Badges',
  'MergeButton',
  'Pipeline pips',
  'ResourceStrip',
  'SessionNode',
  'SessionNode context menu',
  'ReviewGroup',
  'ShipDoorTreeRow',
  'StackDrawer / UatStackTreeGroup',
  'ResourcesGroup',
  'ModelResolutionCard',
] as const;

const EXPECTED_SECTIONS = [
  ...EXPECTED_CONSOLE_SECTIONS,
  ...EXPECTED_COCKPIT_SECTIONS,
  ...EXPECTED_RAIL_SECTIONS,
  'ReviewPolicyControl', // PAN-1874 — the +1 surface added to the checklist
] as const;

describe('issue-view no-loss inventory (FR-0 surface-lock, PAN-2499)', () => {
  it('contains every section from the mockup no-loss checklist', () => {
    const present = new Set(ISSUE_VIEW_INVENTORY.map((entry) => entry.section));
    const missing = EXPECTED_SECTIONS.filter((name) => !present.has(name));
    expect(
      missing,
      `section(s) missing from ISSUE_VIEW_INVENTORY (surface lost): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('matches the mockup per-view counts: Console 14, Cockpit 16 + ReviewPolicyControl, Rail 13', () => {
    const byView = (view: string) => ISSUE_VIEW_INVENTORY.filter((entry) => entry.view === view).length;
    expect(byView('console')).toBe(EXPECTED_CONSOLE_SECTIONS.length); // 14
    expect(byView('cockpit')).toBe(EXPECTED_COCKPIT_SECTIONS.length + 1); // 16 mockup + ReviewPolicyControl
    expect(byView('rail')).toBe(EXPECTED_RAIL_SECTIONS.length); // 13
    expect(ISSUE_VIEW_INVENTORY.length).toBe(EXPECTED_SECTIONS.length); // 44
  });

  it('has no duplicate section names', () => {
    const names = ISSUE_VIEW_INVENTORY.map((entry) => entry.section);
    expect(new Set(names).size, `duplicate sections: ${names.join(', ')}`).toBe(names.length);
  });

  it('every manifest home path exists on disk (deleting a home without re-homing turns the build red)', () => {
    const missing = ISSUE_VIEW_INVENTORY
      .filter((entry) => !existsSync(path.resolve(REPO_ROOT, entry.home)))
      .map((entry) => `${entry.section} → ${entry.home}`);
    expect(
      missing,
      `home path(s) that do not exist on disk (re-home the section before removing its component): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('every home path is repo-relative and points inside the frontend components tree', () => {
    const outOfTree = ISSUE_VIEW_INVENTORY
      .filter((entry) => !entry.home.startsWith('src/dashboard/frontend/src/components/'))
      .map((entry) => `${entry.section} → ${entry.home}`);
    expect(outOfTree, `home path(s) outside the frontend components tree: ${outOfTree.join(', ')}`).toEqual([]);
  });
});
