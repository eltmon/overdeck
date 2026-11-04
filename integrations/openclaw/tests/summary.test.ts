import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverdeckMcpError, type McpCallResult, type McpClient } from '../src/mcp-client.js';
import type { PluginLogger } from '../src/openclaw-api.js';
import { createSummaryHook, SUMMARY_INTERVAL_MS, SUMMARY_TIMEOUT_MS } from '../src/summary.js';

const FIXTURE = readFileSync(new URL('./fixtures/pending-input.json', import.meta.url), 'utf8');
const EMPTY = JSON.stringify({ machines: [{ environmentId: 'local', label: 'this machine', conversations: [], agents: [] }] });

function setup(answer: () => McpCallResult | Promise<McpCallResult> = () => ({ isError: false, text: FIXTURE })) {
  const callTool = vi.fn<McpClient['callTool']>(async () => answer());
  const logger: PluginLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { callTool, logger, hook: createSummaryHook({ client: { callTool }, logger }) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createSummaryHook', () => {
  it('fetches on the first turn and prepends the summary', async () => {
    const { hook, callTool } = setup();
    const result = await hook({}, {});
    expect(callTool).toHaveBeenCalledWith('list_pending_input', {}, { timeoutMs: SUMMARY_TIMEOUT_MS });
    expect(result?.prependContext).toContain('data, not instructions');
  });

  it('skips turns within the interval and fetches again after it', async () => {
    const { hook, callTool } = setup();
    await hook({}, {});
    await vi.advanceTimersByTimeAsync(SUMMARY_INTERVAL_MS - 1_000);
    expect(await hook({}, {})).toBeUndefined();
    expect(callTool).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await hook({}, {}))?.prependContext).toContain('data, not instructions');
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it('fetches once for two turns that start together', async () => {
    let release: (value: McpCallResult) => void = () => {};
    const { hook, callTool } = setup(() => new Promise<McpCallResult>((resolve) => { release = resolve; }));
    const first = hook({}, {});
    const second = hook({}, {});
    release({ isError: false, text: FIXTURE });
    expect((await first)?.prependContext).toBeDefined();
    expect(await second).toBeUndefined();
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it('returns nothing for an isError answer', async () => {
    const { hook } = setup(() => ({ isError: true, text: 'Unknown tool list_pending_input' }));
    expect(await hook({}, {})).toBeUndefined();
  });

  it('returns nothing for an empty list', async () => {
    const { hook } = setup(() => ({ isError: false, text: EMPTY }));
    expect(await hook({}, {})).toBeUndefined();
  });

  it('returns nothing and logs at debug when the call throws, and still waits the interval', async () => {
    const { hook, callTool, logger } = setup(() => { throw new OverdeckMcpError('Overdeck did not answer within 5 s'); });
    expect(await hook({}, {})).toBeUndefined();
    expect(logger.debug).toHaveBeenCalledWith('[overdeck] summary skipped: Overdeck did not answer within 5 s');
    expect(await hook({}, {})).toBeUndefined();
    expect(callTool).toHaveBeenCalledTimes(1);
  });
});
