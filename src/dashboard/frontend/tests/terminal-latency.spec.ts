import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * Terminal Keystroke Latency Diagnostic Test
 *
 * This test diagnoses keystroke lag in the XTerminal component by:
 * 1. Creating a test tmux session with bash
 * 2. Connecting via the dashboard's XTerminal
 * 3. Typing characters and measuring roundtrip latency
 * 4. Testing different typing speeds and patterns
 */

const DASHBOARD_URL = 'http://localhost:3010';
const API_URL = 'http://localhost:3011';
const TEST_SESSION_NAME = 'test-terminal-latency';

test.describe('Terminal Keystroke Latency', () => {
  test.beforeAll(async () => {
    // Create a test tmux session with bash
    try {
      execSync(`tmux kill-session -t ${TEST_SESSION_NAME} 2>/dev/null || true`);
      execSync(`tmux new-session -d -s ${TEST_SESSION_NAME} -x 120 -y 30 bash`);
      console.log(`Created test session: ${TEST_SESSION_NAME}`);
    } catch (error) {
      console.error('Failed to create test session:', error);
    }
  });

  test.afterAll(async () => {
    // Clean up test session
    try {
      execSync(`tmux kill-session -t ${TEST_SESSION_NAME} 2>/dev/null || true`);
      console.log(`Cleaned up test session: ${TEST_SESSION_NAME}`);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('measure basic keystroke latency', async ({ page }) => {
    // Navigate to a page that will show our test terminal
    // We'll need to create a simple test page or use the API directly

    // First, let's test the WebSocket directly without the UI
    const wsLatencies: number[] = [];

    await page.goto(DASHBOARD_URL);

    // Wait for the page to load
    await page.waitForTimeout(1000);

    // Create a WebSocket connection directly in the browser
    const latencyResults = await page.evaluate(async (sessionName) => {
      return new Promise<{
        wsConnectTime: number;
        keystrokeLatencies: number[];
        errors: string[];
      }>((resolve) => {
        const results = {
          wsConnectTime: 0,
          keystrokeLatencies: [] as number[],
          errors: [] as string[],
        };

        const wsStart = performance.now();
        const ws = new WebSocket(`ws://localhost:3011/ws/terminal?session=${sessionName}`);

        let pendingKeystroke: { char: string; sentAt: number } | null = null;
        let testPhase = 'connecting';
        let charIndex = 0;
        const testChars = 'abcdefghij'; // 10 test characters

        ws.onopen = () => {
          results.wsConnectTime = performance.now() - wsStart;
          console.log(`WebSocket connected in ${results.wsConnectTime.toFixed(2)}ms`);
          testPhase = 'ready';

          // Wait a moment for bash prompt, then start sending characters
          setTimeout(() => {
            sendNextChar();
          }, 500);
        };

        ws.onmessage = (event) => {
          const data = event.data;

          // Check if this message contains our pending keystroke echo
          if (pendingKeystroke && data.includes(pendingKeystroke.char)) {
            const latency = performance.now() - pendingKeystroke.sentAt;
            results.keystrokeLatencies.push(latency);
            console.log(`Keystroke '${pendingKeystroke.char}' latency: ${latency.toFixed(2)}ms`);
            pendingKeystroke = null;

            // Send next character after a small delay
            setTimeout(() => {
              sendNextChar();
            }, 100);
          }
        };

        ws.onerror = (error) => {
          results.errors.push(`WebSocket error: ${error}`);
        };

        ws.onclose = (event) => {
          if (testPhase !== 'done') {
            results.errors.push(`WebSocket closed unexpectedly: ${event.code} ${event.reason}`);
          }
          resolve(results);
        };

        function sendNextChar() {
          if (charIndex >= testChars.length) {
            testPhase = 'done';
            ws.close();
            return;
          }

          const char = testChars[charIndex];
          charIndex++;

          pendingKeystroke = {
            char,
            sentAt: performance.now(),
          };

          ws.send(char);
        }

        // Timeout after 30 seconds
        setTimeout(() => {
          if (testPhase !== 'done') {
            results.errors.push('Test timed out');
            ws.close();
          }
        }, 30000);
      });
    }, TEST_SESSION_NAME);

    console.log('\n=== LATENCY TEST RESULTS ===');
    console.log(`WebSocket connect time: ${latencyResults.wsConnectTime.toFixed(2)}ms`);

    if (latencyResults.keystrokeLatencies.length > 0) {
      const avg = latencyResults.keystrokeLatencies.reduce((a, b) => a + b, 0) / latencyResults.keystrokeLatencies.length;
      const min = Math.min(...latencyResults.keystrokeLatencies);
      const max = Math.max(...latencyResults.keystrokeLatencies);
      const sorted = [...latencyResults.keystrokeLatencies].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];

      console.log(`Keystroke latencies (${latencyResults.keystrokeLatencies.length} samples):`);
      console.log(`  Min: ${min.toFixed(2)}ms`);
      console.log(`  Max: ${max.toFixed(2)}ms`);
      console.log(`  Avg: ${avg.toFixed(2)}ms`);
      console.log(`  P50: ${p50.toFixed(2)}ms`);
      console.log(`  P95: ${p95.toFixed(2)}ms`);
      console.log(`  All: ${latencyResults.keystrokeLatencies.map(l => l.toFixed(1)).join(', ')}ms`);
    }

    if (latencyResults.errors.length > 0) {
      console.log('Errors:', latencyResults.errors);
    }

    // Assertions
    expect(latencyResults.errors).toHaveLength(0);
    expect(latencyResults.keystrokeLatencies.length).toBeGreaterThan(0);
  });

  test('measure rapid typing latency', async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await page.waitForTimeout(1000);

    const latencyResults = await page.evaluate(async (sessionName) => {
      return new Promise<{
        wsConnectTime: number;
        batchLatency: number;
        charCount: number;
        errors: string[];
      }>((resolve) => {
        const results = {
          wsConnectTime: 0,
          batchLatency: 0,
          charCount: 0,
          errors: [] as string[],
        };

        const wsStart = performance.now();
        const ws = new WebSocket(`ws://localhost:3011/ws/terminal?session=${sessionName}`);

        const testString = 'echo "rapid typing test 1234567890"';
        let receivedOutput = '';
        let sendStart = 0;

        ws.onopen = () => {
          results.wsConnectTime = performance.now() - wsStart;

          // Wait for bash prompt
          setTimeout(() => {
            // Send all characters rapidly (simulating fast typing)
            sendStart = performance.now();
            for (const char of testString) {
              ws.send(char);
            }
            // Send Enter to execute
            ws.send('\r');
            results.charCount = testString.length;
          }, 500);
        };

        ws.onmessage = (event) => {
          receivedOutput += event.data;

          // Check if we see the echo output (indicates command completed)
          if (receivedOutput.includes('rapid typing test 1234567890') && sendStart > 0) {
            results.batchLatency = performance.now() - sendStart;
            ws.close();
          }
        };

        ws.onerror = (error) => {
          results.errors.push(`WebSocket error: ${error}`);
        };

        ws.onclose = () => {
          resolve(results);
        };

        // Timeout
        setTimeout(() => {
          results.errors.push('Test timed out');
          ws.close();
        }, 30000);
      });
    }, TEST_SESSION_NAME);

    console.log('\n=== RAPID TYPING TEST RESULTS ===');
    console.log(`WebSocket connect time: ${latencyResults.wsConnectTime.toFixed(2)}ms`);
    console.log(`Characters sent: ${latencyResults.charCount}`);
    console.log(`Total batch latency: ${latencyResults.batchLatency.toFixed(2)}ms`);
    console.log(`Per-character average: ${(latencyResults.batchLatency / latencyResults.charCount).toFixed(2)}ms`);

    if (latencyResults.errors.length > 0) {
      console.log('Errors:', latencyResults.errors);
    }

    expect(latencyResults.errors).toHaveLength(0);
  });

  test('measure special key latency (Enter, Tab, Arrow)', async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await page.waitForTimeout(1000);

    const latencyResults = await page.evaluate(async (sessionName) => {
      return new Promise<{
        enterLatency: number;
        tabLatency: number;
        errors: string[];
      }>((resolve) => {
        const results = {
          enterLatency: 0,
          tabLatency: 0,
          errors: [] as string[],
        };

        const ws = new WebSocket(`ws://localhost:3011/ws/terminal?session=${sessionName}`);
        let receivedOutput = '';
        let testPhase = 'connecting';
        let keyStart = 0;

        ws.onopen = () => {
          testPhase = 'testing_enter';

          setTimeout(() => {
            // Test Enter key - send "echo test" then Enter
            ws.send('echo enter_test');
            keyStart = performance.now();
            ws.send('\r');
          }, 500);
        };

        ws.onmessage = (event) => {
          receivedOutput += event.data;

          if (testPhase === 'testing_enter' && receivedOutput.includes('enter_test')) {
            results.enterLatency = performance.now() - keyStart;
            receivedOutput = '';
            testPhase = 'testing_tab';

            // Test Tab key (bash completion)
            setTimeout(() => {
              ws.send('ech'); // partial command
              keyStart = performance.now();
              ws.send('\t'); // Tab for completion
            }, 500);
          }

          if (testPhase === 'testing_tab' && receivedOutput.includes('echo')) {
            results.tabLatency = performance.now() - keyStart;
            testPhase = 'done';
            ws.close();
          }
        };

        ws.onerror = (error) => {
          results.errors.push(`WebSocket error: ${error}`);
        };

        ws.onclose = () => {
          resolve(results);
        };

        setTimeout(() => {
          if (testPhase !== 'done') {
            results.errors.push(`Test timed out in phase: ${testPhase}`);
            ws.close();
          }
        }, 30000);
      });
    }, TEST_SESSION_NAME);

    console.log('\n=== SPECIAL KEY TEST RESULTS ===');
    console.log(`Enter key latency: ${latencyResults.enterLatency.toFixed(2)}ms`);
    console.log(`Tab key latency: ${latencyResults.tabLatency.toFixed(2)}ms`);

    if (latencyResults.errors.length > 0) {
      console.log('Errors:', latencyResults.errors);
    }

    expect(latencyResults.errors).toHaveLength(0);
  });

  test('stress test - many keystrokes in succession', async ({ page }) => {
    await page.goto(DASHBOARD_URL);
    await page.waitForTimeout(1000);

    const latencyResults = await page.evaluate(async (sessionName) => {
      return new Promise<{
        totalKeystrokes: number;
        droppedKeystrokes: number;
        totalTime: number;
        errors: string[];
      }>((resolve) => {
        const results = {
          totalKeystrokes: 0,
          droppedKeystrokes: 0,
          totalTime: 0,
          errors: [] as string[],
        };

        const ws = new WebSocket(`ws://localhost:3011/ws/terminal?session=${sessionName}`);

        // Generate a long string with unique markers
        const testString = 'STARTMARKER' + 'x'.repeat(100) + 'ENDMARKER';
        let receivedOutput = '';
        let sendStart = 0;

        ws.onopen = () => {
          setTimeout(() => {
            // Clear line first
            ws.send('\x03'); // Ctrl+C

            setTimeout(() => {
              ws.send('echo "');
              sendStart = performance.now();

              // Send all characters as fast as possible
              for (const char of testString) {
                ws.send(char);
                results.totalKeystrokes++;
              }

              ws.send('"');
              ws.send('\r');
            }, 200);
          }, 500);
        };

        ws.onmessage = (event) => {
          receivedOutput += event.data;

          // Check if we received the complete output
          if (receivedOutput.includes('ENDMARKER') && sendStart > 0) {
            results.totalTime = performance.now() - sendStart;

            // Count how many 'x' characters made it through
            const match = receivedOutput.match(/STARTMARKER(x*)ENDMARKER/);
            if (match) {
              const receivedXCount = match[1].length;
              const expectedXCount = 100;
              results.droppedKeystrokes = expectedXCount - receivedXCount;
            }

            ws.close();
          }
        };

        ws.onerror = (error) => {
          results.errors.push(`WebSocket error: ${error}`);
        };

        ws.onclose = () => {
          resolve(results);
        };

        setTimeout(() => {
          results.errors.push('Test timed out');
          ws.close();
        }, 30000);
      });
    }, TEST_SESSION_NAME);

    console.log('\n=== STRESS TEST RESULTS ===');
    console.log(`Total keystrokes sent: ${latencyResults.totalKeystrokes}`);
    console.log(`Dropped keystrokes: ${latencyResults.droppedKeystrokes}`);
    console.log(`Total time: ${latencyResults.totalTime.toFixed(2)}ms`);
    console.log(`Throughput: ${(latencyResults.totalKeystrokes / (latencyResults.totalTime / 1000)).toFixed(2)} keys/sec`);

    if (latencyResults.errors.length > 0) {
      console.log('Errors:', latencyResults.errors);
    }

    // We should not drop any keystrokes
    expect(latencyResults.droppedKeystrokes).toBe(0);
    expect(latencyResults.errors).toHaveLength(0);
  });
});
