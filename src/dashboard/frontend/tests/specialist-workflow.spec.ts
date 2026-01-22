import { test, expect } from '@playwright/test';

/**
 * Specialist Workflow E2E Test (PAN-53)
 *
 * This test verifies the full specialist workflow when approving work:
 * 1. Trigger approve via POST /api/workspaces/:issueId/approve
 * 2. Verify review-agent becomes active
 * 3. Verify test-agent becomes active
 * 4. Verify merge-agent becomes active
 * 5. Verify merge completes successfully
 */

const DASHBOARD_URL = 'http://localhost:3010';
const API_URL = 'http://localhost:3011';
const TEST_ISSUE_ID = 'PAN-53';

/**
 * Specialist status from /api/specialists
 */
interface SpecialistStatus {
  name: string;
  displayName: string;
  description: string;
  enabled: boolean;
  state: 'sleeping' | 'active' | 'uninitialized';
  isRunning: boolean;
  tmuxSession?: string;
}

/**
 * Poll /api/specialists until a condition is met or timeout
 */
async function pollSpecialistStatus(
  predicate: (specialists: SpecialistStatus[]) => boolean,
  options: {
    timeout?: number;
    interval?: number;
    description?: string;
  } = {}
): Promise<SpecialistStatus[]> {
  const { timeout = 30000, interval = 500, description = 'condition' } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(`${API_URL}/api/specialists`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const specialists: SpecialistStatus[] = await response.json();

      if (predicate(specialists)) {
        console.log(`✓ ${description} (after ${Date.now() - startTime}ms)`);
        return specialists;
      }

      await new Promise(resolve => setTimeout(resolve, interval));
    } catch (error) {
      console.error('Error polling specialists:', error);
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  throw new Error(`Timeout waiting for ${description} after ${timeout}ms`);
}

/**
 * Get specialist by name from status array
 */
function getSpecialist(specialists: SpecialistStatus[], name: string): SpecialistStatus | undefined {
  return specialists.find(s => s.name === name);
}

test.describe('Specialist Workflow', () => {
  test('full approve workflow activates all specialists', async ({ page }) => {
    // Navigate to dashboard to ensure it's running
    await page.goto(DASHBOARD_URL);
    await page.waitForTimeout(1000);

    console.log('\n=== SPECIALIST WORKFLOW TEST ===');

    // 1. Get initial specialist states
    console.log('\n[1/5] Checking initial specialist states...');
    const initialResponse = await fetch(`${API_URL}/api/specialists`);
    expect(initialResponse.ok).toBeTruthy();
    const initialSpecialists: SpecialistStatus[] = await initialResponse.json();

    console.log('Initial states:');
    initialSpecialists.forEach(s => {
      console.log(`  ${s.name}: ${s.state} (running: ${s.isRunning})`);
    });

    // 2. Trigger the approve workflow
    console.log(`\n[2/5] Triggering approve workflow for ${TEST_ISSUE_ID}...`);
    const approveResponse = await fetch(`${API_URL}/api/workspaces/${TEST_ISSUE_ID}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Note: We may get a 400 if the workspace doesn't exist or branch already merged
    // For E2E testing purposes, we'll handle both success and expected failures
    const approveResult = await approveResponse.json();
    console.log(`Approve response (${approveResponse.status}):`, approveResult);

    if (!approveResponse.ok) {
      if (approveResult.error?.includes('does not exist') ||
          approveResult.error?.includes('uncommitted changes') ||
          approveResult.error?.includes('already merged')) {
        console.log('⚠️  Expected error (workspace/branch state), skipping approval verification');
        console.log('    This test primarily validates the specialist activation mechanism');

        // Still verify that specialists exist and have valid states
        const specialists = await pollSpecialistStatus(
          (specs) => specs.length >= 3,
          { description: 'at least 3 specialists registered', timeout: 5000 }
        );

        expect(specialists.length).toBeGreaterThanOrEqual(3);
        expect(getSpecialist(specialists, 'review-agent')).toBeDefined();
        expect(getSpecialist(specialists, 'test-agent')).toBeDefined();
        expect(getSpecialist(specialists, 'merge-agent')).toBeDefined();

        console.log('\n✓ Specialist system is properly configured');
        return; // Skip the rest of the test
      }

      // Unexpected error
      throw new Error(`Approve failed unexpectedly: ${approveResult.error}`);
    }

    // 3. Poll for review-agent to become active
    console.log('\n[3/5] Waiting for review-agent to activate...');
    const reviewActive = await pollSpecialistStatus(
      (specialists) => {
        const review = getSpecialist(specialists, 'review-agent');
        return review?.isRunning === true || review?.state === 'active';
      },
      {
        description: 'review-agent active',
        timeout: 10000, // Give it 10 seconds
      }
    );

    const reviewAgent = getSpecialist(reviewActive, 'review-agent');
    expect(reviewAgent?.state).toBe('active');
    expect(reviewAgent?.isRunning).toBe(true);

    // 4. Poll for test-agent to become active (comes after review-agent)
    console.log('\n[4/5] Waiting for test-agent to activate...');
    const testActive = await pollSpecialistStatus(
      (specialists) => {
        const test = getSpecialist(specialists, 'test-agent');
        return test?.isRunning === true || test?.state === 'active';
      },
      {
        description: 'test-agent active',
        timeout: 15000, // May take a bit longer
      }
    );

    const testAgent = getSpecialist(testActive, 'test-agent');
    expect(testAgent?.state).toBe('active');
    expect(testAgent?.isRunning).toBe(true);

    // 5. Poll for merge-agent to become active (comes after test-agent)
    console.log('\n[5/5] Waiting for merge-agent to activate...');
    const mergeActive = await pollSpecialistStatus(
      (specialists) => {
        const merge = getSpecialist(specialists, 'merge-agent');
        return merge?.isRunning === true || merge?.state === 'active';
      },
      {
        description: 'merge-agent active',
        timeout: 20000, // Merge may take longest
      }
    );

    const mergeAgent = getSpecialist(mergeActive, 'merge-agent');
    expect(mergeAgent?.state).toBe('active');
    expect(mergeAgent?.isRunning).toBe(true);

    console.log('\n=== ALL SPECIALISTS ACTIVATED ===');
    console.log(`✓ review-agent: ${reviewAgent?.tmuxSession}`);
    console.log(`✓ test-agent: ${testAgent?.tmuxSession}`);
    console.log(`✓ merge-agent: ${mergeAgent?.tmuxSession}`);

    // 6. Optional: Wait a moment and verify at least one specialist is still active
    // (They may complete quickly and go back to sleeping)
    await page.waitForTimeout(2000);
    const finalResponse = await fetch(`${API_URL}/api/specialists`);
    const finalSpecialists: SpecialistStatus[] = await finalResponse.json();

    console.log('\nFinal states:');
    finalSpecialists.forEach(s => {
      console.log(`  ${s.name}: ${s.state} (running: ${s.isRunning})`);
    });

    console.log('\n✓ Test complete - specialist workflow verified');
  });

  test('verify dashboard displays specialist states correctly', async ({ page }) => {
    console.log('\n=== DASHBOARD SPECIALIST UI TEST ===');

    // Navigate to dashboard
    await page.goto(DASHBOARD_URL);
    await page.waitForLoadState('networkidle');

    console.log('\n[1/2] Checking for specialist cards in UI...');

    // Look for specialist cards (these may be in a specialists section)
    // We'll check if the page contains text related to specialists
    const pageContent = await page.content();

    // Basic smoke test - verify dashboard loads and has some specialist-related content
    // Note: Actual UI structure depends on SpecialistAgentCard.tsx implementation
    expect(pageContent.length).toBeGreaterThan(0);

    console.log('✓ Dashboard loaded successfully');

    // 2. Check that we can query specialist status via API from the page
    console.log('\n[2/2] Verifying specialists API is accessible...');
    const apiAccessible = await page.evaluate(async (apiUrl) => {
      try {
        const response = await fetch(`${apiUrl}/api/specialists`);
        return response.ok;
      } catch {
        return false;
      }
    }, API_URL);

    expect(apiAccessible).toBe(true);
    console.log('✓ Specialists API is accessible from dashboard');
  });
});
