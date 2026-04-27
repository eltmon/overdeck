import { test, expect } from '@playwright/test';

const DASHBOARD_URL = process.env.PANOPTICON_DASHBOARD_URL ?? 'https://pan.localhost';
const ISSUE_ID = 'PAN-866';

async function openIssueInCommandDeck(page: import('@playwright/test').Page, issueId: string) {
  await page.goto(`${DASHBOARD_URL}/command-deck`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('main', { timeout: 10000 });

  await page.getByRole('button', { name: /^Projects / }).click();

  await page.evaluate((targetIssueId) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const issueButton = buttons.find((button) => button.textContent?.includes(targetIssueId));
    if (!(issueButton instanceof HTMLButtonElement)) {
      throw new Error(`Issue button not found for ${targetIssueId}`);
    }
    issueButton.click();
  }, issueId);

  await expect(page.getByTestId('zone-c-overview')).toBeVisible({ timeout: 15000 });
}

test.describe('PAN-866 Zone C tab suite', () => {
  test('renders the issue-selected tab suite for a real issue', async ({ page }) => {
    await openIssueInCommandDeck(page, ISSUE_ID);

    const expectedTabs = [
      'overview',
      'activity',
      'costs',
      'prd',
      'state',
      'vbrief',
      'beads',
      'prdiff',
      'discussions',
    ];

    for (const tab of expectedTabs) {
      await page.getByTestId(`zone-c-overview-tab-${tab}`).click();
      await expect(page.getByTestId(`zone-c-overview-panel-${tab}`)).toBeVisible();
    }

    const inferenceTab = page.getByTestId('zone-c-overview-tab-inference');
    if (await inferenceTab.count()) {
      await inferenceTab.click();
      await expect(page.getByTestId('zone-c-overview-panel-inference')).toBeVisible();
    }
  });
});
