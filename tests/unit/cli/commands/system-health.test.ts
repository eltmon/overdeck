/**
 * Tests for system-health command (PAN-905)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockExistsSync = vi.fn();
const mockFetch = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: (...args: Parameters<typeof mockExistsSync>) => mockExistsSync(...args),
}));

global.fetch = mockFetch as unknown as typeof fetch;

const mockGetDashboardApiUrl = vi.fn(() => 'http://localhost:3011');
vi.mock('../../../../src/lib/config.js', () => ({
  getDashboardApiUrl: (...args: Parameters<typeof mockGetDashboardApiUrl>) =>
    mockGetDashboardApiUrl(...args),
}));

const mockIsSmeeProcessRunning = vi.fn();
vi.mock('../../../../src/lib/smee.js', () => ({
  isSmeeProcessRunning: (...args: Parameters<typeof mockIsSmeeProcessRunning>) =>
    mockIsSmeeProcessRunning(...args),
}));

const mockIsCliproxyRunning = vi.fn();
vi.mock('../../../../src/lib/cliproxy.js', () => ({
  isCliproxyRunning: (...args: Parameters<typeof mockIsCliproxyRunning>) =>
    mockIsCliproxyRunning(...args),
}));

import { systemHealthCommand } from '../../../../src/cli/commands/system-health.ts';

describe('systemHealthCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('shows dashboard as healthy when HTTP 200', async () => {
    mockFetch.mockResolvedValue({ status: 200 });
    mockExistsSync.mockReturnValue(false);
    mockIsCliproxyRunning.mockReturnValue(false);

    await systemHealthCommand();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Dashboard');
    expect(output).toContain('✓');
    expect(output).toContain('Running');
  });

  it('shows dashboard as unhealthy on non-200 status', async () => {
    mockFetch.mockResolvedValue({ status: 503 });
    mockExistsSync.mockReturnValue(false);
    mockIsCliproxyRunning.mockReturnValue(false);

    await systemHealthCommand();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Dashboard');
    expect(output).toContain('HTTP 503');
  });

  it('shows dashboard as unhealthy when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    mockExistsSync.mockReturnValue(false);
    mockIsCliproxyRunning.mockReturnValue(false);

    await systemHealthCommand();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Dashboard');
    expect(output).toContain('Not running');
  });

  it('shows smee as not-configured when smee-url file is missing', async () => {
    mockFetch.mockResolvedValue({ status: 200 });
    mockExistsSync.mockReturnValue(false);
    mockIsCliproxyRunning.mockReturnValue(false);

    await systemHealthCommand();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('smee-client Webhook Relay');
    expect(output).toContain('Not configured');
  });

  it('shows smee as healthy when process is running', async () => {
    mockFetch.mockResolvedValue({ status: 200 });
    mockExistsSync.mockReturnValue(true);
    mockIsSmeeProcessRunning.mockReturnValue(true);
    mockIsCliproxyRunning.mockReturnValue(false);

    await systemHealthCommand();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('smee-client Webhook Relay');
    expect(output).toContain('Running');
  });

  it('shows smee as degraded when configured but not running', async () => {
    mockFetch.mockResolvedValue({ status: 200 });
    mockExistsSync.mockReturnValue(true);
    mockIsSmeeProcessRunning.mockReturnValue(false);
    mockIsCliproxyRunning.mockReturnValue(false);

    await systemHealthCommand();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('smee-client Webhook Relay');
    expect(output).toContain('Configured but not running');
  });

  it('shows CLIProxy as healthy when running', async () => {
    mockFetch.mockResolvedValue({ status: 200 });
    mockExistsSync.mockReturnValue(false);
    mockIsCliproxyRunning.mockReturnValue(true);

    await systemHealthCommand();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('CLIProxyAPI');
    expect(output).toContain('Running');
  });

  it('shows CLIProxy as degraded when not running', async () => {
    mockFetch.mockResolvedValue({ status: 200 });
    mockExistsSync.mockReturnValue(false);
    mockIsCliproxyRunning.mockReturnValue(false);

    await systemHealthCommand();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('CLIProxyAPI');
    expect(output).toContain('Not running');
  });
});
