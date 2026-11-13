/**
 * Entry of the forked explorer watcher child (`explorer-watch-child.js`,
 * PAN-5183 D-5). The only dashboard bundle chunk allowed to import
 * @parcel/watcher; tsdown.config.ts fails the build otherwise.
 */
import * as parcel from '@parcel/watcher';
import { runWatchChild } from './watch-child-runtime.js';
import type { SupervisorToChild } from './watch-protocol.js';

runWatchChild({
  subscribe: parcel.subscribe,
  send: (msg) => {
    process.send?.(msg);
  },
  onMessage: (cb) => process.on('message', (msg) => cb(msg as SupervisorToChild)),
  onDisconnect: (cb) => process.on('disconnect', cb),
  exit: (code) => process.exit(code),
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
  now: Date.now,
  platform: process.platform,
});
