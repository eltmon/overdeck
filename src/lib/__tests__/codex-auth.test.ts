import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCodexAuthStatus } from '../codex-auth.js';

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  stat: vi.fn(),
  open: vi.fn(),
  decodeJwtPayload: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: mocks.readFile,
  stat: mocks.stat,
  open: mocks.open,
}));

vi.mock('../cliproxy.js', () => ({
  decodeJwtPayload: mocks.decodeJwtPayload,
  getCliproxyAuthDir: () => '/cliproxy/auth',
  getCliproxyLogPath: () => '/cliproxy/cliproxy.log',
}));

function timestamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function mockLog(lines: string[]): void {
  const bytes = Buffer.from(lines.join('\n'), 'utf8');
  mocks.open.mockResolvedValue({
    stat: vi.fn(async () => ({ size: bytes.length })),
    read: vi.fn(async (buffer: Buffer) => {
      bytes.copy(buffer);
      return { bytesRead: bytes.length, buffer };
    }),
    close: vi.fn(async () => {}),
  });
}

describe('checkCodexAuthStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stat.mockResolvedValue({ mtimeMs: Date.now() - 120_000 });
  });

  it('reports burned when the recent burn log exists even if the JWT is expired', async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify({
      access_token: 'expired-token',
      email: 'user@example.com',
    }));
    mocks.decodeJwtPayload.mockReturnValue({ exp: Math.floor((Date.now() - 60_000) / 1000) });
    mockLog([
      `[${timestamp(Date.now() - 30_000)}] openai_auth.go refresh token has already been used`,
    ]);

    await expect(checkCodexAuthStatus()).resolves.toMatchObject({
      status: 'burned',
      email: 'user@example.com',
    });
  });

  it('keeps same-second burn log lines when credentials are written later in that second', async () => {
    const burnMs = Date.now() - 30_000;
    const burnSecondStart = Math.floor(burnMs / 1000) * 1000;
    mocks.readFile.mockResolvedValue(JSON.stringify({
      access_token: 'fresh-token',
      email: 'user@example.com',
    }));
    mocks.stat.mockResolvedValue({ mtimeMs: burnSecondStart + 900 });
    mocks.decodeJwtPayload.mockReturnValue({ exp: Math.floor((Date.now() + 3_600_000) / 1000) });
    mockLog([
      `[${timestamp(burnMs)}] openai_auth.go refresh token has already been used`,
    ]);

    await expect(checkCodexAuthStatus()).resolves.toMatchObject({
      status: 'burned',
      email: 'user@example.com',
    });
  });

  it('ignores burn log lines older than the credential write time', async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify({
      access_token: 'fresh-token',
      email: 'user@example.com',
    }));
    mocks.stat.mockResolvedValue({ mtimeMs: Date.now() - 10_000 });
    mocks.decodeJwtPayload.mockReturnValue({ exp: Math.floor((Date.now() + 3_600_000) / 1000) });
    mockLog([
      `[${timestamp(Date.now() - 30_000)}] openai_auth.go refresh token has already been used`,
    ]);

    await expect(checkCodexAuthStatus()).resolves.toMatchObject({
      status: 'valid',
      email: 'user@example.com',
    });
  });

  it('treats syntactically valid non-object credential JSON as missing', async () => {
    mocks.readFile.mockResolvedValue('null');

    await expect(checkCodexAuthStatus()).resolves.toEqual({ status: 'missing' });
    expect(mocks.decodeJwtPayload).not.toHaveBeenCalled();
  });
});
