import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import ts from 'typescript';

/**
 * Conversation Ordering UAT (PAN-699)
 *
 * Verifies that the dashboard's deriveTimelineEntries sorts messages and tool
 * calls in strict terminal order, even when the underlying data is mis-ordered
 * or has identical timestamps.
 *
 * Injects the actual deriveTimelineEntries source (transpiled to JS via the
 * TypeScript compiler) into the browser so the test exercises the real
 * dashboard code, not an inline copy.
 */

/** Read deriveTimelineEntries source and transpile to JS for browser eval. */
function getDeriveTimelineEntriesSource(): string {
  const path = new URL(
    '../src/components/chat/session-logic.ts',
    import.meta.url,
  ).pathname;
  const source = readFileSync(path, 'utf-8');

  // Extract just the deriveTimelineEntries function body
  const match = source.match(
    /export function deriveTimelineEntries\([\s\S]*?^\}/m,
  );
  if (!match) throw new Error('Could not find deriveTimelineEntries in source');

  const result = ts.transpileModule(match[0], {
    compilerOptions: {
      module: ts.ModuleKind.ES2015,
      target: ts.ScriptTarget.ES2018,
    },
  });

  return result.outputText.replace('export function deriveTimelineEntries', 'function deriveTimelineEntries');
}

test.describe('Conversation View Ordering', () => {
  test('deriveTimelineEntries sorts mis-ordered messages by (createdAt, sequence)', async ({ page }) => {
    await page.goto('about:blank');
    await page.waitForTimeout(100);

    const result = await page.evaluate((fnSource) => {
      eval(fnSource);

      const messages = [
        { id: 'msg-2', kind: 'message', createdAt: '2024-01-15T09:23:11.000Z', sequence: 2, text: 'msg-2' },
        { id: 'msg-1', kind: 'message', createdAt: '2024-01-15T09:23:10.000Z', sequence: 0, text: 'msg-1' },
        { id: 'msg-3', kind: 'message', createdAt: '2024-01-15T09:23:12.000Z', sequence: 4, text: 'msg-3' },
      ];

      const workLog = [
        { id: 'tool-1', kind: 'work', createdAt: '2024-01-15T09:23:11.000Z', sequence: 1, tool: 'Bash', detail: 'ls' },
        { id: 'tool-2', kind: 'work', createdAt: '2024-01-15T09:23:12.000Z', sequence: 3, tool: 'Read', detail: 'file' },
      ];

      // @ts-ignore — injected by eval above
      const entries = deriveTimelineEntries(messages, workLog);
      return entries.map((e: any) => ({ id: e.id, kind: e.kind }));
    }, getDeriveTimelineEntriesSource());

    expect(result).toEqual([
      { id: 'msg-1', kind: 'message' },
      { id: 'tool-1', kind: 'work' },
      { id: 'msg-2', kind: 'message' },
      { id: 'tool-2', kind: 'work' },
      { id: 'msg-3', kind: 'message' },
    ]);
  });

  test('deriveTimelineEntries uses sequence as tiebreaker for identical timestamps', async ({ page }) => {
    await page.goto('about:blank');
    await page.waitForTimeout(100);

    const result = await page.evaluate((fnSource) => {
      eval(fnSource);

      const messages = [
        { id: 'm-c', kind: 'message', createdAt: '2024-01-15T09:00:00.000Z', sequence: 2, text: 'c' },
        { id: 'm-a', kind: 'message', createdAt: '2024-01-15T09:00:00.000Z', sequence: 0, text: 'a' },
        { id: 'm-b', kind: 'message', createdAt: '2024-01-15T09:00:00.000Z', sequence: 1, text: 'b' },
      ];

      // @ts-ignore
      const entries = deriveTimelineEntries(messages, []);
      return entries.map((e: any) => e.id);
    }, getDeriveTimelineEntriesSource());

    expect(result).toEqual(['m-a', 'm-b', 'm-c']);
  });
});
