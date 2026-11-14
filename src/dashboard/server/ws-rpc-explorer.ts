/**
 * File explorer RPC handlers (PAN-5183).
 *
 * `explorerRpcHandlers` holds one handler per pan.explorer* method and is
 * spread into `PanRpcGroup.of({...})` in ws-rpc.ts. Each handler resolves
 * the root, calls a Promise service in services/explorer/, and maps any
 * failure to a PanRpcError with an EXPLORER_ERROR_CODES code.
 *
 * A method whose service has not shipped yet answers NOT_IMPLEMENTED with a
 * message naming the issue that owns it: explorerBeginEdit ships in PAN-5191.
 */
import { Effect, Queue, Stream } from 'effect';
import { PanRpcGroup, WS_METHODS, type ExplorerWatchBatch, type PanRpcError } from '@overdeck/contracts';
import { explorerError, toExplorerRpcError } from './services/explorer/errors.js';
import { gitStage, gitStatus } from './services/explorer/git.js';
import { listDir, readFile } from './services/explorer/read.js';
import { resolveExplorerRoot } from './services/explorer/roots.js';
import { invalidateFileListCache, searchContent, searchFiles } from './services/explorer/search.js';
import { restore, trashPaths } from './services/explorer/trash.js';
import { getExplorerWatchSupervisor } from './services/explorer/watch-supervisor.js';
import { copy, create, rename, writeFile } from './services/explorer/write.js';

/** The 14 pan.explorer* method tags. */
type ExplorerMethodTag = Extract<(typeof WS_METHODS)[keyof typeof WS_METHODS], `pan.explorer${string}`>;

const BEGIN_EDIT_OWNER = 'PAN-5191';

const notImplemented = (method: string, owner: string) =>
  Effect.fail(explorerError('NOT_IMPLEMENTED', `${method} ships in ${owner}`));

const run = <A>(fn: () => Promise<A>): Effect.Effect<A, PanRpcError> =>
  Effect.tryPromise({ try: fn, catch: toExplorerRpcError });

export const explorerRpcHandlers = {
  [WS_METHODS.explorerListDir]: (input) =>
    run(async () => listDir(await resolveExplorerRoot(input.rootId), input.path)),
  [WS_METHODS.explorerReadFile]: (input) =>
    run(async () => readFile(await resolveExplorerRoot(input.rootId), input.path, { ref: input.ref })),
  [WS_METHODS.explorerWriteFile]: (input) =>
    run(async () =>
      writeFile(
        await resolveExplorerRoot(input.rootId),
        input.path,
        input.text,
        input.expectedSignature,
        input.allowMissing,
      ),
    ),
  [WS_METHODS.explorerCreate]: (input) =>
    run(async () => create(await resolveExplorerRoot(input.rootId), input.path, input.kind)),
  [WS_METHODS.explorerRename]: (input) =>
    run(async () => rename(await resolveExplorerRoot(input.rootId), input.from, input.to)),
  [WS_METHODS.explorerCopy]: (input) =>
    run(async () => copy(await resolveExplorerRoot(input.rootId), input.from, input.to)),
  [WS_METHODS.explorerDelete]: (input) =>
    run(async () => ({ trashIds: await trashPaths(await resolveExplorerRoot(input.rootId), input.paths) })),
  [WS_METHODS.explorerRestore]: (input) =>
    run(async () => restore(await resolveExplorerRoot(input.rootId), input.trashId)),
  [WS_METHODS.explorerGitStatus]: (input) =>
    run(async () => gitStatus(await resolveExplorerRoot(input.rootId))),
  [WS_METHODS.explorerGitStage]: (input) =>
    run(async () => gitStage(await resolveExplorerRoot(input.rootId), input.paths, input.action)),
  [WS_METHODS.explorerSearchFiles]: (input) =>
    run(async () => searchFiles(await resolveExplorerRoot(input.rootId), input.query, input.limit)),
  [WS_METHODS.explorerSearchContent]: (input) =>
    run(async () => searchContent(await resolveExplorerRoot(input.rootId), input)),
  [WS_METHODS.explorerWatch]: (input) =>
    Stream.callback<ExplorerWatchBatch, PanRpcError>((queue) =>
      Effect.acquireRelease(
        run(async () => {
          const root = await resolveExplorerRoot(input.rootId);
          return getExplorerWatchSupervisor().subscribe(
            { id: root.id, absPath: root.absPath, kind: root.kind },
            (events) => {
              invalidateFileListCache(root.id);
              Queue.offerUnsafe(queue, { events });
            },
          );
        }),
        (unsubscribe) => Effect.sync(unsubscribe),
        // Stream.callback forks this effect and drops its failure, which
        // would leave the stream open with nothing in it; fail the queue
        // so the client gets the error (e.g. ROOT_NOT_FOUND).
      ).pipe(Effect.catch((error) => Queue.fail(queue, error))),
    ),
  [WS_METHODS.explorerBeginEdit]: () => notImplemented(WS_METHODS.explorerBeginEdit, BEGIN_EDIT_OWNER),
} satisfies Pick<Parameters<typeof PanRpcGroup.of>[0], ExplorerMethodTag>;
