/**
 * File explorer RPC handlers (PAN-5183).
 *
 * `explorerRpcHandlers` holds one handler per pan.explorer* method and is
 * spread into `PanRpcGroup.of({...})` in ws-rpc.ts. A method whose service
 * has not shipped yet answers NOT_IMPLEMENTED with a message naming the
 * issue that owns it:
 *   - read methods (list, read, git status/stage, search, watch): PAN-5185
 *   - write methods (write, create, rename, copy, delete, restore): PAN-5187
 *   - explorerBeginEdit: PAN-5191
 */
import { Effect, Stream } from 'effect';
import { PanRpcGroup, WS_METHODS } from '@overdeck/contracts';
import { explorerError } from './services/explorer/errors.js';

/** The 14 pan.explorer* method tags. */
type ExplorerMethodTag = Extract<(typeof WS_METHODS)[keyof typeof WS_METHODS], `pan.explorer${string}`>;

const READ_OWNER = 'PAN-5185';
const WRITE_OWNER = 'PAN-5187';
const BEGIN_EDIT_OWNER = 'PAN-5191';

const notImplemented = (method: string, owner: string) =>
  Effect.fail(explorerError('NOT_IMPLEMENTED', `${method} ships in ${owner}`));

export const explorerRpcHandlers = {
  [WS_METHODS.explorerListDir]: () => notImplemented(WS_METHODS.explorerListDir, READ_OWNER),
  [WS_METHODS.explorerReadFile]: () => notImplemented(WS_METHODS.explorerReadFile, READ_OWNER),
  [WS_METHODS.explorerWriteFile]: () => notImplemented(WS_METHODS.explorerWriteFile, WRITE_OWNER),
  [WS_METHODS.explorerCreate]: () => notImplemented(WS_METHODS.explorerCreate, WRITE_OWNER),
  [WS_METHODS.explorerRename]: () => notImplemented(WS_METHODS.explorerRename, WRITE_OWNER),
  [WS_METHODS.explorerCopy]: () => notImplemented(WS_METHODS.explorerCopy, WRITE_OWNER),
  [WS_METHODS.explorerDelete]: () => notImplemented(WS_METHODS.explorerDelete, WRITE_OWNER),
  [WS_METHODS.explorerRestore]: () => notImplemented(WS_METHODS.explorerRestore, WRITE_OWNER),
  [WS_METHODS.explorerGitStatus]: () => notImplemented(WS_METHODS.explorerGitStatus, READ_OWNER),
  [WS_METHODS.explorerGitStage]: () => notImplemented(WS_METHODS.explorerGitStage, READ_OWNER),
  [WS_METHODS.explorerSearchFiles]: () => notImplemented(WS_METHODS.explorerSearchFiles, READ_OWNER),
  [WS_METHODS.explorerSearchContent]: () => notImplemented(WS_METHODS.explorerSearchContent, READ_OWNER),
  [WS_METHODS.explorerWatch]: () =>
    Stream.fail(explorerError('NOT_IMPLEMENTED', `${WS_METHODS.explorerWatch} ships in ${READ_OWNER}`)),
  [WS_METHODS.explorerBeginEdit]: () => notImplemented(WS_METHODS.explorerBeginEdit, BEGIN_EDIT_OWNER),
} satisfies Pick<Parameters<typeof PanRpcGroup.of>[0], ExplorerMethodTag>;
