import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readCloseOutSettings: vi.fn(),
  writeCloseOutSetting: vi.fn(),
  reloadDurableCloisterConfig: vi.fn(() => ({ accepted: true as const })),
  collectClosedIssueWorkspaces: vi.fn(),
}));

class MockCloseOutSettingsError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409
  ) {
    super(message);
  }
}

vi.mock('../../../../lib/cloister/close-out-settings.js', () => ({
  readCloseOutSettings: mocks.readCloseOutSettings,
  writeCloseOutSetting: mocks.writeCloseOutSetting,
  CloseOutSettingsError: MockCloseOutSettingsError,
}));

vi.mock('../../services/cloister-control-surface.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/cloister-control-surface.js')>()),
  reloadDurableCloisterConfig: mocks.reloadDurableCloisterConfig,
}));

vi.mock('../../../../lib/workspaces/closed-issue-workspaces.js', () => ({
  collectClosedIssueWorkspaces: mocks.collectClosedIssueWorkspaces,
}));

interface RouteResult {
  status: number;
  body: unknown;
}

async function requestCloisterRoute(path: string, init: RequestInit = {}): Promise<RouteResult> {
  const { cloisterRouteLayer } = await import('../cloister.js');
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, init));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(cloisterRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ),
    ),
  );
  const responseBody = response.body as { body?: Uint8Array } | null;
  const text = responseBody?.body ? new TextDecoder().decode(responseBody.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

const SETTINGS_VIEW = {
  remove_workspace: { value: true, source: 'default' },
  delete_feature_branch: { value: false, source: 'default' },
  auto: { value: true, source: 'default', inert: true },
  auto_delay_minutes: { value: 60, source: 'default', inert: true },
};

describe('cloister close-out routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reloadDurableCloisterConfig.mockReturnValue({ accepted: true });
  });

  it('GET /api/cloister/close-out returns the settings view', async () => {
    mocks.readCloseOutSettings.mockResolvedValue(SETTINGS_VIEW);

    const result = await requestCloisterRoute('/api/cloister/close-out');

    expect(result).toEqual({ status: 200, body: SETTINGS_VIEW });
  });

  it('PUT /api/cloister/close-out writes the key and reloads the live child', async () => {
    mocks.writeCloseOutSetting.mockResolvedValue(SETTINGS_VIEW);

    const result = await requestCloisterRoute('/api/cloister/close-out', {
      method: 'PUT',
      body: JSON.stringify({ key: 'remove_workspace', value: false }),
    });

    expect(mocks.writeCloseOutSetting).toHaveBeenCalledWith('remove_workspace', false);
    expect(mocks.reloadDurableCloisterConfig).toHaveBeenCalled();
    expect(result).toEqual({ status: 200, body: { settings: SETTINGS_VIEW, reloaded: true } });
  });

  it('PUT /api/cloister/close-out returns the error status and does not reload on failure', async () => {
    mocks.writeCloseOutSetting.mockRejectedValue(
      new MockCloseOutSettingsError('auto is inert since PAN-3917 and cannot be set', 400),
    );

    const result = await requestCloisterRoute('/api/cloister/close-out', {
      method: 'PUT',
      body: JSON.stringify({ key: 'auto', value: true }),
    });

    expect(result).toEqual({
      status: 400,
      body: { error: 'auto is inert since PAN-3917 and cannot be set' },
    });
    expect(mocks.reloadDurableCloisterConfig).not.toHaveBeenCalled();
  });

  it('GET /api/cloister/close-out/disk returns the collected report', async () => {
    const report = {
      closedCount: 2,
      totalBytes: 12_400_000_000,
      unknownSizeCount: 0,
      trackerReadsPaused: false,
      rows: [],
      computedAt: '2026-09-28T00:00:00.000Z',
    };
    mocks.collectClosedIssueWorkspaces.mockResolvedValue(report);

    const result = await requestCloisterRoute('/api/cloister/close-out/disk');

    expect(result).toEqual({ status: 200, body: report });
  });
});
