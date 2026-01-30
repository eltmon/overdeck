#!/usr/bin/env node
/**
 * Debug script to automate PAN-34 review via Playwright
 */

import { chromium } from 'playwright';

async function debugReview() {
  console.log('🎭 Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 }
  });
  const page = await context.newPage();

  try {
    // Navigate to dashboard
    console.log('📱 Navigating to dashboard...');
    await page.goto('http://localhost:3010', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Take screenshot of initial state
    await page.screenshot({ path: '/tmp/dashboard-initial.png' });
    console.log('📸 Screenshot saved: /tmp/dashboard-initial.png');

    // Look for PAN-34 card
    console.log('🔍 Looking for PAN-34...');
    const pan34Card = await page.locator('text=PAN-34').first();
    const isVisible = await pan34Card.isVisible().catch(() => false);

    if (!isVisible) {
      console.log('❌ PAN-34 not found on page');
      // Check what issues are visible
      const issues = await page.locator('[data-issue-id], .issue-card, [class*="issue"]').allTextContents();
      console.log('Visible issues:', issues.slice(0, 10));
      await page.screenshot({ path: '/tmp/dashboard-no-pan34.png' });
      return;
    }

    console.log('✅ Found PAN-34');

    // Click on PAN-34 to open detail panel
    await pan34Card.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/tmp/dashboard-pan34-clicked.png' });
    console.log('📸 Screenshot saved: /tmp/dashboard-pan34-clicked.png');

    // Look for Review button
    console.log('🔍 Looking for Review button...');
    const reviewButton = await page.locator('button:has-text("Review"), [data-testid="review-button"], .review-button').first();
    const reviewVisible = await reviewButton.isVisible().catch(() => false);

    if (!reviewVisible) {
      console.log('❌ Review button not found');
      // List all buttons on page
      const buttons = await page.locator('button').allTextContents();
      console.log('Available buttons:', buttons);
      await page.screenshot({ path: '/tmp/dashboard-no-review-btn.png' });
      return;
    }

    console.log('✅ Found Review button');

    // Click Review button
    console.log('🖱️ Clicking Review button...');
    await reviewButton.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/dashboard-after-review-click.png' });
    console.log('📸 Screenshot saved: /tmp/dashboard-after-review-click.png');

    // Check for error messages
    const errorMessage = await page.locator('.error, [role="alert"], .toast, .notification').first();
    const errorText = await errorMessage.textContent().catch(() => null);
    if (errorText) {
      console.log('⚠️ Error message found:', errorText);
    }

    // Wait and check specialist status
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/dashboard-final.png' });
    console.log('📸 Final screenshot saved: /tmp/dashboard-final.png');

    console.log('✅ Debug session complete');

  } catch (error) {
    console.error('❌ Error:', error.message);
    await page.screenshot({ path: '/tmp/dashboard-error.png' });
    console.log('📸 Error screenshot saved: /tmp/dashboard-error.png');
  } finally {
    await browser.close();
  }
}

debugReview().catch(console.error);
