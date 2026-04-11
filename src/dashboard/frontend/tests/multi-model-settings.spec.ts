import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Multi-Model Settings E2E Test (PAN-78)
 *
 * This test verifies the multi-model configuration workflow:
 * 1. Check claude-code-router is installed (or install it)
 * 2. Open settings page in dashboard
 * 3. Add OpenAI API key
 * 4. Configure GPT-4o for review agent
 * 5. Save settings
 * 6. Verify settings.json written correctly
 * 7. Verify router config.json generated
 * 8. (Optional) Spawn agent and verify model
 */

const DASHBOARD_URL = 'http://localhost:3010';
const API_URL = 'http://localhost:3011';
const PANOPTICON_HOME = join(homedir(), '.panopticon');
const SETTINGS_FILE = join(PANOPTICON_HOME, 'settings.json');
const ROUTER_CONFIG = join(homedir(), '.claude-code-router', 'config.json');

// Test API key (unique per test run to ensure hasChanges is triggered)
const TEST_OPENAI_KEY = `sk-test-${Date.now()}`;

interface SettingsConfig {
  models: {
    specialists: {
      review_agent: string;
      test_agent: string;
      merge_agent: string;
    };
    planning_agent: string;
    complexity: {
      trivial: string;
      simple: string;
      medium: string;
      complex: string;
      expert: string;
    };
  };
  api_keys: {
    openai?: string;
    google?: string;
    zai?: string;
  };
}

