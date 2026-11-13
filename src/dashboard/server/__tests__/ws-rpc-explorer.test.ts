import { describe, expect, it } from 'vitest';
import { Cause, Effect, Exit } from 'effect';
import { PanRpcError, WS_METHODS } from '@overdeck/contracts';
import { explorerRpcHandlers } from '../ws-rpc-explorer.js';

function failureOf(exit: Exit.Exit<unknown, unknown>): unknown {
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) return undefined;
  return Cause.squash(exit.cause);
}

describe('explorerRpcHandlers stubs', () => {
  it('explorerWriteFile fails NOT_IMPLEMENTED naming PAN-5187', async () => {
    const exit = await Effect.runPromiseExit(
      explorerRpcHandlers[WS_METHODS.explorerWriteFile]({
        rootId: 'issue:PAN-5185',
        path: 'a.ts',
        text: 'x',
        expectedSignature: null,
        allowMissing: false,
      }),
    );
    const error = failureOf(exit);
    expect(error).toBeInstanceOf(PanRpcError);
    expect((error as PanRpcError).code).toBe('NOT_IMPLEMENTED');
    expect((error as PanRpcError).message).toContain('PAN-5187');
  });

  it('explorerBeginEdit fails NOT_IMPLEMENTED naming PAN-5191', async () => {
    const exit = await Effect.runPromiseExit(
      explorerRpcHandlers[WS_METHODS.explorerBeginEdit]({ projectKey: 'overdeck', forceNew: false }),
    );
    const error = failureOf(exit);
    expect(error).toBeInstanceOf(PanRpcError);
    expect((error as PanRpcError).code).toBe('NOT_IMPLEMENTED');
    expect((error as PanRpcError).message).toContain('PAN-5191');
  });
});
