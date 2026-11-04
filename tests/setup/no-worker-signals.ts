import { afterEach } from 'vitest';
import { installWorkerSignalGuard } from './worker-signal-guard.js';

installWorkerSignalGuard(process as unknown as Parameters<typeof installWorkerSignalGuard>[0], afterEach);