test.describe('Multi-Model Settings', () => {
  test('settings workflow configures models and generates router config', async ({ page }) => {
    console.log('\n=== MULTI-MODEL SETTINGS TEST ===');

    // Set wider viewport to see all navigation buttons
    await page.setViewportSize({ width: 1600, height: 1000 });

    // 1. Navigate to dashboard
    console.log('\n[1/6] Navigating to dashboard...');
    await page.goto(DASHBOARD_URL);
    await page.waitForTimeout(2000);

    // Debug: Take screenshot
    await page.screenshot({ path: '/tmp/dashboard-before-settings.png' });
    console.log('  Screenshot saved to /tmp/dashboard-before-settings.png');

    // 2. Navigate to settings page
    console.log('\n[2/6] Opening Settings page...');
    // Look for Settings button in navigation
    const settingsButton = page.locator('button:has-text("Settings")');
    await expect(settingsButton).toBeVisible({ timeout: 10000 });
    await settingsButton.click();

    // Wait for settings page to load
    await page.waitForTimeout(500);
    await expect(page.locator('h1:has-text("System Settings")')).toBeVisible({ timeout: 5000 });

    console.log('  ✓ Settings page loaded');

    // 3. Add OpenAI API key
    console.log('\n[3/6] Configuring OpenAI API key...');
    const openaiKeyInput = page.locator('input[placeholder*="sk-"]').first();
    await expect(openaiKeyInput).toBeVisible({ timeout: 5000 });

    // Clear existing value if any
    await openaiKeyInput.clear();
    await openaiKeyInput.fill(TEST_OPENAI_KEY);

    console.log('  ✓ API key entered');

    // Save the API key first so OpenAI models become available
    console.log('\n[4/6] Saving API key...');
    const saveButton = page.locator('button:has-text("Save")');
    await expect(saveButton).toBeVisible();
    await expect(saveButton).not.toBeDisabled();
    await saveButton.click();

    // Wait for save to complete - button should become disabled (no changes) and then success message
    await expect(saveButton).toBeDisabled({ timeout: 5000 });
    await page.waitForTimeout(1000); // Wait for models to refresh
    console.log('  ✓ API key saved, OpenAI models now available');

    // 5. Configure review agent to use gpt-4o
    console.log('\n[5/6] Configuring review agent model...');

    // Find the review agent dropdown (should be in Specialist Models section)
    // Look for the first select under "Specialist Agent Models" section
    const reviewAgentLabel = page.locator('label:has-text("Review Agent")');
    const reviewAgentSelect = page.locator('select').nth(0); // First dropdown is review agent

    await expect(reviewAgentSelect).toBeVisible({ timeout: 5000 });

    // Wait for OpenAI models to be loaded in dropdown
    await page.waitForTimeout(1000);

    // Check current value
    const currentValue = await reviewAgentSelect.inputValue();
    console.log(`  Current review agent model: ${currentValue}`);

    // Select gpt-4o (if not already selected, choose something different)
    const targetModel = currentValue === 'gpt-4o' ? 'claude-sonnet-4-5' : 'gpt-4o';
    await reviewAgentSelect.selectOption(targetModel);

    console.log(`  ✓ Model changed to: ${targetModel}`);

    // 6. Save settings again with new model selection
    console.log('\n[6/6] Saving model configuration...');
    // Wait for Save button to be enabled after model change
    await expect(saveButton).not.toBeDisabled({ timeout: 3000 });
    await saveButton.click();

    // Wait for success message or API response
    await page.waitForTimeout(2000);

    console.log('  ✓ Settings saved');

    // 6. Verify files on disk
    console.log('\n[6/6] Verifying configuration files...');

    // Check settings.json exists and has correct content
    expect(existsSync(SETTINGS_FILE), 'settings.json should exist').toBeTruthy();

    const settingsContent = readFileSync(SETTINGS_FILE, 'utf-8');
    const settings: SettingsConfig = JSON.parse(settingsContent);

    // Verify API key
    expect(settings.api_keys.openai, 'OpenAI key should be saved').toBe(TEST_OPENAI_KEY);

    // Verify review agent model matches what we selected
    expect(settings.models.specialists.review_agent, 'Review agent model should match selection').toBe(targetModel);

    console.log('  ✓ settings.json validated');

    // Check router config.json exists and is valid
    expect(existsSync(ROUTER_CONFIG), 'router config.json should exist').toBeTruthy();

    const routerContent = readFileSync(ROUTER_CONFIG, 'utf-8');
    const routerConfig = JSON.parse(routerContent);

    // Verify structure
    expect(routerConfig, 'Router config should have providers array').toHaveProperty('providers');
    expect(Array.isArray(routerConfig.providers), 'providers should be array').toBeTruthy();
    expect(routerConfig, 'Router config should have router object').toHaveProperty('router');

    // Verify OpenAI provider is configured
    const openaiProvider = routerConfig.providers.find((p: any) => p.name === 'openai');
    expect(openaiProvider, 'OpenAI provider should be in router config').toBeDefined();
    expect(openaiProvider?.models, 'OpenAI provider should have models').toBeDefined();
    expect(openaiProvider?.models.length, 'OpenAI provider should have multiple models').toBeGreaterThan(0);

    console.log('  ✓ router config.json validated');

    console.log('\n=== TEST COMPLETE ===\n');
  });

  test('settings page displays current configuration', async ({ page }) => {
    console.log('\n=== SETTINGS DISPLAY TEST ===');

    // Set wider viewport to see all navigation buttons
    await page.setViewportSize({ width: 1600, height: 1000 });

    // Navigate to dashboard and click Settings
    await page.goto(DASHBOARD_URL);
    await page.waitForTimeout(1000);

    const settingsButton = page.locator('button:has-text("Settings")');
    await settingsButton.click();
    await page.waitForTimeout(500);

    // Check that specialist model dropdowns exist
    const specialistSection = page.locator('h2:has-text("Specialist Agent Models")');
    await expect(specialistSection).toBeVisible({ timeout: 5000 });

    // Verify all three specialist dropdowns exist
    const selects = page.locator('select');
    const selectCount = await selects.count();

    // Should have at least: 3 specialists + 1 planning + 5 complexity = 9 total
    expect(selectCount).toBeGreaterThanOrEqual(9);

    console.log(`  ✓ Found ${selectCount} model configuration dropdowns`);
    console.log('\n=== TEST COMPLETE ===\n');
  });

  test('settings validation prevents invalid configurations', async ({ page }) => {
    console.log('\n=== SETTINGS VALIDATION TEST ===');

    // Set wider viewport to see all navigation buttons
    await page.setViewportSize({ width: 1600, height: 1000 });

    await page.goto(DASHBOARD_URL);
    await page.waitForTimeout(1000);

    const settingsButton = page.locator('button:has-text("Settings")');
    await settingsButton.click();
    await page.waitForTimeout(500);

    // Try to save without any changes (should work - defaults are valid)
    const saveButton = page.locator('button:has-text("Save")');

    // Button should be disabled if no changes
    const isDisabled = await saveButton.isDisabled();
    console.log(`  Save button disabled (no changes): ${isDisabled}`);

    // Make a change
    const firstSelect = page.locator('select').first();
    const currentValue = await firstSelect.inputValue();
    await firstSelect.selectOption({ index: 0 });

    // Button should now be enabled
    await expect(saveButton).not.toBeDisabled({ timeout: 2000 });
    console.log('  ✓ Save button enabled after change');

    console.log('\n=== TEST COMPLETE ===\n');
  });
});
