import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

// Source mode only (Vitest, tsx). Node strips the worker's types but does not rewrite
// its `.js` import specifiers to `.ts`, so a raw `.ts` worker dies on its first
// relative import. Loader flags in `execArgv` (`--import tsx`) do not reach worker
// threads either, so the worker registers tsx itself before importing the entry.
// Bun runs `.ts` workers natively. A built `.js` worker never takes this path.
export function sourceWorkerBootstrap(workerUrl: URL, moduleUrl = import.meta.url): string {
  const tsxApiUrl = pathToFileURL(createRequire(moduleUrl).resolve('tsx/esm/api')).href;
  return `import(${JSON.stringify(tsxApiUrl)})`
    + `.then((tsx) => { tsx.register(); return import(${JSON.stringify(workerUrl.href)}); })`
    + `.catch((err) => { setImmediate(() => { throw err; }); });`;
}

/**
 * Start a worker thread from a module URL: the built `.js` entry directly, or a
 * source `.ts` entry through the tsx bootstrap above (PAN-3930).
 */
export function spawnModuleWorker(workerUrl: URL): Worker {
  const execArgv = process.execArgv.filter((arg) => !arg.startsWith('--inspect'));
  if (workerUrl.pathname.endsWith('.ts') && !process.versions['bun']) {
    return new Worker(sourceWorkerBootstrap(workerUrl), { eval: true, execArgv });
  }
  return new Worker(workerUrl, { execArgv } as ConstructorParameters<typeof Worker>[1]);
}
