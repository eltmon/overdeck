import { ISSUE_VIEW_INVENTORY, type IssueViewDensity } from './inventory';

export const DENSITY_SECTIONS: Readonly<Record<IssueViewDensity, readonly string[]>> = {
  rail: ISSUE_VIEW_INVENTORY.filter((entry) => entry.view === 'rail').map((entry) => entry.section),
  cockpit: ISSUE_VIEW_INVENTORY.filter((entry) => entry.view === 'cockpit').map((entry) => entry.section),
  console: [
    ...ISSUE_VIEW_INVENTORY.filter((entry) => entry.view === 'console').map((entry) => entry.section),
    'ReviewPolicyControl',
  ],
};

export function sectionsForDensity(density: IssueViewDensity): readonly string[] {
  return DENSITY_SECTIONS[density];
}
